pub mod types;

use crate::blocklist::BlocklistStore;
use crate::capture::nettop::ConnectionStore;
use crate::capture::types::{Protocol, ResolvedConnection};
use crate::db_writer::{DbMessage, DbWriter};
use crate::dns_capture::SharedDnsMapping;
use crate::enrichment::Enricher;
use crate::geoip::GeoIp;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::net::UnixListener;
use types::{NEConnectionEvent, NEDnsEvent, NEEvent};
use uuid::Uuid;

/// Synchronous NE event processing — called from FFI when Swift passes events.
/// No GeoIP or async DNS mapping available in this path (simplified for App Group flow).
pub fn process_ne_event(
    event: &NEConnectionEvent,
    store: &ConnectionStore,
    blocklists: &BlocklistStore,
    db_writer: &DbWriter,
    enricher: &std::sync::Mutex<Enricher>,
) {
    let protocol = match event.protocol.as_str() {
        "tcp" => Protocol::Tcp,
        "udp" => Protocol::Udp,
        _ => Protocol::Other,
    };

    let id = Uuid::new_v4().to_string();

    let mut conn = ResolvedConnection {
        id: id.clone(),
        dest_ip: event.dest_ip.clone(),
        dest_port: event.dest_port,
        process_name: Some(event.source_app_id.clone()),
        protocol,
        dest_lat: 0.0,
        dest_lon: 0.0,
        domain: None,
        city: None,
        country: None,
        bytes_sent: 0,
        bytes_received: 0,
        first_seen_ms: event.timestamp_ms,
        last_seen_ms: event.timestamp_ms,
        active: true,
        ping_ms: None,
        is_tracker: false,
        tracker_category: None,
        asn: None,
        asn_org: None,
        cloud_provider: None,
        cloud_region: None,
        datacenter: None,
        is_cdn: false,
        network_type: None,
    };

    // Enrich
    if let Ok(e) = enricher.lock() {
        let enrichment = e.enrich(&conn.dest_ip);
        conn.asn = enrichment.asn;
        conn.asn_org = enrichment.asn_org;
        conn.cloud_provider = enrichment.cloud_provider;
        conn.cloud_region = enrichment.cloud_region;
        conn.datacenter = enrichment.datacenter;
        conn.is_cdn = enrichment.is_cdn;
        conn.network_type = enrichment.network_type;
    }

    // Insert
    {
        let mut state = store.lock().unwrap();
        let already_exists = state
            .connections
            .values()
            .any(|c| c.dest_ip == event.dest_ip && c.dest_port == event.dest_port && c.active);

        if already_exists {
            return;
        }

        db_writer.send(DbMessage::InsertConnection(conn.clone()));
        state.connections.insert(id, conn);
        state.total_ever += 1;
    }
}

/// Manages the Unix domain socket server that receives events from the Network Extension.
pub struct NEBridge {
    socket_path: PathBuf,
}

impl NEBridge {
    pub fn new() -> Self {
        let socket_path = dirs::home_dir()
            .unwrap_or_default()
            .join(".blip")
            .join("ne.sock");
        Self { socket_path }
    }

    /// Start listening for NE connections. Spawns a background task.
    /// The NE connects to this socket and sends JSON-line connection events.
    pub async fn start(
        &self,
        store: ConnectionStore,
        geoip: Arc<GeoIp>,
        blocklists: Arc<BlocklistStore>,
        db_writer: Arc<DbWriter>,
        dns_mapping: SharedDnsMapping,
        enricher: Arc<std::sync::Mutex<Enricher>>,
    ) -> Result<(), String> {
        // Remove stale socket file
        let _ = std::fs::remove_file(&self.socket_path);

        // Ensure directory exists
        if let Some(parent) = self.socket_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create socket dir: {}", e))?;
        }

        let listener = UnixListener::bind(&self.socket_path)
            .map_err(|e| format!("Failed to bind Unix socket at {:?}: {}", self.socket_path, e))?;

        log::info!("NE bridge listening at {:?}", self.socket_path);

        // Accept connections from the NE
        tokio::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((stream, _addr)) => {
                        log::info!("NE connected to bridge socket");
                        let store = store.clone();
                        let geoip = geoip.clone();
                        let blocklists = blocklists.clone();
                        let db_writer = db_writer.clone();
                        let dns_mapping = dns_mapping.clone();
                        let enricher = enricher.clone();

                        tokio::spawn(async move {
                            let reader = BufReader::new(stream);
                            let mut lines = reader.lines();

                            while let Ok(Some(line)) = lines.next_line().await {
                                match serde_json::from_str::<NEEvent>(&line) {
                                    Ok(event) => match event.type_.as_str() {
                                        "connection" => {
                                            if let Some(conn_event) = event.connection {
                                                process_ne_connection(
                                                    conn_event,
                                                    &store,
                                                    &geoip,
                                                    &blocklists,
                                                    &db_writer,
                                                    &dns_mapping,
                                                    &enricher,
                                                )
                                                .await;
                                            }
                                        }
                                        "dns" => {
                                            if let Some(dns_event) = event.dns {
                                                process_ne_dns(
                                                    dns_event,
                                                    &dns_mapping,
                                                    &blocklists,
                                                    &db_writer,
                                                )
                                                .await;
                                            }
                                        }
                                        other => {
                                            log::warn!("Unknown NE event type: {}", other);
                                        }
                                    },
                                    Err(e) => {
                                        log::warn!("Failed to parse NE event: {} — {}", e, line);
                                    }
                                }
                            }

                            log::info!("NE disconnected from bridge socket");
                        });
                    }
                    Err(e) => {
                        log::error!("NE bridge accept error: {}", e);
                        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                    }
                }
            }
        });

        Ok(())
    }

    /// Clean up the socket file.
    pub fn cleanup(&self) {
        let _ = std::fs::remove_file(&self.socket_path);
    }
}

