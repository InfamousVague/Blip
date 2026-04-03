use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tokio::process::Command;
use uuid::Uuid;

use super::types::{GeoResult, Protocol, ResolvedConnection};
use crate::blocklist::BlocklistStore;
use crate::db_writer::{DbMessage, DbWriter};
use crate::dns::DnsCache;
use crate::dns_capture::SharedDnsMapping;
use crate::geoip::GeoIp;

/// Key for tracking unique connections
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct ConnKey {
    dest_ip: String,
    dest_port: u16,
}

/// Shared connection state that the frontend can poll
pub type ConnectionStore = Arc<std::sync::Mutex<ConnectionState>>;

pub struct ConnectionState {
    pub connections: HashMap<String, ResolvedConnection>,
    pub total_ever: usize,
    id_map: HashMap<ConnKey, String>,
    /// Process names learned from lsof, keyed by dest_ip:dest_port
    process_cache: HashMap<ConnKey, String>,
}

impl ConnectionState {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
            total_ever: 0,
            id_map: HashMap::new(),
            process_cache: HashMap::new(),
        }
    }
}

pub async fn start_capture(
    store: ConnectionStore,
    geoip: Arc<GeoIp>,
    dns: Arc<DnsCache>,
    running: Arc<AtomicBool>,
    elevated: Arc<AtomicBool>,
    db_writer: Arc<DbWriter>,
    blocklists: Arc<BlocklistStore>,
    enricher: Arc<std::sync::Mutex<crate::enrichment::Enricher>>,
    dns_mapping: SharedDnsMapping,
) {
    running.store(true, Ordering::SeqCst);

    let mut lsof_tick = 0u32;

    while running.load(Ordering::SeqCst) {
        let t0 = std::time::Instant::now();

        // Layer 1: Fast netstat scan (~6ms) — catches connections by IP:port
        let netstat_connections = snapshot_netstat().await;
        let netstat_ms = t0.elapsed().as_millis();

        // Layer 2: Slow lsof scan every 4th cycle (~every 1s) — enriches with process names
        let is_elevated = elevated.load(Ordering::SeqCst);
        lsof_tick += 1;
        if lsof_tick % 4 == 0 {
            let lsof_processes = snapshot_lsof_processes(is_elevated).await;
            let mut state = store.lock().unwrap();
            for (key, process) in lsof_processes {
                state.process_cache.insert(key, process);
            }
        }

        let now = now_ms();
        let mut current_keys = HashSet::new();

        // Collect new connections outside the lock
        let mut new_connections: Vec<(ConnKey, String, GeoResult, Option<String>)> = Vec::new();
        {
            let state = store.lock().unwrap();
            for key in &netstat_connections {
                current_keys.insert(key.clone());
                if !state.id_map.contains_key(key) {
                    if let Some(geo) = geoip.lookup(&key.dest_ip) {
                        let id = Uuid::new_v4().to_string();
                        let process = state.process_cache.get(key).cloned();
                        new_connections.push((key.clone(), id, geo, process));
                    }
                }
            }
        }

        // Insert new + update existing with brief lock
        {
            let mut state = store.lock().unwrap();

            // Update existing
            for key in &netstat_connections {
                if let Some(id) = state.id_map.get(key).cloned() {
                    // Get process name from cache before mutable borrow
                    let cached_proc = state.process_cache.get(key).cloned();
                    if let Some(conn) = state.connections.get_mut(&id) {
                        conn.last_seen_ms = now;
                        conn.active = true;
                        if conn.process_name.is_none() {
                            conn.process_name = cached_proc;
                        }
                    }
                }
            }

            // Insert new
            for (key, id, geo, process) in new_connections {
                log::info!(
                    "New connection: {}:{} ({}) [{}, {}] [total: {}]",
                    key.dest_ip, key.dest_port,
                    process.as_deref().unwrap_or("?"),
                    geo.city.as_deref().unwrap_or("?"),
                    geo.country.as_deref().unwrap_or("?"),
                    state.total_ever + 1
                );
                // Check forward DNS mapping (from passive DNS capture) before falling back to reverse DNS
                let forward_domain = dns_mapping
                    .try_read()
                    .ok()
                    .and_then(|m| m.domain_for_ip_str(&key.dest_ip).map(String::from));

                let is_tracker_from_dns = forward_domain
                    .as_ref()
                    .map_or(false, |d| blocklists.is_blocked(d));

                let mut conn = ResolvedConnection {
                    id: id.clone(),
                    dest_ip: key.dest_ip.clone(),
                    dest_port: key.dest_port,
                    process_name: process,
                    protocol: Protocol::Tcp,
                    dest_lat: geo.latitude,
                    dest_lon: geo.longitude,
                    domain: forward_domain,
                    city: geo.city,
                    country: geo.country,
                    bytes_sent: 0,
                    bytes_received: 0,
                    first_seen_ms: now,
                    last_seen_ms: now,
                    active: true,
                    ping_ms: None,
                    is_tracker: is_tracker_from_dns,
                    tracker_category: if is_tracker_from_dns { Some("tracker".to_string()) } else { None },
                    asn: None,
                    asn_org: None,
                    cloud_provider: None,
                    cloud_region: None,
                    datacenter: None,
                    is_cdn: false,
                    network_type: None,
                };

                // Enrich with ASN, cloud provider, datacenter info
                if let Ok(e) = enricher.lock() {
                    let enrichment = e.enrich(&conn.dest_ip);
                    conn = ResolvedConnection {
                        asn: enrichment.asn,
                        asn_org: enrichment.asn_org,
                        cloud_provider: enrichment.cloud_provider,
                        cloud_region: enrichment.cloud_region,
                        datacenter: enrichment.datacenter,
                        is_cdn: enrichment.is_cdn,
                        network_type: enrichment.network_type,
                        ..conn
                    };
                }

                state.id_map.insert(key, id.clone());
                db_writer.send(DbMessage::InsertConnection(conn.clone()));
                state.connections.insert(id, conn);
                state.total_ever += 1;
            }

            // Mark closed connections
            let stale_keys: Vec<ConnKey> = state
                .id_map
                .keys()
                .filter(|k| !current_keys.contains(*k))
                .cloned()
                .collect();

            for key in stale_keys {
                if let Some(id) = state.id_map.get(&key).cloned() {
                    if let Some(conn) = state.connections.get_mut(&id) {
                        if conn.active {
                            conn.active = false;
                            conn.last_seen_ms = now;
                        }
                    }
                }
            }

            // Remove expired (inactive > 30s)
            let expired: Vec<String> = state
                .connections
                .iter()
                .filter(|(_, c)| !c.active && now - c.last_seen_ms > 30_000)
                .map(|(id, _)| id.clone())
                .collect();
            for id in &expired {
                state.connections.remove(id);
            }
            state.id_map.retain(|_, id| !expired.contains(id));
        }

        // Use forward DNS mapping to upgrade domains and detect trackers
        // This catches connections where reverse DNS returned a CDN hostname
        // but we know the real domain from passive DNS capture
        {
            if let Ok(mapping) = dns_mapping.try_read() {
                let mut state = store.lock().unwrap();
                let ids: Vec<String> = state.connections.keys().cloned().collect();
                for id in ids {
                    if let Some(conn) = state.connections.get_mut(&id) {
                        if !conn.is_tracker && conn.active {
                            if let Some(fwd_domain) = mapping.domain_for_ip_str(&conn.dest_ip) {
                                let fwd_owned = fwd_domain.to_string();
                                // Upgrade domain if forward DNS gives a better answer
                                if conn.domain.is_none()
                                    || conn.domain.as_deref() != Some(fwd_domain)
                                {
                                    conn.domain = Some(fwd_owned.clone());
                                }
                                if blocklists.is_blocked(&fwd_owned) {
                                    conn.is_tracker = true;
                                    conn.tracker_category = Some("tracker".to_string());
                                    db_writer.send(DbMessage::UpdateTracker {
                                        domain: fwd_owned,
                                        category: Some("tracker".to_string()),
                                        bytes_in: conn.bytes_received,
                                        bytes_out: conn.bytes_sent,
                                        timestamp_ms: now,
                                    });
                                    db_writer.send(DbMessage::InsertConnection(conn.clone()));
                                }
                            }
                        }
                    }
                }
            }
        }

        // Resolve DNS in background for connections still without a domain
        {
            let state = store.lock().unwrap();
            let needs_dns: Vec<(String, String)> = state
                .connections
                .iter()
                .filter(|(_, c)| c.domain.is_none() && c.active)
                .map(|(id, c)| (id.clone(), c.dest_ip.clone()))
                .collect();
            drop(state);

            for (id, ip) in needs_dns {
                let dns = dns.clone();
                let store = store.clone();
                let blocklists = blocklists.clone();
                let db_writer = db_writer.clone();
                tokio::task::spawn_blocking(move || {
                    if let Some(domain) = dns.lookup(&ip) {
                        let is_blocked = blocklists.is_blocked(&domain);
                        if let Ok(mut state) = store.lock() {
                            if let Some(conn) = state.connections.get_mut(&id) {
                                conn.domain = Some(domain.clone());
                                if is_blocked {
                                    conn.is_tracker = true;
                                    conn.tracker_category = Some("tracker".to_string());
                                    let now = std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap()
                                        .as_millis() as u64;
                                    db_writer.send(DbMessage::UpdateTracker {
                                        domain: domain.clone(),
                                        category: Some("tracker".to_string()),
                                        bytes_in: conn.bytes_received,
                                        bytes_out: conn.bytes_sent,
                                        timestamp_ms: now,
                                    });
                                }
                                // Send updated connection to DB
                                db_writer.send(DbMessage::InsertConnection(conn.clone()));
                            }
                        }
                    }
                });
            }
        }

        // Measure ping (TCP connect time) for connections that don't have it yet
        {
            let state = store.lock().unwrap();
            let needs_ping: Vec<(String, String, u16)> = state
                .connections
                .iter()
                .filter(|(_, c)| c.ping_ms.is_none() && c.active)
                .map(|(id, c)| (id.clone(), c.dest_ip.clone(), c.dest_port))
                .collect();
            drop(state);

            for (id, ip, port) in needs_ping {
                let store = store.clone();
                tokio::spawn(async move {
                    let addr = format!("{}:{}", ip, port);
                    if let Ok(addr) = addr.parse::<std::net::SocketAddr>() {
                        let start = std::time::Instant::now();
                        let timeout = tokio::time::Duration::from_millis(2000);
                        if let Ok(Ok(_)) = tokio::time::timeout(
                            timeout,
                            tokio::net::TcpStream::connect(addr),
                        ).await {
                            let ms = start.elapsed().as_secs_f64() * 1000.0;
                            if let Ok(mut state) = store.lock() {
                                if let Some(conn) = state.connections.get_mut(&id) {
                                    conn.ping_ms = Some((ms * 10.0).round() / 10.0);
                                }
                            }
                        }
                    }
                });
            }
        }

        log::debug!(
            "Capture cycle: netstat={}ms, {} connections seen",
            netstat_ms,
            netstat_connections.len()
        );

        // Poll every 250ms — netstat is fast enough for this
        tokio::time::sleep(tokio::time::Duration::from_millis(250)).await;
    }

    log::info!("Capture loop stopped");
}

