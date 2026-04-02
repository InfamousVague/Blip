use serde::{Deserialize, Serialize};

// ---- Firewall Rule ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirewallRule {
    pub id: String,
    pub profile_id: String,
    pub app_id: String,
    pub app_name: String,
    pub app_path: Option<String>,
    pub action: String, // "allow", "deny", "ask"
    pub domain_pattern: Option<String>,
    pub domain_match_type: Option<String>, // "exact", "wildcard", "regex", "category"
    pub port: Option<String>,             // "443", "80,443", "1024-65535"
    pub protocol: Option<String>,         // "tcp", "udp", "any"
    pub direction: String,                // "inbound", "outbound", "any"
    pub lifetime: String,                 // "once", "session", "forever"
    pub hit_count: u64,
    pub bytes_allowed: u64,
    pub bytes_blocked: u64,
    pub last_triggered_ms: Option<u64>,
    pub enabled: bool,
    pub priority: i32,
    pub created_at: u64,
    pub updated_at: u64,
}

// ---- App Registry ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppInfo {
    pub app_id: String,
    pub app_name: String,
    pub app_path: Option<String>,
    pub is_apple_signed: bool,
    pub is_system_app: bool,
    pub code_signing_status: String, // "apple", "developer", "unsigned", "unknown"
    pub first_seen_ms: u64,
    pub last_seen_ms: u64,
    pub total_connections: u64,
    pub total_bytes_in: u64,
    pub total_bytes_out: u64,
    pub privacy_score: Option<String>, // "A+" to "F"
    pub tracker_connection_count: u64,
    pub clean_connection_count: u64,
}

// ---- Network Profiles ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkProfile {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub is_active: bool,
    pub auto_switch_ssid: Option<String>,
    pub auto_switch_vpn: bool,
    pub created_at: u64,
}

// ---- Block History ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockHistoryEntry {
    pub id: i64,
    pub app_id: Option<String>,
    pub domain: Option<String>,
    pub dest_ip: Option<String>,
    pub dest_port: Option<u16>,
    pub protocol: Option<String>,
    pub direction: Option<String>,
    pub rule_id: Option<String>,
    pub reason: String, // "rule", "dns_block", "kill_switch", "tracker"
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockStatsHourly {
    pub hour_bucket: u64,
    pub app_id: Option<String>,
    pub domain: Option<String>,
    pub block_count: u64,
    pub bytes_blocked: u64,
}

// ---- Privacy Scoring ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivacyScore {
    pub app_id: String,
    pub score: String, // "A+" to "F"
    pub tracker_domains: u64,
    pub total_domains: u64,
    pub tracker_bytes: u64,
    pub total_bytes: u64,
    pub last_calculated_ms: u64,
}

// ---- Conflict Detection ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleConflict {
    pub existing_rule: FirewallRule,
    pub overlap_description: String,
}

// ---- Firewall State (sent to frontend) ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirewallState {
    pub mode: String,             // "ask", "allow_all", "deny_all"
    pub kill_switch_active: bool,
    pub active_profile_id: String,
    pub wizard_completed: bool,
}

// ---- Approval Request (NE -> Frontend) ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirewallApprovalRequest {
    pub id: String,
    pub app_id: String,
    pub app_name: String,
    pub domain: Option<String>,
    pub dest_ip: String,
    pub dest_port: u16,
    pub protocol: String,
    pub direction: String,
    pub is_background: bool,
    pub is_tracker: bool,
    pub tracker_category: Option<String>,
    pub timestamp_ms: u64,
}

// ---- New Rule Request (frontend -> backend) ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewRuleRequest {
    pub profile_id: Option<String>,
    pub app_id: String,
    pub app_name: String,
    pub app_path: Option<String>,
    pub action: String,
    pub domain_pattern: Option<String>,
    pub domain_match_type: Option<String>,
    pub port: Option<String>,
    pub protocol: Option<String>,
    pub direction: Option<String>,
    pub lifetime: Option<String>,
    pub priority: Option<i32>,
}
