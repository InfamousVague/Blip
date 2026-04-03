pub mod types;
mod handlers;

use crate::blocklist::BlocklistStore;
use crate::capture::nettop::ConnectionStore;
use crate::capture::types::{Protocol, ResolvedConnection};
use crate::db::Database;
use crate::db_writer::{DbMessage, DbWriter};
use crate::dns_capture::SharedDnsMapping;
use crate::enrichment::Enricher;
use crate::geoip::GeoIp;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Emitter;
use tauri_plugin_notification::NotificationExt;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
use tokio::sync::broadcast;
use types::{NEConnectionEvent, NEDnsEvent, NEEvent, NEFlowUpdate, NEListeningPort};
use uuid::Uuid;

/// Messages sent from the app to connected NE clients.
#[derive(Clone, Debug)]
enum NEOutboundMsg {
    BlockedIPs(Vec<String>),
    FirewallConfig(serde_json::Value),
    DnsCacheUpdate(std::collections::HashMap<String, String>),
    KillSwitch(bool),
    ApprovalVerdict { request_id: String, action: String },
}

/// Handle for sending messages to connected NE clients from outside the bridge.
#[derive(Clone)]
pub struct NEBroadcast {
    tx: broadcast::Sender<NEOutboundMsg>,
}

impl NEBroadcast {
    /// Broadcast a full firewall config update to all connected NE clients.
    pub fn send_firewall_config(&self, config: serde_json::Value) {
        let _ = self.tx.send(NEOutboundMsg::FirewallConfig(config));
    }

    /// Broadcast a kill switch state change.
    pub fn send_kill_switch(&self, active: bool) {
        let _ = self.tx.send(NEOutboundMsg::KillSwitch(active));
    }
}

/// Manages the Unix domain socket server that receives events from the Network Extension.
pub struct NEBridge {
    socket_path: PathBuf,
}

