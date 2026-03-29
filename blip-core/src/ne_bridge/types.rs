use serde::{Deserialize, Serialize};

/// Typed event wrapper — the NE sends events with a "type" discriminator.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NEEvent {
    #[serde(rename = "type")]
    pub type_: String,
    pub connection: Option<NEConnectionEvent>,
    pub dns: Option<NEDnsEvent>,
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
