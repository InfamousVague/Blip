use maxminddb::Reader;
use std::collections::HashMap;
use std::net::IpAddr;
use std::path::Path;
use std::sync::Mutex;

use crate::capture::types::GeoResult;

pub struct GeoIp {
    reader: Reader<Vec<u8>>,
    cache: Mutex<HashMap<IpAddr, Option<GeoResult>>>,
}

impl GeoIp {
    pub fn new(db_path: &Path) -> Result<Self, maxminddb::MaxMindDBError> {
        let reader = Reader::open_readfile(db_path)?;
        Ok(Self {
            reader,
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

        // Lookup
        let result = self.do_lookup(ip);

        // Cache
        {
            let mut cache = self.cache.lock().unwrap();
            cache.insert(ip, result.clone());
        }

        result
    }

    fn do_lookup(&self, ip: IpAddr) -> Option<GeoResult> {
        let city: maxminddb::geoip2::City = self.reader.lookup(ip).ok()?;

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
