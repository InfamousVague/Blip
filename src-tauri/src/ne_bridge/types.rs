use serde::{Deserialize, Serialize};

/// Typed event wrapper — the NE sends events with a "type" discriminator.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NEEvent {
    #[serde(rename = "type")]
    pub type_: String,
    pub connection: Option<NEConnectionEvent>,
    pub dns: Option<NEDnsEvent>,
    pub flow_update: Option<NEFlowUpdate>,
    pub listening_ports: Option<Vec<NEListeningPort>>,
    // v2 firewall fields
    pub verdict: Option<String>,
    pub matched_rule_id: Option<String>,
    pub domain: Option<String>,
    pub approval_request: Option<serde_json::Value>,
    pub approval_request_app_id: Option<String>,
    pub approval_request_domain: Option<String>,
    pub block_event: Option<serde_json::Value>,
    pub ne_version: Option<String>,
}

/// Connection event received from the Network Extension via Unix socket.
/// Matches the JSON format sent by SocketBridge.swift.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NEConnectionEvent {
    pub source_app_id: String,
    pub source_pid: i32,
    pub dest_ip: String,
    pub dest_port: u16,
    pub protocol: String,
    pub direction: String,
    pub timestamp_ms: u64,
    pub process_path: Option<String>,
    pub code_signed: Option<bool>,
}

/// Per-flow byte update from the NE — sent periodically for active flows.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NEFlowUpdate {
    pub dest_ip: String,
    pub dest_port: u16,
    pub source_app_id: String,
    pub bytes_in: u64,
    pub bytes_out: u64,
    pub timestamp_ms: u64,
}

/// Listening port discovered by the NE's flow inspection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NEListeningPort {
    pub port: u16,
    pub protocol: String,
    pub process_name: String,
    pub pid: i32,
}

/// DNS query event from the NE DNS proxy, with process attribution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NEDnsEvent {
    pub domain: String,
    pub query_type: String,
    pub response_ips: Vec<String>,
    pub timestamp_ms: u64,
    pub source_app_id: String,
    pub source_pid: i32,
    pub blocked: bool,
    pub cname_chain: Option<Vec<String>>,
    pub ttl: Option<u32>,
    pub upstream_time_ms: Option<u64>,
}

/// Heartbeat from the Network Extension — sent every 10 seconds.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NEHeartbeat {
    pub flow_count: u64,
    pub blocked_count: u64,
    pub uptime_ms: u64,
    pub rule_count: u64,
    pub dns_blocked_count: u64,
    pub dns_cache_size: u64,
    pub socket_connected: bool,
    pub ne_version: String,
    pub ne_build: String,
    pub mode: String,
}

/// Structured error event from the Network Extension.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NEErrorEvent {
    pub category: String,
    pub message: String,
    pub severity: String,
    pub timestamp_ms: u64,
}

/// Live NE status exposed to the frontend via Tauri command.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NELiveStatus {
    pub connected: bool,
    pub ne_version: String,
    pub ne_build: String,
    pub mode: String,
    pub flow_count: u64,
    pub blocked_count: u64,
    pub uptime_ms: u64,
    pub rule_count: u64,
    pub dns_blocked_count: u64,
    pub dns_cache_size: u64,
    pub last_heartbeat_ms: u64,
    pub errors: Vec<NEErrorEvent>,
}

/// Status of the Network Extension.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum NEStatus {
    /// NE is not installed
    NotInstalled,
    /// NE activation is pending user approval
    PendingApproval,
    /// NE is active and filtering
    Active,
    /// NE is installed but not currently filtering
    Inactive,
    /// NE is not available on this system
    Unavailable,
}

impl NEStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            NEStatus::NotInstalled => "not_installed",
            NEStatus::PendingApproval => "pending_approval",
            NEStatus::Active => "active",
            NEStatus::Inactive => "inactive",
            NEStatus::Unavailable => "unavailable",
        }
    }
}
