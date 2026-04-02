use maxminddb::Reader;
use std::collections::HashMap;
use std::net::IpAddr;
use std::path::Path;
use std::sync::Mutex;

use crate::capture::types::GeoResult;

pub struct GeoIp {
    /// Primary reader — DB-IP City Lite (better city coverage)
    primary: Option<Reader<Vec<u8>>>,
    /// Fallback reader — GeoLite2-City
    fallback: Reader<Vec<u8>>,
    cache: Mutex<HashMap<IpAddr, Option<GeoResult>>>,
}

impl GeoIp {
    pub fn new(db_path: &Path) -> Result<Self, maxminddb::MaxMindDBError> {
        let fallback = Reader::open_readfile(db_path)?;

        // Try loading DB-IP City Lite from the same directory
        let dbip_path = db_path.parent()
            .map(|p| p.join("dbip-city-lite.mmdb"))
            .unwrap_or_default();
        let primary = if dbip_path.exists() {
            match Reader::open_readfile(&dbip_path) {
                Ok(r) => {
                    eprintln!("[GeoIP] Loaded DB-IP City Lite (supplementary)");
                    Some(r)
                }
                Err(e) => {
                    eprintln!("[GeoIP] Failed to load DB-IP City Lite: {}", e);
                    None
                }
            }
        } else {
            None
        };

        Ok(Self {
            primary,
            fallback,
            cache: Mutex::new(HashMap::new()),
        })
    }

    pub fn lookup(&self, ip_str: &str) -> Option<GeoResult> {
        let ip: IpAddr = ip_str.parse().ok()?;

        // Skip private/reserved IPs
        if is_private(&ip) {
            return None;
        }

        // Check cache
        {
            let cache = self.cache.lock().unwrap();
            if let Some(result) = cache.get(&ip) {
                return result.clone();
            }
        }

        // Lookup: try DB-IP first (better city coverage), fall back to GeoLite2
        let result = self.do_lookup_primary(ip)
            .or_else(|| self.do_lookup_fallback(ip));

        // Cache
        {
            let mut cache = self.cache.lock().unwrap();
            cache.insert(ip, result.clone());
        }

        result
    }

    /// Lookup using DB-IP City Lite — prefer this for city-level accuracy
    fn do_lookup_primary(&self, ip: IpAddr) -> Option<GeoResult> {
        let reader = self.primary.as_ref()?;
        let result = self.extract_geo(reader, ip)?;
        // Only use primary result if it has city-level data (not just country)
        if result.city.is_some() {
            Some(result)
        } else {
            None
        }
    }

    /// Fallback to GeoLite2
    fn do_lookup_fallback(&self, ip: IpAddr) -> Option<GeoResult> {
        self.extract_geo(&self.fallback, ip)
    }

    fn extract_geo(&self, reader: &Reader<Vec<u8>>, ip: IpAddr) -> Option<GeoResult> {
        let city: maxminddb::geoip2::City = reader.lookup(ip).ok()?;

        let location = city.location.as_ref()?;
        let latitude = location.latitude?;
        let longitude = location.longitude?;

        let city_name = city
            .city
            .as_ref()
            .and_then(|c| c.names.as_ref())
            .and_then(|n| n.get("en"))
            .map(|s| s.to_string());

        let country_name = city
            .country
            .as_ref()
            .and_then(|c| c.names.as_ref())
            .and_then(|n| n.get("en"))
            .map(|s| s.to_string());

        Some(GeoResult {
            latitude,
            longitude,
            city: city_name,
            country: country_name,
        })
    }
}

fn is_private(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_unspecified()
                || v4.octets()[0] == 100 && v4.octets()[1] >= 64 && v4.octets()[1] <= 127 // CGNAT
        }
        IpAddr::V6(v6) => {
            v6.is_loopback() || v6.is_unspecified()
        }
    }
}