impl NEBridge {
    pub fn new() -> Self {
        let socket_path = std::path::PathBuf::from("/private/var/tmp/blip-ne.sock");
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
        db: Arc<Database>,
        app_handle: tauri::AppHandle,
    ) -> Result<NEBroadcast, String> {
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

        // Broadcast channel for sending messages to all connected NE clients
        let (outbound_tx, _) = broadcast::channel::<NEOutboundMsg>(64);
        let broadcast_handle = NEBroadcast { tx: outbound_tx.clone() };

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
                        let db = db.clone();
                        let app_handle = app_handle.clone();
                        let outbound_tx = outbound_tx.clone();
                        let mut outbound_rx = outbound_tx.subscribe();

                        tokio::spawn(async move {
                            let (read_half, mut write_half) = stream.into_split();

                            // Track whether we receive ne_hello from this NE client
                            let ne_hello_received = Arc::new(std::sync::atomic::AtomicBool::new(false));
                            {
                                let hello_flag = ne_hello_received.clone();
                                let ah = app_handle.clone();
                                tokio::spawn(async move {
                                    // If no ne_hello arrives within 5 seconds, NE is outdated
                                    tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                                    if !hello_flag.load(std::sync::atomic::Ordering::Relaxed) {
                                        log::warn!("NE did not send ne_hello — likely outdated version");
                                        let _ = ah.emit("ne-version-mismatch", serde_json::json!({
                                            "expected": "2.0.0",
                                            "actual": "legacy (no hello)",
                                        }));
                                    }
                                });
                            }

                            // Send full firewall config to NE on connect
                            {
                                let profile_id = db.get_active_profile_id();
                                let mode = db.get_preference("firewall_mode")
                                    .ok().flatten().unwrap_or_else(|| "ask".to_string());
                                let kill_switch = db.get_preference("kill_switch_active")
                                    .ok().flatten().map(|v| v == "true").unwrap_or(false);

                                let rules = db.get_all_rules_for_ne(&profile_id).unwrap_or_default();

                                let config_msg = serde_json::json!({
                                    "type": "firewall_config",
                                    "mode": mode,
                                    "kill_switch": kill_switch,
                                    "active_profile_id": profile_id,
                                    "rules": rules
                                });
                                let mut bytes = serde_json::to_vec(&config_msg).unwrap_or_default();
                                bytes.push(b'\n');
                                let _ = write_half.write_all(&bytes).await;
                                log::info!("Sent firewall config to NE: mode={}, {} rules, kill_switch={}",
                                    mode, rules.len(), kill_switch);

                                // Also send DNS cache to NE
                                if let Ok(mapping) = dns_mapping.try_read() {
                                    let ip_to_domain = mapping.get_ip_domain_mappings();
                                    if !ip_to_domain.is_empty() {
                                        let dns_msg = serde_json::json!({
                                            "type": "dns_cache_update",
                                            "mappings": ip_to_domain
                                        });
                                        let mut dns_bytes = serde_json::to_vec(&dns_msg).unwrap_or_default();
                                        dns_bytes.push(b'\n');
                                        let _ = write_half.write_all(&dns_bytes).await;
                                        log::info!("Sent {} DNS cache entries to NE", ip_to_domain.len());
                                    }
                                }
                            }

                            // Send blocklist to NE in chunks to avoid freezing
                            {
                                let all_domains: Vec<String> = blocklists.all_blocked_domains();
                                if !all_domains.is_empty() {
                                    let total = all_domains.len();
                                    const CHUNK_SIZE: usize = 50_000;
                                    let mut sent = 0usize;
                                    for chunk in all_domains.chunks(CHUNK_SIZE) {
                                        let sync_msg = serde_json::json!({
                                            "type": "blocklist_sync",
                                            "domains": chunk
                                        });
                                        let mut msg_bytes = serde_json::to_vec(&sync_msg).unwrap_or_default();
                                        msg_bytes.push(b'\n');
                                        if let Err(e) = write_half.write_all(&msg_bytes).await {
                                            log::warn!("Failed to send blocklist chunk to NE: {}", e);
                                            break;
                                        }
                                        sent += chunk.len();
                                        // Yield between chunks to avoid blocking the runtime
                                        tokio::task::yield_now().await;
                                    }
                                    log::info!("Sent {} blocked domains to NE in {} chunks", sent, (total + CHUNK_SIZE - 1) / CHUNK_SIZE);
                                }
                            }

                            // Split write_half into Arc<Mutex> so both reader and outbound forwarder can use it
                            let write_half = Arc::new(tokio::sync::Mutex::new(write_half));
                            let write_for_outbound = write_half.clone();

                            // Spawn outbound forwarder — sends messages to this NE client
                            let outbound_task = tokio::spawn(async move {
                                while let Ok(msg) = outbound_rx.recv().await {
                                    let json_msg = match msg {
                                        NEOutboundMsg::BlockedIPs(ips) => serde_json::json!({
                                            "type": "blocked_ips",
                                            "ips": ips
                                        }),
                                        NEOutboundMsg::FirewallConfig(config) => config,
                                        NEOutboundMsg::DnsCacheUpdate(mappings) => serde_json::json!({
                                            "type": "dns_cache_update",
                                            "mappings": mappings
                                        }),
                                        NEOutboundMsg::KillSwitch(active) => serde_json::json!({
                                            "type": "kill_switch",
                                            "active": active
                                        }),
                                        NEOutboundMsg::ApprovalVerdict { request_id, action } => serde_json::json!({
                                            "type": "approval_verdict",
                                            "request_id": request_id,
                                            "action": action
                                        }),
                                    };
                                    let mut bytes = serde_json::to_vec(&json_msg).unwrap_or_default();
                                    bytes.push(b'\n');
                                    let mut w = write_for_outbound.lock().await;
                                    if let Err(e) = w.write_all(&bytes).await {
                                        log::debug!("Outbound write failed: {}", e);
                                        break;
                                    }
                                }
                            });

                            let reader = BufReader::new(read_half);
                            let mut lines = reader.lines();

                            while let Ok(Some(line)) = lines.next_line().await {
                                match serde_json::from_str::<NEEvent>(&line) {
                                    Ok(event) => match event.type_.as_str() {
                                        "connection" => {
                                            if let Some(conn_event) = event.connection {
                                                // Track app for firewall sidebar auto-discovery
                                                let app_id = conn_event.source_app_id.clone();
                                                let is_apple = app_id.starts_with("com.apple.");
                                                // Derive display name from bundle ID
                                                let app_name = resolve_app_name(&app_id);
                                                let is_new_app = db.upsert_app_connection(
                                                    &app_id,
                                                    &app_name,
                                                    None,
                                                    is_apple,
                                                ).unwrap_or(false);

                                                // Emit alert event for new apps when in alert mode
                                                if is_new_app {
                                                    if let Ok(Some(mode)) = db.get_preference("firewall_mode") {
                                                        if mode == "alert" {
                                                            let _ = app_handle.emit("firewall-new-app", serde_json::json!({
                                                                "app_id": &app_id,
                                                                "dest_ip": &conn_event.dest_ip,
                                                                "dest_port": conn_event.dest_port,
                                                                "protocol": &conn_event.protocol,
                                                            }));

                                                            // Dispatch macOS notification
                                                            let display_name = {
                                                                let last = app_id.split('.').last().unwrap_or(&app_id);
                                                                let mut c = last.chars();
                                                                match c.next() {
                                                                    None => app_id.clone(),
                                                                    Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                                                                }
                                                            };
                                                            let _ = app_handle.notification()
                                                                .builder()
                                                                .title("New Connection Request")
                                                                .body(format!(
                                                                    "{} → {}:{} ({})",
                                                                    display_name,
                                                                    conn_event.dest_ip,
                                                                    conn_event.dest_port,
                                                                    conn_event.protocol.to_uppercase()
                                                                ))
                                                                .show();
                                                        }
                                                    }
                                                }

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
                                                // Capture response IPs for DNS cache update before processing
                                                let response_ips = dns_event.response_ips.clone();
                                                let domain_for_cache = dns_event.domain.clone();

                                                let new_blocked_ips = process_ne_dns(
                                                    dns_event,
                                                    &dns_mapping,
                                                    &blocklists,
                                                    &db_writer,
                                                )
                                                .await;

                                                // If DNS resolution revealed blocked IPs, broadcast to all NE clients
                                                if !new_blocked_ips.is_empty() {
                                                    let _ = outbound_tx.send(NEOutboundMsg::BlockedIPs(new_blocked_ips));
                                                }

                                                // Forward DNS cache update to NE for domain-based rule matching
                                                if !response_ips.is_empty() {
                                                    let mappings: std::collections::HashMap<String, String> = response_ips
                                                        .iter()
                                                        .map(|ip| (ip.clone(), domain_for_cache.clone()))
                                                        .collect();
                                                    let _ = outbound_tx.send(NEOutboundMsg::DnsCacheUpdate(mappings));
                                                }
                                            }
                                        }
                                        "flow_update" => {
                                            if let Some(flow) = event.flow_update {
                                                process_ne_flow_update(flow, &store).await;
                                            }
                                        }
                                        "approval_request" => {
                                            // Forward approval request to frontend
                                            if let Some(request) = event.approval_request {
                                                let _ = app_handle.emit("firewall-approval-request", request);

                                                // Also show macOS notification
                                                let app_id = event.approval_request_app_id.as_deref().unwrap_or("Unknown");
                                                let domain = event.approval_request_domain.as_deref().unwrap_or("unknown");
                                                let display_name = {
                                                    let last = app_id.split('.').last().unwrap_or(app_id);
                                                    let mut c = last.chars();
                                                    match c.next() {
                                                        None => app_id.to_string(),
                                                        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                                                    }
                                                };
                                                let _ = app_handle.notification()
                                                    .builder()
                                                    .title("Connection Request")
                                                    .body(format!("{} wants to connect to {}", display_name, domain))
                                                    .show();
                                            }
                                        }
                                        "block_event" => {
                                            // Log block to history
                                            if let Some(block) = event.block_event {
                                                let _ = db.insert_block_history(
                                                    block.get("app_id").and_then(|v| v.as_str()),
                                                    block.get("domain").and_then(|v| v.as_str()),
                                                    block.get("dest_ip").and_then(|v| v.as_str()),
                                                    block.get("dest_port").and_then(|v| v.as_u64()).map(|p| p as u16),
                                                    block.get("protocol").and_then(|v| v.as_str()),
                                                    block.get("direction").and_then(|v| v.as_str()),
                                                    block.get("rule_id").and_then(|v| v.as_str()),
                                                    block.get("reason").and_then(|v| v.as_str()).unwrap_or("rule"),
                                                );
                                            }
                                        }
                                        "ne_hello" => {
                                            ne_hello_received.store(true, std::sync::atomic::Ordering::Relaxed);
                                            // NE sends version on connect — check if it matches app version
                                            let ne_version = event.ne_version.as_deref().unwrap_or("unknown");
                                            let app_version = env!("CARGO_PKG_VERSION");
                                            log::info!("NE hello: ne_version={}, app_version={}", ne_version, app_version);
                                            if ne_version != app_version && ne_version != "unknown" {
                                                log::warn!(
                                                    "NE version mismatch: app={}, ne={}",
                                                    app_version, ne_version
                                                );
                                                let _ = app_handle.emit("ne-version-mismatch", serde_json::json!({
                                                    "expected": app_version,
                                                    "actual": ne_version,
                                                }));
                                            } else {
                                                log::info!("NE version OK: {}", ne_version);
                                                let _ = db.delete_preference("ne_update_dismissed");
                                                let _ = app_handle.emit("ne-connected", serde_json::json!({
                                                    "version": ne_version,
                                                }));
                                            }
                                        }
                                        "listening_ports" => {
                                            if let Some(ports) = event.listening_ports {
                                                process_ne_listening_ports(ports, &app_handle).await;
                                            }
                                        }
                                        other => {
                                            log::debug!("Unknown NE event type: {}", other);
                                        }
                                    },
                                    Err(e) => {
                                        log::warn!("Failed to parse NE event: {} — {}", e, line);
                                    }
                                }
                            }

                            outbound_task.abort();
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

        Ok(broadcast_handle)
    }

    /// Clean up the socket file.
    pub fn cleanup(&self) {
        let _ = std::fs::remove_file(&self.socket_path);
    }
}

/// Process a DNS query event from the NE DNS proxy.
/// Feeds into the shared DnsMapping (same as Phase 1 pcap) but with process attribution.
/// Returns a list of blocked IPs if the domain was blocked and had response IPs.
async fn process_ne_dns(
    event: NEDnsEvent,
    dns_mapping: &SharedDnsMapping,
    blocklists: &BlocklistStore,
    db_writer: &DbWriter,
) -> Vec<String> {
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
        event.response_ips.clone(),
        event.timestamp_ms,
        is_blocked,
    );

    if is_blocked {
        log::debug!("NE DNS blocked: {} (by {})", event.domain, event.source_app_id);
        // Return the IPs that map to this blocked domain so the filter can .drop() them
        return event.response_ips;
    }

    Vec::new()
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

    // Forward DNS lookup from passive capture, with reverse DNS fallback
    let mut domain = dns_mapping
        .try_read()
        .ok()
        .and_then(|m| m.domain_for_ip_str(&event.dest_ip).map(String::from));

    // Fallback: reverse DNS if forward mapping didn't have it
    if domain.is_none() {
        if let Ok(addr) = event.dest_ip.parse::<std::net::IpAddr>() {
            domain = dns_lookup::lookup_addr(&addr).ok();
        }
    }

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
        let mut state = store.write().unwrap();

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

        let tracker_domain = if is_tracker { conn.domain.clone() } else { None };
        db_writer.send(DbMessage::InsertConnection(conn.clone()));
        state.mark_changed(&id);
        state.connections.insert(id, conn);
        state.total_ever += 1;

        // Track blocked domains — use the resolved domain, not the app bundle ID
        if let Some(domain) = tracker_domain {
            db_writer.send(DbMessage::UpdateTracker {
                domain,
                category: Some("tracker".to_string()),
                bytes_in: 0,
                bytes_out: 0,
                timestamp_ms: event.timestamp_ms,
            });
        }
    }
}

