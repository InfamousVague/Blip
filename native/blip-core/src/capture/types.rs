use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum Protocol {
    Tcp,
    Udp,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoResult {
    pub latitude: f64,
    pub longitude: f64,
    pub city: Option<String>,
    pub country: Option<String>,
}

/// A resolved connection ready for the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedConnection {
    pub id: String,
    pub dest_ip: String,
    pub dest_port: u16,
    pub process_name: Option<String>,
    pub protocol: Protocol,
    pub dest_lat: f64,
    pub dest_lon: f64,
    pub domain: Option<String>,
    pub city: Option<String>,
    pub country: Option<String>,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub first_seen_ms: u64,
    pub last_seen_ms: u64,
    pub active: bool,
    pub ping_ms: Option<f64>,
    #[serde(default)]
    pub is_tracker: bool,
    #[serde(default)]
    pub tracker_category: Option<String>,
    pub asn: Option<u32>,
    pub asn_org: Option<String>,
    pub cloud_provider: Option<String>,
    pub cloud_region: Option<String>,
    pub datacenter: Option<String>,
    #[serde(default)]
    pub is_cdn: bool,
    pub network_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureSnapshot {
    pub connections: Vec<ResolvedConnection>,
    pub total_ever: usize,
}
