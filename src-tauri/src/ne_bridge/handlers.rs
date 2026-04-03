use crate::blocklist::BlocklistStore;
use crate::capture::nettop::ConnectionStore;
use crate::capture::types::{Protocol, ResolvedConnection};
use crate::db_writer::{DbMessage, DbWriter};
use crate::dns_capture::SharedDnsMapping;
use crate::enrichment::Enricher;
use crate::geoip::GeoIp;
use std::sync::Arc;
use tauri::Emitter;
use uuid::Uuid;

use super::types::{NEConnectionEvent, NEDnsEvent, NEFlowUpdate, NEListeningPort};

/// Process a DNS query event from the NE DNS proxy.
/// Feeds into the shared DnsMapping (same as Phase 1 pcap) but with process attribution.
/// Returns a list of blocked IPs if the domain was blocked and had response IPs.
pub(super) async fn process_ne_dns(
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
pub(super) async fn process_ne_connection(
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
pub(super) async fn process_ne_flow_update(
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
pub(super) async fn process_ne_listening_ports(
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
pub(super) fn resolve_app_name(bundle_id: &str) -> String {
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
    // "com.google.Chrome" -> "Chrome"
    // "com.apple.mDNSResponder" -> "mDNSResponder"
    // "com.1password.1password" -> "1Password"
    let last = bundle_id.split('.').last().unwrap_or(bundle_id);
    // Capitalize first letter
    let mut chars = last.chars();
    match chars.next() {
        None => bundle_id.to_string(),
        Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
    }
}