/// Process a flow byte update from the NE.
/// Updates bytes_sent/bytes_received on matching active connections.
async fn process_ne_flow_update(
    flow: NEFlowUpdate,
    store: &ConnectionStore,
) {
    let mut state = store.write().unwrap();
    // Find matching connection and track its ID for mark_changed
    let mut matched_id: Option<String> = None;
    for conn in state.connections.values_mut() {
        if conn.dest_ip == flow.dest_ip
            && conn.dest_port == flow.dest_port
            && conn.active
        {
            // NE sends cumulative bytes — only update if larger (handles out-of-order delivery)
            let mut changed = false;
            if flow.bytes_in > conn.bytes_received {
                conn.bytes_received = flow.bytes_in;
                changed = true;
            }
            if flow.bytes_out > conn.bytes_sent {
                conn.bytes_sent = flow.bytes_out;
                changed = true;
            }
            if changed {
                conn.last_seen_ms = flow.timestamp_ms;
                matched_id = Some(conn.id.clone());
            }

            // Also update process name from NE if more specific
            if (conn.process_name.is_none() || conn.process_name.as_deref() == Some("?"))
                && !flow.source_app_id.is_empty()
            {
                conn.process_name = Some(flow.source_app_id.clone());
            }
            break;
        }
    }
    // Mark changed outside the values_mut iterator to satisfy borrow checker
    if let Some(id) = matched_id {
        state.mark_changed(&id);
    }
}