/// Layer 1: Fast netstat scan — returns unique dest ip:port pairs
/// `netstat -an -p tcp` runs in ~6ms and shows ALL connection states
async fn snapshot_netstat() -> Vec<ConnKey> {
    let mut result = Vec::new();

    // Get TCP connections
    let tcp = Command::new("netstat")
        .args(["-an", "-p", "tcp"])
        .output()
        .await;

    // Get UDP connections
    let udp = Command::new("netstat")
        .args(["-an", "-p", "udp"])
        .output()
        .await;

    for output in [tcp, udp] {
        let output = match output {
            Ok(o) => o,
            Err(_) => continue,
        };

        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            // Skip headers
            if line.starts_with("Active") || line.starts_with("Proto") || line.trim().is_empty() {
                continue;
            }

            // Format: Proto Recv-Q Send-Q Local Foreign State
            // tcp4       0      0  192.168.18.55.53890    34.149.66.137.443      ESTABLISHED
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 5 {
                continue;
            }

            let foreign = parts[4];

            // Parse foreign address — macOS uses dot separator: ip.port
            // IPv4: 192.168.18.55.443 → ip=192.168.18.55, port=443
            // IPv6: fe80::1.443 → skip for now
            // *.* means listening — skip
            if foreign == "*.*" || foreign.starts_with("*") {
                continue;
            }

            let (dest_ip, dest_port) = parse_netstat_addr(foreign);
            if dest_ip.is_empty() || dest_port == 0 {
                continue;
            }

            // Skip non-routable
            if dest_ip == "127.0.0.1"
                || dest_ip == "::1"
                || dest_ip == "0.0.0.0"
                || dest_ip.starts_with("fe80:")
                || dest_ip.starts_with("10.")
                || dest_ip.starts_with("192.168.")
                || dest_ip == "*"
            {
                continue;
            }
            if dest_ip.starts_with("172.") {
                if let Some(second) = dest_ip.split('.').nth(1) {
                    if let Ok(n) = second.parse::<u8>() {
                        if (16..=31).contains(&n) {
                            continue;
                        }
                    }
                }
            }

            result.push(ConnKey { dest_ip, dest_port });
        }
    }

    // Deduplicate
    result.sort_by(|a, b| a.dest_ip.cmp(&b.dest_ip).then(a.dest_port.cmp(&b.dest_port)));
    result.dedup();
    result
}

