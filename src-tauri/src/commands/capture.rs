use crate::capture::nettop::{self, ConnectionStore};
use crate::capture::types::CaptureSnapshot;
use crate::dns_capture::DnsCaptureManager;
use crate::geoip::GeoIp;
use crate::state::AppState;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::Manager;

/// Delta response for incremental polling
#[derive(serde::Serialize)]
pub struct ConnectionsDelta {
    pub generation: u64,
    pub updated: Vec<crate::capture::types::ResolvedConnection>,
    pub removed: Vec<String>,
    pub total_ever: usize,
}

/// Returns current interface byte counters (cumulative)
#[tauri::command]
pub async fn get_bandwidth() -> Result<(u64, u64), String> {
    let output = tokio::process::Command::new("netstat")
        .args(["-ib"])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut total_in: u64 = 0;
    let mut total_out: u64 = 0;

    for line in stdout.lines() {
        // Only count physical interfaces (en0, en1, etc.) with Link layer
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

    Ok((total_in, total_out))
}

/// Returns all current connections — used for initial load
#[tauri::command]
pub fn get_connections(state: tauri::State<AppState>) -> CaptureSnapshot {
    let store = state.store.read().unwrap();
    let snapshot = CaptureSnapshot {
        connections: store.connections.values().cloned().collect(),
        total_ever: store.total_ever,
    };
    log::info!(
        "get_connections: returning {} active, {} total_ever",
        snapshot.connections.len(),
        snapshot.total_ever
    );
    snapshot
}

/// Returns only connections that changed since the given generation
#[tauri::command]
pub fn get_connections_delta(state: tauri::State<AppState>, since: u64) -> ConnectionsDelta {
    let store = state.store.read().unwrap();
    let updated: Vec<_> = store.changed_ids.iter()
        .filter(|(_, &gen)| gen > since)
        .filter_map(|(id, _)| store.connections.get(id).cloned())
        .collect();
    let removed: Vec<_> = store.removed_ids.iter()
        .filter(|(_, gen)| *gen > since)
        .map(|(id, _)| id.clone())
        .collect();
    ConnectionsDelta {
        generation: store.generation,
        updated,
        removed,
        total_ever: store.total_ever,
    }
}

#[tauri::command]
pub fn start_capture(app: tauri::AppHandle, state: tauri::State<AppState>) {
    if state.running.load(Ordering::SeqCst) {
        log::warn!("start_capture called but already running");
        return;
    }

    let running = state.running.clone();
    let elevated = state.elevated.clone();
    let store = state.store.clone();
    let db_writer = state.db_writer.clone();
    let blocklists = state.blocklists.clone();
    let enricher = state.enricher.clone();
    let dns_mapping = state.dns_mapping.clone();
    let dns_capture = state.dns_capture.clone();
    let blocklists_for_dns = state.blocklists.clone();
    let db_writer_for_dns = state.db_writer.clone();
    let db_for_seed = state.db.clone();
    let geoip_slot = state.geoip.clone();
    let app_handle_for_ne = app.clone();

    let resource_path = app
        .path()
        .resource_dir()
        .expect("failed to resolve resource dir")
        .join("resources");

    let geoip_path = resource_path.join("GeoLite2-City.mmdb");

    log::info!("start_capture: GeoIP path = {:?}", geoip_path);
    log::info!("start_capture: file exists = {}", geoip_path.exists());

    tauri::async_runtime::spawn(async move {
        let load_start = std::time::Instant::now();
        log::info!("Loading GeoIP database...");
        let geoip = match tokio::task::spawn_blocking({
            let path = geoip_path.clone();
            move || GeoIp::new(&path)
        })
        .await
        {
            Ok(Ok(g)) => {
                log::info!("GeoIP loaded in {:?}", load_start.elapsed());
                Arc::new(g)
            }
            Ok(Err(e)) => {
                log::error!("Failed to load GeoIP DB: {}", e);
                return;
            }
            Err(e) => {
                log::error!("GeoIP task panicked: {}", e);
                return;
            }
        };
        log::info!("GeoIP database loaded successfully");

        // Store in AppState so commands can access it
        {
            let mut slot = geoip_slot.write().unwrap();
            *slot = Some(geoip.clone());
        }

        let dns = Arc::new(crate::dns::DnsCache::new());

        // Start DNS capture if elevated
        if elevated.load(Ordering::SeqCst) {
            let helper_path = resource_path.join("blip-dns-helper");
            if helper_path.exists() {
                match DnsCaptureManager::start(
                    helper_path,
                    dns_mapping.clone(),
                    blocklists_for_dns,
                    db_writer_for_dns,
                ).await {
                    Ok(manager) => {
                        *dns_capture.lock().await = Some(manager);
                        log::info!("DNS capture started");
                    }
                    Err(e) => {
                        log::warn!("DNS capture failed to start (continuing without): {}", e);
                    }
                }
            } else {
                log::warn!("blip-dns-helper not found at {:?}, skipping DNS capture", helper_path);
            }
        }

        // Start NE bridge socket server (listens for Network Extension connections)
        let ne_bridge = crate::ne_bridge::NEBridge::new();
        match ne_bridge.start(
            store.clone(),
            geoip.clone(),
            blocklists.clone(),
            db_writer.clone(),
            dns_mapping.clone(),
            enricher.clone(),
            db_for_seed.clone(),
            app_handle_for_ne.clone(),
        ).await {
            Ok(broadcast) => {
                // Store the broadcast handle so we can push config changes to NE
                let state: tauri::State<AppState> = app_handle_for_ne.state();
                if let Ok(mut ne_bc) = state.ne_broadcast.lock() {
                    *ne_bc = Some(broadcast);
                }
                log::info!("NE bridge started with broadcast handle");
            }
            Err(e) => {
                log::warn!("NE bridge failed to start (continuing without): {}", e);
            }
        }

        // Start periodic expired-rule cleanup (every 60s)
        {
            let db_cleanup = db_for_seed.clone();
            tokio::spawn(async move {
                loop {
                    tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
                    match db_cleanup.cleanup_expired_rules() {
                        Ok(n) if n > 0 => log::info!("Cleaned up {} expired firewall rules", n),
                        _ => {}
                    }
                }
            });
        }

        // Start auto-diagnostics that write snapshots every 5s
        super::diagnostics::start_auto_diagnostics(store.clone());

        // Start blocklist auto-updater (checks every 6 hours)
        {
            let bl = blocklists.clone();
            let _db = db_writer.clone();
            tokio::spawn(async move {
                // Wait 60s before first check to let app finish loading
                tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
                log::info!("Blocklist auto-updater started (6h interval)");
                loop {
                    tokio::time::sleep(tokio::time::Duration::from_secs(6 * 3600)).await;
                    let lists = bl.get_all();
                    let mut updated = 0u32;
                    for list in &lists {
                        if !list.enabled || list.source_url == "file" || list.source_url.is_empty() {
                            continue;
                        }
                        match reqwest::get(&list.source_url).await {
                            Ok(resp) => match resp.text().await {
                                Ok(content) => {
                                    let new_domains = crate::blocklist::parse_auto_pub(&content);
                                    bl.update_domains(&list.id, new_domains);
                                    updated += 1;
                                    log::info!("Updated blocklist: {}", list.name);
                                }
                                Err(e) => log::warn!("Failed to read blocklist '{}': {}", list.name, e),
                            },
                            Err(e) => log::warn!("Failed to download blocklist '{}': {}", list.name, e),
                        }
                    }
                    if updated > 0 {
                        log::info!("Blocklist auto-update: {} lists refreshed", updated);
                    }
                }
            });
        }

        log::info!("Enricher ready");

        // Seed total_ever from historical DB count so stats persist across restarts
        if let Ok(stats) = db_for_seed.get_historical_stats() {
            let mut state = store.write().unwrap();
            state.total_ever = stats.total_connections as usize;
            log::info!("Seeded total_ever from DB: {}", state.total_ever);
        }

        // Seed DNS stats from DB so counters persist across restarts
        if let Ok((total, blocked)) = db_for_seed.get_dns_stats_cumulative() {
            let mut mapping = dns_mapping.write().await;
            mapping.total_queries = total;
            mapping.blocked_count = blocked;
            log::info!("Seeded DNS stats from DB: {} queries, {} blocked", total, blocked);
        }

        // Seed DNS IP→domain mappings from recent queries so tracker detection works immediately
        if let Ok(rows) = db_for_seed.get_recent_ip_domain_mappings(10000) {
            let mut mapping = dns_mapping.write().await;
            let count = rows.len();
            for (domain, ips) in rows {
                let event = crate::dns_capture::types::DnsEvent {
                    domain,
                    ips,
                    query_type: "A".to_string(),
                    ts: 0,
                };
                // Use record() but we'll fix the counters after
                mapping.record(&event, false, None);
            }
            // Reset counters back to DB values (record() incremented them)
            if let Ok((total, blocked)) = db_for_seed.get_dns_stats_cumulative() {
                mapping.total_queries = total;
                mapping.blocked_count = blocked;
            }
            log::info!("Seeded {} IP→domain mappings from DB", count);
        }

        // Spawn background route tracing manager
        {
            let trace_store = store.clone();
            let trace_db = db_for_seed.clone();
            let trace_geoip = geoip_slot.clone();
            let trace_enricher = enricher.clone();
            let trace_running = running.clone();
            tokio::spawn(async move {
                crate::traceroute::start_tracing_manager(
                    trace_store, trace_db, trace_geoip, trace_enricher, trace_running,
                ).await;
            });
        }

        // Read DNS preference
        let resolve_dns = db_for_seed.get_preference("dns_resolve_hostnames")
            .ok().flatten().unwrap_or_else(|| "true".to_string()) == "true";

        nettop::start_capture(store, geoip, dns, running, elevated, db_writer, blocklists, enricher, dns_mapping, resolve_dns).await;
    });
}

#[tauri::command]
pub fn stop_capture(state: tauri::State<AppState>) {
    state.running.store(false, Ordering::SeqCst);
    let dns_capture = state.dns_capture.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(ref mut manager) = *dns_capture.lock().await {
            manager.stop().await;
        }
    });
    log::info!("stop_capture called");
}