/// Process listening ports reported by the NE and emit to frontend.
async fn process_ne_listening_ports(
    ports: Vec<NEListeningPort>,
    app_handle: &tauri::AppHandle,
) {
    let _ = app_handle.emit("ne-listening-ports", serde_json::json!({
        "ports": ports,
    }));
}

/// Resolve a display name from a bundle ID.
/// Uses mdfind (Spotlight) to locate the .app bundle and read CFBundleName from Info.plist.
/// Falls back to formatting the bundle ID into a readable name.
fn resolve_app_name(bundle_id: &str) -> String {
    // Try mdfind for fast Spotlight lookup
    if let Ok(output) = std::process::Command::new("mdfind")
        .args(["kMDItemCFBundleIdentifier", "=", bundle_id])
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(app_path) = stdout.lines().find(|l| l.ends_with(".app")) {
                // Try to read CFBundleName or CFBundleDisplayName from Info.plist
                let plist_path = format!("{}/Contents/Info.plist", app_path);
                if let Ok(name_output) = std::process::Command::new("plutil")
                    .args(["-extract", "CFBundleDisplayName", "raw", "-o", "-", &plist_path])
                    .output()
                {
                    if name_output.status.success() {
                        let name = String::from_utf8_lossy(&name_output.stdout).trim().to_string();
                        if !name.is_empty() {
                            return name;
                        }
                    }
                }
                if let Ok(name_output) = std::process::Command::new("plutil")
                    .args(["-extract", "CFBundleName", "raw", "-o", "-", &plist_path])
                    .output()
                {
                    if name_output.status.success() {
                        let name = String::from_utf8_lossy(&name_output.stdout).trim().to_string();
                        if !name.is_empty() {
                            return name;
                        }
                    }
                }
            }
        }
    }

    // Fallback: format the bundle ID into a readable name
    // "com.google.Chrome" → "Chrome"
    // "com.apple.mDNSResponder" → "mDNSResponder"
    // "com.1password.1password" → "1Password"
    let last = bundle_id.split('.').last().unwrap_or(bundle_id);
    // Capitalize first letter
    let mut chars = last.chars();
    match chars.next() {
        None => bundle_id.to_string(),
        Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
    }
}
