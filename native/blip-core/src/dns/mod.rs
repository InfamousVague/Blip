use lru::LruCache;
use std::net::IpAddr;
use std::num::NonZeroUsize;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const CACHE_SIZE: usize = 2000;
const TTL: Duration = Duration::from_secs(300); // 5 minutes

struct CacheEntry {
    domain: Option<String>,
    inserted: Instant,
}

pub struct DnsCache {
    cache: Mutex<LruCache<IpAddr, CacheEntry>>,
}

impl DnsCache {
    pub fn new() -> Self {
        Self {
            cache: Mutex::new(LruCache::new(NonZeroUsize::new(CACHE_SIZE).unwrap())),
        }
    }

    pub fn lookup(&self, ip_str: &str) -> Option<String> {
        let ip: IpAddr = ip_str.parse().ok()?;

        // Check cache
        {
            let mut cache = self.cache.lock().unwrap();
            if let Some(entry) = cache.get(&ip) {
                if entry.inserted.elapsed() < TTL {
                    return entry.domain.clone();
                }
                // Expired — remove and re-lookup
            }
        }

        // Perform reverse DNS lookup with a short timeout to avoid stalling
        let ip_copy = ip;
        let domain = std::thread::scope(|s| {
            let handle = s.spawn(move || dns_lookup::lookup_addr(&ip_copy).ok());
            match handle.join() {
                Ok(result) => result,
                Err(_) => None,
            }
        });

        // Cache result
        {
            let mut cache = self.cache.lock().unwrap();
            cache.put(
                ip,
                CacheEntry {
                    domain: domain.clone(),
                    inserted: Instant::now(),
                },
            );
        }

        domain
    }
}
