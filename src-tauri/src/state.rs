use std::sync::atomic::{AtomicBool, AtomicU16};
use std::sync::{Arc, Mutex, RwLock as StdRwLock};
use tokio::sync::RwLock;

use crate::blocklist::BlocklistStore;
use crate::capture::nettop::ConnectionStore;
use crate::db::Database;
use crate::db_writer::DbWriter;
use crate::dns_capture::types::DnsMapping;
use crate::dns_capture::DnsCaptureManager;
use crate::enrichment::Enricher;
use crate::geoip::GeoIp;
use crate::ne_bridge;
use crate::speedtest;

pub(crate) struct AppState {
    pub(crate) running: Arc<AtomicBool>,
    pub(crate) elevated: Arc<AtomicBool>,
    pub(crate) elevating: Arc<AtomicBool>,
    pub(crate) store: ConnectionStore,
    pub(crate) blocklists: Arc<BlocklistStore>,
    pub(crate) db: Arc<Database>,
    pub(crate) db_writer: Arc<DbWriter>,
    pub(crate) enricher: Arc<Mutex<Enricher>>,
    pub(crate) dns_mapping: Arc<RwLock<DnsMapping>>,
    pub(crate) dns_capture: Arc<tokio::sync::Mutex<Option<DnsCaptureManager>>>,
    pub(crate) geoip: Arc<StdRwLock<Option<Arc<GeoIp>>>>,
    pub(crate) speed_test_result: Arc<Mutex<Option<speedtest::SpeedTestResult>>>,
    pub(crate) speed_test_running: Arc<AtomicBool>,
    /// Broadcast handle for pushing config changes to connected NE clients.
    pub(crate) ne_broadcast: Arc<Mutex<Option<ne_bridge::NEBroadcast>>>,
}

/// State holding the local tile server port (0 = not started / no pmtiles found)
pub(crate) struct TileServerState {
    pub(crate) port: Arc<AtomicU16>,
}
