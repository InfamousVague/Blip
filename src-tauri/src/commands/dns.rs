use crate::dns_capture::types::{DnsQueryLogEntry, DnsStats};
use crate::state::AppState;

#[tauri::command]
pub async fn get_dns_log(state: tauri::State<'_, AppState>) -> Result<Vec<DnsQueryLogEntry>, String> {
    let mapping = state.dns_mapping.read().await;
    Ok(mapping.recent_log(100))
}

#[tauri::command]
pub async fn get_dns_stats(state: tauri::State<'_, AppState>) -> Result<DnsStats, String> {
    let mapping = state.dns_mapping.read().await;
    Ok(mapping.stats())
}

/// A blocked DNS attempt with geo coordinates for map display.
#[derive(Debug, Clone, serde::Serialize)]
pub struct BlockedAttempt {
    pub domain: String,
    pub dest_lat: f64,
    pub dest_lon: f64,
    pub city: Option<String>,
    pub country: Option<String>,
    pub timestamp_ms: u64,
    pub blocked_by: Option<String>,
    pub source_app: Option<String>,
}

#[tauri::command]
pub async fn get_blocked_attempts(state: tauri::State<'_, AppState>) -> Result<Vec<BlockedAttempt>, String> {
    let mapping = state.dns_mapping.read().await;
    let geoip_guard = state.geoip.read().map_err(|e| format!("GeoIP lock: {}", e))?;
    let geoip = match geoip_guard.as_ref() {
        Some(g) => g.clone(),
        None => return Ok(vec![]),
    };
    // Drop the lock before doing lookups
    drop(geoip_guard);

    let blocked_entries: Vec<DnsQueryLogEntry> = mapping
        .recent_log(500)
        .into_iter()
        .filter(|e| e.is_blocked)
        .collect();

    let mut results = Vec::new();
    let mut seen_domains = std::collections::HashSet::new();

    for entry in &blocked_entries {
        // Deduplicate by domain — show only the most recent attempt per domain
        if !seen_domains.insert(entry.domain.clone()) {
            continue;
        }

        // Try to find an IP to geolocate:
        // 1. response_ips from the DNS query (NE provides these)
        // 2. Cached domain → IP mapping from previous lookups
        let ip_str = entry.response_ips.first().cloned().or_else(|| {
            mapping
                .ips_for_domain(&entry.domain)
                .and_then(|ips| ips.first())
                .map(|ip| ip.to_string())
        });

        if let Some(ip) = ip_str {
            if let Some(geo) = geoip.lookup(&ip) {
                results.push(BlockedAttempt {
                    domain: entry.domain.clone(),
                    dest_lat: geo.latitude,
                    dest_lon: geo.longitude,
                    city: geo.city,
                    country: geo.country,
                    timestamp_ms: entry.timestamp_ms,
                    blocked_by: entry.blocked_by.clone(),
                    source_app: entry.source_app.clone(),
                });
            }
        }
    }

    Ok(results)
}
