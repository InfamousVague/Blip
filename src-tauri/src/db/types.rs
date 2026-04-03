#[allow(dead_code)]
pub const CURRENT_SCHEMA_VERSION: i32 = 5;

// ---- Firewall types ----

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FirewallRule {
    pub id: String,
    pub app_id: String,
    pub app_name: String,
    pub app_path: Option<String>,
    pub action: String, // "allow", "deny", "unspecified"
    pub domain: Option<String>,
    pub port: Option<u16>,
    pub protocol: Option<String>,
    pub expires_at: Option<u64>,
    pub lifetime: String, // "permanent", "session", "timed"
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AppConnectionInfo {
    pub app_id: String,
    pub app_name: String,
    pub app_path: Option<String>,
    pub first_seen_ms: u64,
    pub last_seen_ms: u64,
    pub total_connections: u64,
    pub is_apple_signed: bool,
}

// ---- Return types for queries ----

#[derive(Debug, Clone, serde::Serialize)]
pub struct HistoricalEndpoint {
    pub dest_lat: f64,
    pub dest_lon: f64,
    pub connection_count: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct HistoricalStats {
    pub total_connections: u64,
    pub total_bytes_in: u64,
    pub total_bytes_out: u64,
    pub first_seen_ms: Option<u64>,
    pub last_seen_ms: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TrackerStats {
    pub total_tracker_hits: u64,
    pub total_bytes_blocked: u64,
    pub top_domains: Vec<TrackerDomainStat>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TrackerDomainStat {
    pub domain: String,
    pub category: Option<String>,
    pub total_hits: u64,
    pub total_bytes: u64,
    pub last_seen_ms: u64,
}