/// Process a DNS query event from the NE DNS proxy.
/// Feeds into the shared DnsMapping (same as Phase 1 pcap) but with process attribution.
async fn process_ne_dns(
    event: NEDnsEvent,
    dns_mapping: &SharedDnsMapping,
    blocklists: &BlocklistStore,
    db_writer: &DbWriter,
) {
    let is_blocked = event.blocked || blocklists.is_blocked(&event.domain);
    let blocked_by = if is_blocked {
        blocklists.blocked_by(&event.domain)
    } else {
        None
    };

    // Convert to DnsEvent for the shared mapping
    let dns_event = crate::dns_capture::types::DnsEvent {
        domain: event.domain.clone(),
        ips: event.response_ips.clone(),
        query_type: event.query_type.clone(),
        ts: event.timestamp_ms,
    };

    // Update the shared DNS mapping (same store used by Phase 1 pcap and frontend)
    {
        let mut mapping = dns_mapping.write().await;
        mapping.record(&dns_event, is_blocked, blocked_by);
    }

    // Persist to database
    db_writer.send_dns_query(
        event.domain.clone(),
        event.query_type,
        event.response_ips,
        event.timestamp_ms,
        is_blocked,
    );

    if is_blocked {
        log::debug!("NE DNS blocked: {} (by {})", event.domain, event.source_app_id);
    }
}

/// Process a single connection event from the Network Extension.
async fn process_ne_connection(
    event: NEConnectionEvent,
    store: &ConnectionStore,
    geoip: &GeoIp,
    blocklists: &BlocklistStore,
    db_writer: &DbWriter,
    dns_mapping: &SharedDnsMapping,
    enricher: &std::sync::Mutex<Enricher>,
) {
    // GeoIP lookup
    let geo = geoip.lookup(&event.dest_ip);

    // Forward DNS lookup from passive capture
    let domain = dns_mapping
        .try_read()
        .ok()
        .and_then(|m| m.domain_for_ip_str(&event.dest_ip).map(String::from));

    let is_tracker = domain
        .as_ref()
        .map_or(false, |d| blocklists.is_blocked(d));

    let protocol = match event.protocol.as_str() {
        "tcp" => Protocol::Tcp,
        "udp" => Protocol::Udp,
        _ => Protocol::Other,
    };

    let id = Uuid::new_v4().to_string();

    let mut conn = ResolvedConnection {
        id: id.clone(),
        dest_ip: event.dest_ip.clone(),
        dest_port: event.dest_port,
        process_name: Some(event.source_app_id.clone()),
        protocol,
        dest_lat: geo.as_ref().map_or(0.0, |g| g.latitude),
        dest_lon: geo.as_ref().map_or(0.0, |g| g.longitude),
        domain,
        city: geo.as_ref().and_then(|g| g.city.clone()),
        country: geo.as_ref().and_then(|g| g.country.clone()),
        bytes_sent: 0,
        bytes_received: 0,
        first_seen_ms: event.timestamp_ms,
        last_seen_ms: event.timestamp_ms,
        active: true,
        ping_ms: None,
        is_tracker,
        tracker_category: if is_tracker {
            Some("tracker".to_string())
        } else {
            None
        },
        asn: None,
        asn_org: None,
        cloud_provider: None,
        cloud_region: None,
        datacenter: None,
        is_cdn: false,
        network_type: None,
    };

    // Enrich with ASN, cloud provider info
    if let Ok(e) = enricher.lock() {
        let enrichment = e.enrich(&conn.dest_ip);
        conn.asn = enrichment.asn;
        conn.asn_org = enrichment.asn_org;
        conn.cloud_provider = enrichment.cloud_provider;
        conn.cloud_region = enrichment.cloud_region;
        conn.datacenter = enrichment.datacenter;
        conn.is_cdn = enrichment.is_cdn;
        conn.network_type = enrichment.network_type;
    }

    // Insert into connection store
    {
        let mut state = store.lock().unwrap();

        // Check if we already track this IP:port (dedup with netstat)
        let _key = format!("{}:{}", event.dest_ip, event.dest_port);
        let already_exists = state
            .connections
            .values()
            .any(|c| c.dest_ip == event.dest_ip && c.dest_port == event.dest_port && c.active);

        if already_exists {
            // Update existing connection with NE's process name if we didn't have one
            for c in state.connections.values_mut() {
                if c.dest_ip == event.dest_ip && c.dest_port == event.dest_port && c.active {
                    if c.process_name.is_none() || c.process_name.as_deref() == Some("?") {
                        c.process_name = Some(event.source_app_id.clone());
                    }
                    c.last_seen_ms = event.timestamp_ms;
                    break;
                }
            }
            return;
        }

        log::info!(
            "NE: new connection {}:{} ({}) [{}, {}]",
            event.dest_ip,
            event.dest_port,
            event.source_app_id,
            conn.city.as_deref().unwrap_or("?"),
            conn.country.as_deref().unwrap_or("?")
        );

        db_writer.send(DbMessage::InsertConnection(conn.clone()));
        state.connections.insert(id, conn);
        state.total_ever += 1;
    }

    // Track blocked domains
    if is_tracker {
        db_writer.send(DbMessage::UpdateTracker {
            domain: event.source_app_id,
            category: Some("tracker".to_string()),
            bytes_in: 0,
            bytes_out: 0,
            timestamp_ms: event.timestamp_ms,
        });
    }
}
