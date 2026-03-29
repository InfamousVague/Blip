//! blip-core — Rust core library for Blip network monitor.
//!
//! Compiled as a static library (libblip_core.a) and linked into the
//! native macOS app. Exposes C-compatible FFI functions that Swift calls.

mod blocklist;
mod capture;
mod db;
mod db_writer;
mod dns;
mod dns_capture;
mod enrichment;
mod geoip;
mod ne_bridge;

pub mod ffi;

use blocklist::BlocklistStore;
use capture::nettop::{ConnectionState, ConnectionStore};
use db::Database;
use db_writer::DbWriter;
use dns::DnsCache;
use dns_capture::types::DnsMapping;
use enrichment::Enricher;
use geoip::GeoIp;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::RwLock;

/// Global app state — initialized once via `blip_init()`.
pub struct BlipCore {
    pub running: Arc<AtomicBool>,
    pub store: ConnectionStore,
    pub blocklists: Arc<BlocklistStore>,
    pub db: Arc<Database>,
    pub db_writer: Arc<DbWriter>,
    pub enricher: Arc<Mutex<Enricher>>,
    pub dns_mapping: Arc<RwLock<DnsMapping>>,
    pub runtime: tokio::runtime::Runtime,
}

impl BlipCore {
    pub fn new(resource_dir: &str) -> Result<Self, String> {
        let resource_path = std::path::Path::new(resource_dir);

        // Initialize database
        let db = Arc::new(Database::open()?);

        // Load blocklists from DB
        let blocklists = Arc::new(BlocklistStore::new());
        match db.load_blocklists() {
            Ok(entries) => {
                let count = entries.len();
                blocklists.load_from_db(entries);
                if count > 0 {
                    log::info!("Loaded {} blocklists from database", count);
                }
            }
            Err(e) => log::warn!("Failed to load blocklists: {}", e),
        }

        // Start DB writer
        let db_writer = Arc::new(DbWriter::start(db.clone()));

        // Initialize enricher
        let enricher = match Enricher::new(resource_path) {
            Ok(e) => {
                log::info!("Enricher loaded (ASN database)");
                Arc::new(Mutex::new(e))
            }
            Err(e) => {
                log::warn!("Enricher not available: {}", e);
                Arc::new(Mutex::new(Enricher::empty()))
            }
        };

        // Create tokio runtime
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .worker_threads(2)
            .build()
            .map_err(|e| format!("Failed to create runtime: {}", e))?;

        Ok(Self {
            running: Arc::new(AtomicBool::new(false)),
            store: Arc::new(Mutex::new(ConnectionState::new())),
            blocklists,
            db,
            db_writer,
            enricher,
            dns_mapping: Arc::new(RwLock::new(DnsMapping::new())),
            runtime,
        })
    }

    /// Start the network capture loop (netstat polling fallback).
    pub fn start_capture(&self, geoip_path: &str) {
        if self.running.load(Ordering::SeqCst) {
            return;
        }

        let geoip = match GeoIp::new(std::path::Path::new(geoip_path)) {
            Ok(g) => Arc::new(g),
            Err(e) => {
                log::error!("Failed to load GeoIP: {}", e);
                return;
            }
        };

        let dns = Arc::new(DnsCache::new());
        let running = self.running.clone();
        let store = self.store.clone();
        let db_writer = self.db_writer.clone();
        let blocklists = self.blocklists.clone();
        let enricher = self.enricher.clone();
        let dns_mapping = self.dns_mapping.clone();

        self.runtime.spawn(async move {
            capture::nettop::start_capture(
                store, geoip, dns, running, Arc::new(AtomicBool::new(false)),
                db_writer, blocklists, enricher, dns_mapping,
            ).await;
        });
    }

    pub fn stop_capture(&self) {
        self.running.store(false, Ordering::SeqCst);
    }

    /// Get current connections as JSON.
    pub fn get_connections_json(&self) -> String {
        let store = self.store.lock().unwrap();
        let snapshot = capture::types::CaptureSnapshot {
            connections: store.connections.values().cloned().collect(),
            total_ever: store.total_ever,
        };
        serde_json::to_string(&snapshot).unwrap_or_else(|_| "{}".into())
    }

    /// Get DNS log as JSON.
    pub fn get_dns_log_json(&self) -> String {
        let mapping = self.runtime.block_on(async {
            self.dns_mapping.read().await.recent_log(200)
        });
        serde_json::to_string(&mapping).unwrap_or_else(|_| "[]".into())
    }

    /// Get DNS stats as JSON.
    pub fn get_dns_stats_json(&self) -> String {
        let stats = self.runtime.block_on(async {
            self.dns_mapping.read().await.stats()
        });
        serde_json::to_string(&stats).unwrap_or_else(|_| "{}".into())
    }

    /// Get blocklists as JSON.
    pub fn get_blocklists_json(&self) -> String {
        let lists = self.blocklists.get_all();
        serde_json::to_string(&lists).unwrap_or_else(|_| "[]".into())
    }

    /// Add a blocklist from URL. Returns the info JSON.
    pub fn add_blocklist_url(&self, url: &str, name: &str) -> String {
        let url = url.to_string();
        let name = name.to_string();
        let blocklists = self.blocklists.clone();
        let db = self.db.clone();

        let result = self.runtime.block_on(async {
            let response = reqwest::get(&url).await.map_err(|e| e.to_string())?;
            let content = response.text().await.map_err(|e| e.to_string())?;
            let (info, domains) = blocklists.add(name, url, &content);
            let _ = db.save_blocklist(&info, &domains);
            Ok::<_, String>(serde_json::to_string(&info).unwrap_or_default())
        });

        match result {
            Ok(json) => json,
            Err(e) => format!("{{\"error\":\"{}\"}}", e),
        }
    }

    /// Get tracker stats as JSON.
    pub fn get_tracker_stats_json(&self) -> String {
        match self.db.get_tracker_stats() {
            Ok(stats) => serde_json::to_string(&stats).unwrap_or_else(|_| "{}".into()),
            Err(_) => "{}".into(),
        }
    }

    /// Get bandwidth counters.
    pub fn get_bandwidth_json(&self) -> String {
        // Quick sync netstat -ib call
        let output = std::process::Command::new("netstat")
            .args(["-ib"])
            .output();

        match output {
            Ok(o) => {
                let stdout = String::from_utf8_lossy(&o.stdout);
                let mut total_in: u64 = 0;
                let mut total_out: u64 = 0;
                for line in stdout.lines() {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 10
                        && (parts[0].starts_with("en") || parts[0].starts_with("utun"))
                        && parts[2].starts_with("<Link")
                    {
                        if let (Ok(ib), Ok(ob)) = (parts[6].parse::<u64>(), parts[9].parse::<u64>()) {
                            total_in += ib;
                            total_out += ob;
                        }
                    }
                }
                format!("{{\"bytes_in\":{},\"bytes_out\":{}}}", total_in, total_out)
            }
            Err(_) => "{\"bytes_in\":0,\"bytes_out\":0}".into(),
        }
    }
}