/// Parse macOS netstat foreign address format: "1.2.3.4.443" → ("1.2.3.4", 443)
fn parse_netstat_addr(addr: &str) -> (String, u16) {
    // The last dot-separated component is the port
    // But IPv4 addresses also use dots, so we need the LAST dot
    if let Some(last_dot) = addr.rfind('.') {
        let port_str = &addr[last_dot + 1..];
        let ip = &addr[..last_dot];

        if let Ok(port) = port_str.parse::<u16>() {
            // Validate this looks like an IP
            if ip.contains('.') || ip.contains(':') {
                return (ip.to_string(), port);
            }
        }
    }
    (String::new(), 0)
}

/// Layer 2: Slower lsof scan — returns process names keyed by dest ip:port
/// When elevated, uses `sudo -n` (non-interactive) which uses cached credentials.
/// The credentials are cached by the initial osascript elevation prompt in request_elevation.
async fn snapshot_lsof_processes(elevated: bool) -> HashMap<ConnKey, String> {
    let mut result = HashMap::new();

    let output = if elevated {
        // Try sudo -n (non-interactive) first — uses cached sudo credentials
        match Command::new("sudo")
            .args(["-n", "lsof", "-i", "-n", "-P", "+c", "0"])
            .output()
            .await
        {
            Ok(o) if o.status.success() => o,
            _ => {
                // sudo credentials expired or failed — fall back to unprivileged
                log::debug!("sudo -n lsof failed, using unprivileged lsof");
                match Command::new("lsof").args(["-i", "-n", "-P", "+c", "0"]).output().await {
                    Ok(o) => o,
                    Err(_) => return result,
                }
            }
        }
    } else {
        match Command::new("lsof")
            .args(["-i", "-n", "-P", "+c", "0"])
            .output()
            .await
        {
            Ok(o) => o,
            Err(_) => return result,
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if line.starts_with("COMMAND") {
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 9 {
            continue;
        }

        let command = parts[0];

        let name = match parts.iter().find(|p| p.contains("->")) {
            Some(n) => *n,
            None => continue,
        };

        let arrow_parts: Vec<&str> = name.split("->").collect();
        if arrow_parts.len() != 2 {
            continue;
        }

        let remote = arrow_parts[1].split(' ').next().unwrap_or(arrow_parts[1]);

        let (dest_ip, dest_port) = if remote.starts_with('[') {
            if let Some(bracket_end) = remote.find(']') {
                let ip = &remote[1..bracket_end];
                let port_str = remote.get(bracket_end + 2..).unwrap_or("0");
                (ip.to_string(), port_str.parse::<u16>().unwrap_or(0))
            } else {
                continue;
            }
        } else if let Some(colon_pos) = remote.rfind(':') {
            let ip = &remote[..colon_pos];
            let port_str = &remote[colon_pos + 1..];
            (ip.to_string(), port_str.parse::<u16>().unwrap_or(0))
        } else {
            continue;
        };

        if dest_port == 0 {
            continue;
        }

        result.insert(
            ConnKey { dest_ip, dest_port },
            command.to_string(),
        );
    }

    result
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}
