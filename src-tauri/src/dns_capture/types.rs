use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::net::IpAddr;

/// A parsed DNS event from the helper binary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsEvent {
    /// The queried domain name
    pub domain: String,
    /// IP addresses from A/AAAA answer records
    pub ips: Vec<String>,
    /// Query type: "A", "AAAA", "CNAME", etc.
    #[serde(rename = "type")]
    pub query_type: String,
    /// Timestamp in milliseconds since epoch
    pub ts: u64,
}

/// A log entry for the frontend DNS query log.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsQueryLogEntry {
    pub domain: String,
    pub query_type: String,
    pub response_ips: Vec<String>,
    pub timestamp_ms: u64,
    pub is_blocked: bool,
    pub blocked_by: Option<String>,
    /// Process that made the query (from NE DNS proxy, None from pcap)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_app: Option<String>,
}

/// Summary stats for the DNS capture.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsStats {
    pub total_queries: u64,
    pub unique_domains: u64,
    pub blocked_count: u64,
    pub recent_rate: f64, // queries per second over last 10s
}

/// Max entries for in-memory caches
const MAX_IP_MAPPINGS: usize = 50_000;
const MAX_RECENT_QUERIES: usize = 500;
const MAX_RATE_TIMESTAMPS: usize = 1000;

/// Bidirectional domain ↔ IP mapping built from observed DNS traffic.
pub struct DnsMapping {
    /// IP → (domain, timestamp_ms) — the most recent domain that resolved to this IP
    ip_to_domain: HashMap<IpAddr, (String, u64)>,
    /// domain → set of IPs (deduped)
    domain_to_ips: HashMap<String, Vec<IpAddr>>,
    /// Recent DNS query log for the frontend (capped)
    recent_queries: VecDeque<DnsQueryLogEntry>,
    /// Running counters
    pub total_queries: u64,
    pub blocked_count: u64,
    /// Timestamps of recent queries for rate calculation
    recent_timestamps: VecDeque<u64>,
}

impl DnsMapping {
    pub fn new() -> Self {
        Self {
            ip_to_domain: HashMap::new(),
            domain_to_ips: HashMap::new(),
            recent_queries: VecDeque::new(),
            total_queries: 0,
            blocked_count: 0,
            recent_timestamps: VecDeque::new(),
        }
    }

    /// Record a DNS event from pcap (no process attribution).
    pub fn record(&mut self, event: &DnsEvent, is_blocked: bool, blocked_by: Option<String>) {
        self.record_with_source(event, is_blocked, blocked_by, None);
    }

    /// Record a DNS event — updates both mappings and the query log.
    /// `source_app` is Some when from the NE DNS proxy, None from pcap.
    pub fn record_with_source(
        &mut self,
        event: &DnsEvent,
        is_blocked: bool,
        blocked_by: Option<String>,
        source_app: Option<String>,
    ) {
        self.total_queries += 1;
        if is_blocked {
            self.blocked_count += 1;
        }

        // Update IP → domain mapping
        for ip_str in &event.ips {
            if let Ok(ip) = ip_str.parse::<IpAddr>() {
                self.ip_to_domain.insert(ip, (event.domain.clone(), event.ts));
                let ips = self.domain_to_ips.entry(event.domain.clone()).or_default();
                if !ips.contains(&ip) {
                    ips.push(ip);
                }
            }
        }

        // Evict oldest IP mappings if over limit
        if self.ip_to_domain.len() > MAX_IP_MAPPINGS {
            // Find the oldest entries and remove them
            let mut entries: Vec<(IpAddr, u64)> = self.ip_to_domain.iter().map(|(ip, (_, ts))| (*ip, *ts)).collect();
            entries.sort_by_key(|(_, ts)| *ts);
            let to_remove = entries.len() - MAX_IP_MAPPINGS / 2;
            for (ip, _) in entries.into_iter().take(to_remove) {
                self.ip_to_domain.remove(&ip);
            }
        }

        // Cap domain_to_ips too
        if self.domain_to_ips.len() > MAX_IP_MAPPINGS / 10 {
            // Just keep the most recently seen domains (via ip_to_domain)
            let active_domains: std::collections::HashSet<&str> =
                self.ip_to_domain.values().map(|(d, _)| d.as_str()).collect();
            self.domain_to_ips.retain(|d, _| active_domains.contains(d.as_str()));
        }

        // Add to query log (capped)
        self.recent_queries.push_back(DnsQueryLogEntry {
            domain: event.domain.clone(),
            query_type: event.query_type.clone(),
            response_ips: event.ips.clone(),
            timestamp_ms: event.ts,
            is_blocked,
            blocked_by,
            source_app,
        });
        while self.recent_queries.len() > MAX_RECENT_QUERIES {
            self.recent_queries.pop_front();
        }

        // Track timestamps for rate calculation (cap to avoid unbounded growth)
        self.recent_timestamps.push_back(event.ts);
        let cutoff = event.ts.saturating_sub(10_000);
        while self.recent_timestamps.front().map_or(false, |&t| t < cutoff) {
            self.recent_timestamps.pop_front();
        }
        while self.recent_timestamps.len() > MAX_RATE_TIMESTAMPS {
            self.recent_timestamps.pop_front();
        }
    }

    /// Look up a domain for an IP address (forward DNS knowledge).
    pub fn domain_for_ip(&self, ip: &IpAddr) -> Option<&str> {
        self.ip_to_domain.get(ip).map(|(d, _)| d.as_str())
    }

    /// Look up a domain for an IP string.
    pub fn domain_for_ip_str(&self, ip_str: &str) -> Option<&str> {
        ip_str
            .parse::<IpAddr>()
            .ok()
            .and_then(|ip| self.domain_for_ip(&ip))
    }

    /// Get recent queries for the frontend.
    pub fn recent_log(&self, limit: usize) -> Vec<DnsQueryLogEntry> {
        self.recent_queries
            .iter()
            .rev()
            .take(limit)
            .cloned()
            .collect()
    }

    /// Get unique domain count.
    pub fn unique_domains(&self) -> u64 {
        self.domain_to_ips.len() as u64
    }

    /// Queries per second over the last 10 seconds.
    pub fn queries_per_second(&self) -> f64 {
        if self.recent_timestamps.len() < 2 {
            return 0.0;
        }
        let span = self.recent_timestamps.back().unwrap() - self.recent_timestamps.front().unwrap();
        if span == 0 {
            return 0.0; // All queries at same millisecond — no meaningful rate
        }
        (self.recent_timestamps.len() as f64) / (span as f64 / 1000.0)
    }

    /// Look up cached IPs for a domain.
    pub fn ips_for_domain(&self, domain: &str) -> Option<&Vec<IpAddr>> {
        self.domain_to_ips.get(domain)
    }

    /// Build DnsStats for the frontend.
    pub fn stats(&self) -> DnsStats {
        DnsStats {
            total_queries: self.total_queries,
            unique_domains: self.unique_domains(),
            blocked_count: self.blocked_count,
            recent_rate: self.queries_per_second(),
        }
    }
}
