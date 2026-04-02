//! Traceroute engine: run traceroute to destinations, geolocate hops, cache results.

use crate::capture::nettop::ConnectionStore;
use crate::db::Database;
use crate::enrichment::Enricher;
use crate::geoip::GeoIp;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock as StdRwLock};
use tokio::process::Command;

/// A single hop in a traceroute
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TracerouteHop {
    pub hop_number: u8,
    pub ip: Option<String>,
    pub rtt_ms: Option<f64>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub city: Option<String>,
    pub country: Option<String>,
    pub asn: Option<u32>,
    pub asn_org: Option<String>,
}

/// A complete traced route to a destination
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TracedRoute {
    pub dest_ip: String,
    pub hops: Vec<TracerouteHop>,
    pub traced_at: u64, // epoch ms
}

/// Raw parsed hop before geolocation
pub struct RawHop {
    hop_number: u8,
    ip: Option<String>,
    rtt_ms: Option<f64>,
}

/// Run traceroute to a destination IP and return raw hops.
/// Uses UDP mode (macOS default, no root required).
/// -n: no DNS, -m 30: max 30 hops, -w 2: 2s timeout, -q 1: 1 probe per hop
pub async fn run_traceroute(dest_ip: &str) -> Result<Vec<RawHop>, String> {
    let output = Command::new("traceroute")
        .args(["-n", "-m", "30", "-w", "2", "-q", "1", dest_ip])
        .output()
        .await
        .map_err(|e| format!("Failed to run traceroute: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_traceroute_output(&stdout))
}

/// Parse traceroute output into raw hops.
/// Format: " 1  192.168.1.1  1.234 ms" or " 2  * * *"
fn parse_traceroute_output(stdout: &str) -> Vec<RawHop> {
    // Match: hop_number, optional IP, optional RTT
    // Examples:
    //   " 1  192.168.1.1  1.234 ms"
    //   " 2  10.0.0.1  5.678 ms"
    //   " 3  * * *"
    //   " 4  1.2.3.4 (1.2.3.4)  12.345 ms"
    let hop_re = Regex::new(r"^\s*(\d+)\s+(.+)$").unwrap();
    let ip_re = Regex::new(r"(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})").unwrap();
    let rtt_re = Regex::new(r"([\d.]+)\s*ms").unwrap();

    let mut hops = Vec::new();

    for line in stdout.lines() {
        // Skip header line "traceroute to..."
        if line.starts_with("traceroute") || line.trim().is_empty() {
            continue;
        }

        if let Some(cap) = hop_re.captures(line) {
            let hop_number: u8 = match cap[1].parse() {
                Ok(n) => n,
                Err(_) => continue,
            };
            let rest = &cap[2];

            // Check for timeout (all asterisks)
            if rest.contains('*') && !ip_re.is_match(rest) {
                // Timed out hop — skip (interpolate later)
                continue;
            }

            let ip = ip_re.captures(rest).map(|c| c[1].to_string());
            let rtt_ms = rtt_re.captures(rest).and_then(|c| c[1].parse::<f64>().ok());

            if ip.is_some() {
                hops.push(RawHop {
                    hop_number,
                    ip,
                    rtt_ms,
                });
            }
        }
    }

    hops
}

/// Geolocate and enrich raw hops with lat/lon, city, country, ASN.
fn geolocate_hops(
    raw_hops: Vec<RawHop>,
    geoip: &GeoIp,
    enricher: &Enricher,
) -> Vec<TracerouteHop> {
    raw_hops
        .into_iter()
        .map(|hop| {
            let (lat, lon, city, country) = hop
                .ip
                .as_ref()
                .and_then(|ip| geoip.lookup(ip))
                .map(|geo| {
                    (
                        Some(geo.latitude),
                        Some(geo.longitude),
                        geo.city,
                        geo.country,
                    )
                })
                .unwrap_or((None, None, None, None));

            let (asn, asn_org) = hop
                .ip
                .as_ref()
                .map(|ip| {
                    let e = enricher.enrich(ip);
                    (e.asn, e.asn_org)
                })
                .unwrap_or((None, None));

            TracerouteHop {
                hop_number: hop.hop_number,
                ip: hop.ip,
                rtt_ms: hop.rtt_ms,
                lat,
                lon,
                city,
                country,
                asn,
                asn_org,
            }
        })
        .collect()
}

/// Run a full traced route: traceroute + geolocate + enrich.
pub async fn trace_and_geolocate(
    dest_ip: &str,
    geoip: &GeoIp,
    enricher: &Enricher,
) -> Result<TracedRoute, String> {
    let raw_hops = run_traceroute(dest_ip).await?;
    Ok(geolocate_and_build(dest_ip, raw_hops, geoip, enricher))
}

/// Geolocate raw hops and build a TracedRoute (sync, no async).
pub fn geolocate_and_build(
    dest_ip: &str,
    raw_hops: Vec<RawHop>,
    geoip: &GeoIp,
    enricher: &Enricher,
) -> TracedRoute {
    let hops = geolocate_hops(raw_hops, geoip, enricher);
    let traced_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    TracedRoute {
        dest_ip: dest_ip.to_string(),
        hops,
        traced_at,
    }
}

/// Background tracing manager: cycles through active connections and traces untraced destinations.
pub async fn start_tracing_manager(
    store: ConnectionStore,
    db: Arc<Database>,
    geoip: Arc<StdRwLock<Option<Arc<GeoIp>>>>,
    enricher: Arc<Mutex<Enricher>>,
    running: Arc<AtomicBool>,
) {
    log::info!("[traceroute] Background tracing manager started");

    // Wait a bit for initial connections to appear
    tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;

    let ttl_ms: u64 = 24 * 60 * 60 * 1000; // 24 hours

    loop {
        if !running.load(Ordering::Relaxed) {
            break;
        }

        // Get active destination IPs
        let dest_ips: Vec<String> = {
            let state = store.read().unwrap();
            state
                .connections
                .values()
                .filter(|c| c.active)
                .map(|c| c.dest_ip.clone())
                .collect::<std::collections::HashSet<_>>()
                .into_iter()
                .collect()
        };

        // Skip private IPs
        let dest_ips: Vec<String> = dest_ips
            .into_iter()
            .filter(|ip| {
                !ip.starts_with("10.")
                    && !ip.starts_with("192.168.")
                    && !ip.starts_with("172.")
                    && !ip.starts_with("127.")
                    && !ip.starts_with("0.")
                    && !ip.contains("::")
            })
            .collect();

        // Auto-disable when too many connections
        if dest_ips.len() > 50 {
            log::debug!(
                "[traceroute] {} destinations — too many, sleeping",
                dest_ips.len()
            );
            tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
            continue;
        }

        // Find untraced or expired destinations
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let mut to_trace = Vec::new();
        for ip in &dest_ips {
            match db.get_traced_route(ip) {
                Some(route) if now - route.traced_at < ttl_ms => {
                    // Still fresh, skip
                }
                _ => {
                    to_trace.push(ip.clone());
                }
            }
        }

        // Trace up to 2 destinations per cycle
        let batch: Vec<String> = to_trace.into_iter().take(2).collect();

        for dest_ip in &batch {
            if !running.load(Ordering::Relaxed) {
                break;
            }

            // Clone GeoIp Arc out of the lock (no lock held across await)
            let geoip_ref = {
                let guard = geoip.read().unwrap();
                match guard.as_ref() {
                    Some(g) => g.clone(),
                    None => continue,
                }
            };

            log::info!("[traceroute] Tracing route to {}", dest_ip);

            // Run traceroute (async, no locks)
            let raw_result = run_traceroute(dest_ip).await;

            let result = match raw_result {
                Ok(raw_hops) => {
                    // Geolocate (sync, brief lock)
                    let enricher_guard = enricher.lock().unwrap();
                    let route = geolocate_and_build(dest_ip, raw_hops, &geoip_ref, &enricher_guard);
                    drop(enricher_guard);
                    Ok(route)
                }
                Err(e) => Err(e),
            };

            match result {
                Ok(route) => {
                    let hop_count = route.hops.len();
                    let geolocated = route.hops.iter().filter(|h| h.lat.is_some()).count();
                    log::info!(
                        "[traceroute] {} → {} hops ({} geolocated)",
                        dest_ip,
                        hop_count,
                        geolocated
                    );

                    // Check for route change (compare AS path with previous)
                    let current_as_path: String = route.hops.iter()
                        .filter_map(|h| h.asn)
                        .map(|a| a.to_string())
                        .collect::<Vec<_>>()
                        .join(",");
                    if let Some(prev_path) = db.get_previous_as_path(dest_ip, route.traced_at) {
                        if !prev_path.is_empty() && prev_path != current_as_path {
                            log::warn!(
                                "[traceroute] Route change detected for {}: {} → {}",
                                dest_ip, prev_path, current_as_path
                            );
                        }
                    }

                    // Store in both current cache and history
                    db.insert_traced_route(&route);
                    db.insert_route_history(&route);
                }
                Err(e) => {
                    log::warn!("[traceroute] Failed to trace {}: {}", dest_ip, e);
                }
            }

            // Small delay between traces
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        }

        // Sleep 30 seconds between cycles
        tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
    }

    log::info!("[traceroute] Background tracing manager stopped");
}