// ---- Elevation commands ----

#[tauri::command]
pub async fn request_elevation(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    // Prevent concurrent elevation requests (stacking osascript dialogs)
    if state.elevating.swap(true, Ordering::SeqCst) {
        log::warn!("Elevation already in progress, skipping duplicate request");
        return Ok(false);
    }

    log::info!("Requesting admin elevation via osascript...");

    // Use osascript to prompt for admin password, then validate+cache sudo credentials
    // This runs `sudo -v` which refreshes the sudo timestamp, so subsequent `sudo -n` calls work
    let result = tokio::process::Command::new("osascript")
        .args(["-e", r#"do shell script "sudo -v" with administrator privileges"#])
        .output()
        .await
        .map_err(|e| format!("Failed to launch osascript: {}", e));

    state.elevating.store(false, Ordering::SeqCst);

    match result {
        Ok(output) if output.status.success() => {
            state.elevated.store(true, Ordering::SeqCst);
            // Persist elevation preference in DB
            let _ = state.db.set_preference("elevation_enabled", "true");
            log::info!("Elevation granted");

            // Start DNS capture now that we have elevation
            {
                let dns_capture = state.dns_capture.clone();
                let dns_mapping = state.dns_mapping.clone();
                let blocklists = state.blocklists.clone();
                let db_writer = state.db_writer.clone();
                tauri::async_runtime::spawn(async move {
                    // Only start if not already running
                    if dns_capture.lock().await.is_some() {
                        return;
                    }
                    let exe = std::env::current_exe().unwrap_or_default();
                    let mac_os_dir = exe.parent().unwrap_or(std::path::Path::new("."));
                    let resource_dir = mac_os_dir.parent()
                        .map(|contents| contents.join("Resources").join("resources"))
                        .unwrap_or_else(|| mac_os_dir.join("resources"));
                    let helper_path = resource_dir.join("blip-dns-helper");
                    if !helper_path.exists() {
                        log::warn!("blip-dns-helper not found at {:?} after elevation", helper_path);
                        return;
                    }
                    match DnsCaptureManager::start(helper_path, dns_mapping, blocklists, db_writer).await {
                        Ok(manager) => {
                            *dns_capture.lock().await = Some(manager);
                            log::info!("DNS capture started after elevation");
                        }
                        Err(e) => log::warn!("DNS capture failed to start after elevation: {}", e),
                    }
                });
            }

            // Start background sudo refresh — keeps credentials alive
            // Refreshes every 4 minutes (macOS default sudo timeout is 5 min)
            {
                let elevated = state.elevated.clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::time::sleep(tokio::time::Duration::from_secs(240)).await;
                        if !elevated.load(Ordering::SeqCst) {
                            log::info!("Sudo refresh stopped — elevation disabled");
                            break;
                        }
                        let result = tokio::process::Command::new("sudo")
                            .args(["-n", "-v"])
                            .output()
                            .await;
                        match result {
                            Ok(o) if o.status.success() => {
                                log::debug!("Sudo credentials refreshed");
                            }
                            _ => {
                                log::warn!("Sudo refresh failed — credentials may have expired");
                                elevated.store(false, Ordering::SeqCst);
                                break;
                            }
                        }
                    }
                });
            }

            Ok(true)
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::warn!("Elevation denied: {}", stderr);
            Ok(false)
        }
        Err(e) => Err(e),
    }
}

/// Check if elevation is active — only checks silently, never prompts.
/// Use request_elevation to prompt the user.
#[tauri::command]
pub async fn check_elevation(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    // If we think we're elevated, verify sudo is still valid (non-interactive only)
    if state.elevated.load(Ordering::SeqCst) {
        let check = tokio::process::Command::new("sudo")
            .args(["-n", "true"])
            .output()
            .await;
        match check {
            Ok(o) if o.status.success() => return Ok(true),
            _ => {
                // Sudo expired — mark as not elevated, don't auto-prompt
                state.elevated.store(false, Ordering::SeqCst);
                return Ok(false);
            }
        }
    }

    // Check if sudo credentials happen to be cached already (e.g. from a previous session)
    let check = tokio::process::Command::new("sudo")
        .args(["-n", "true"])
        .output()
        .await;
    if let Ok(o) = check {
        if o.status.success() {
            state.elevated.store(true, Ordering::SeqCst);
            return Ok(true);
        }
    }

    Ok(false)
}

#[tauri::command]
pub fn disable_elevation(state: tauri::State<AppState>) {
    state.elevated.store(false, Ordering::SeqCst);
    let _ = state.db.delete_preference("elevation_enabled");
    log::info!("Elevation disabled");
}
