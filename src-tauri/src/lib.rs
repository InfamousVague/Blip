#[allow(dead_code)]
mod blocklist;
mod capture;
#[allow(dead_code)]
mod db;
#[allow(dead_code)]
mod db_writer;
mod dns;
#[allow(dead_code)]
mod dns_capture;
#[allow(dead_code)]
mod enrichment;
mod geoip;
#[allow(dead_code)]
mod ne_bridge;
mod speedtest;
mod dock_icon;

use blocklist::{BlocklistInfo, BlocklistStore};
use capture::nettop::{self, ConnectionState, ConnectionStore};
use capture::types::CaptureSnapshot;
use db::Database;
use db_writer::DbWriter;
use dns::DnsCache;
use dns_capture::types::{DnsMapping, DnsQueryLogEntry, DnsStats};
use dns_capture::DnsCaptureManager;
use enrichment::Enricher;
use geoip::GeoIp;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock as StdRwLock};
use tauri::Manager;
use tokio::sync::RwLock;


struct AppState {
    running: Arc<AtomicBool>,
    elevated: Arc<AtomicBool>,
    elevating: Arc<AtomicBool>,
    store: ConnectionStore,
    blocklists: Arc<BlocklistStore>,
    db: Arc<Database>,
    db_writer: Arc<DbWriter>,
    enricher: Arc<Mutex<Enricher>>,
    dns_mapping: Arc<RwLock<DnsMapping>>,
    dns_capture: Arc<tokio::sync::Mutex<Option<DnsCaptureManager>>>,
    geoip: Arc<StdRwLock<Option<Arc<GeoIp>>>>,
    speed_test_result: Arc<Mutex<Option<speedtest::SpeedTestResult>>>,
}

/// Returns current interface byte counters (cumulative)
#[tauri::command]
async fn get_bandwidth() -> Result<(u64, u64), String> {
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
fn get_connections(state: tauri::State<AppState>) -> CaptureSnapshot {
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

/// Delta response for incremental polling
#[derive(serde::Serialize)]
struct ConnectionsDelta {
    generation: u64,
    updated: Vec<capture::types::ResolvedConnection>,
    removed: Vec<String>,
    total_ever: usize,
}

/// Returns only connections that changed since the given generation
#[tauri::command]
fn get_connections_delta(state: tauri::State<AppState>, since: u64) -> ConnectionsDelta {
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
fn start_capture(app: tauri::AppHandle, state: tauri::State<AppState>) {
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

        let dns = Arc::new(DnsCache::new());

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
        let ne_bridge = ne_bridge::NEBridge::new();
        if let Err(e) = ne_bridge.start(
            store.clone(),
            geoip.clone(),
            blocklists.clone(),
            db_writer.clone(),
            dns_mapping.clone(),
            enricher.clone(),
            db_for_seed.clone(),
            app_handle_for_ne.clone(),
        ).await {
            log::warn!("NE bridge failed to start (continuing without): {}", e);
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
        start_auto_diagnostics(store.clone());

        // Start blocklist auto-updater (checks every 6 hours)
        {
            let bl = blocklists.clone();
            let db = db_writer.clone(); // we need the db, not db_writer
            // We can't access db directly here, so use a separate approach
            // The updater needs the Database, not DbWriter
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

        nettop::start_capture(store, geoip, dns, running, elevated, db_writer, blocklists, enricher, dns_mapping).await;
    });
}

#[tauri::command]
fn stop_capture(state: tauri::State<AppState>) {
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
async fn request_elevation(state: tauri::State<'_, AppState>) -> Result<bool, String> {
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
async fn check_elevation(state: tauri::State<'_, AppState>) -> Result<bool, String> {
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
fn disable_elevation(state: tauri::State<AppState>) {
    state.elevated.store(false, Ordering::SeqCst);
    let _ = state.db.delete_preference("elevation_enabled");
    log::info!("Elevation disabled");
}

// ---- Blocklist commands ----

#[tauri::command]
async fn add_blocklist_url(state: tauri::State<'_, AppState>, url: String, name: String) -> Result<BlocklistInfo, String> {
    log::info!("Adding blocklist from URL: {}", url);
    let response = reqwest::get(&url).await.map_err(|e| format!("Download failed: {}", e))?;
    let content = response.text().await.map_err(|e| format!("Read failed: {}", e))?;
    let (info, domains) = state.blocklists.add(name, url, &content);
    // Persist to DB
    let db = state.db.clone();
    let info_clone = info.clone();
    tokio::task::spawn_blocking(move || {
        if let Err(e) = db.save_blocklist(&info_clone, &domains) {
            log::error!("Failed to persist blocklist: {}", e);
        }
    });
    log::info!("Blocklist added: {} ({} domains)", info.name, info.domain_count);
    Ok(info)
}

#[tauri::command]
fn add_blocklist_content(state: tauri::State<AppState>, content: String, name: String) -> Result<BlocklistInfo, String> {
    let (info, domains) = state.blocklists.add(name, "file".to_string(), &content);
    // Persist to DB
    let db = state.db.clone();
    let info_clone = info.clone();
    std::thread::spawn(move || {
        if let Err(e) = db.save_blocklist(&info_clone, &domains) {
            log::error!("Failed to persist blocklist: {}", e);
        }
    });
    log::info!("Blocklist added from file: {} ({} domains)", info.name, info.domain_count);
    Ok(info)
}

#[tauri::command]
fn remove_blocklist(state: tauri::State<AppState>, id: String) {
    state.blocklists.remove(&id);
    let db = state.db.clone();
    let id_clone = id.clone();
    std::thread::spawn(move || {
        if let Err(e) = db.remove_blocklist(&id_clone) {
            log::error!("Failed to remove blocklist from DB: {}", e);
        }
    });
    log::info!("Blocklist removed: {}", id);
}

#[tauri::command]
fn toggle_blocklist(state: tauri::State<AppState>, id: String, enabled: bool) {
    state.blocklists.toggle(&id, enabled);
    let db = state.db.clone();
    let id_clone = id.clone();
    std::thread::spawn(move || {
        if let Err(e) = db.toggle_blocklist(&id_clone, enabled) {
            log::error!("Failed to toggle blocklist in DB: {}", e);
        }
    });
    log::info!("Blocklist toggled: {} -> {}", id, enabled);
}

#[tauri::command]
fn get_blocklists(state: tauri::State<AppState>) -> Vec<BlocklistInfo> {
    state.blocklists.get_all()
}

// ---- Geolocation (called from Rust to avoid CORS/ATS in production) ----

#[derive(serde::Serialize)]
struct UserLocation {
    latitude: f64,
    longitude: f64,
    ip: String,
}

#[tauri::command]
async fn get_user_location() -> Result<UserLocation, String> {
    let resp = reqwest::get("http://ip-api.com/json/?fields=lat,lon,query")
        .await
        .map_err(|e| format!("Location fetch failed: {}", e))?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Location parse failed: {}", e))?;

    let lat = resp.get("lat").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let lon = resp.get("lon").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let ip = resp.get("query").and_then(|v| v.as_str()).unwrap_or("").to_string();

    if lat == 0.0 && lon == 0.0 {
        return Err("Could not determine location".into());
    }

    Ok(UserLocation { latitude: lat, longitude: lon, ip })
}

// ---- Self IP info (for location bar) ----

#[tauri::command]
async fn get_self_info(state: tauri::State<'_, AppState>) -> Result<enrichment::SelfIpInfo, String> {
    // Get public IP from ip-api
    let ip = reqwest::get("http://ip-api.com/json/?fields=query")
        .await
        .map_err(|e| e.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;

    let ip_str = ip.get("query").and_then(|v| v.as_str()).unwrap_or("").to_string();

    if ip_str.is_empty() {
        return Ok(enrichment::SelfIpInfo { isp: None, asn: None, network_type: None });
    }

    let enricher = state.enricher.lock().unwrap();
    Ok(enricher.enrich_self_ip(&ip_str))
}

// ---- Network Extension commands ----

/// Find a resource binary, checking both bundled and dev paths.
fn find_resource(app: &tauri::AppHandle, name: &str) -> Option<std::path::PathBuf> {
    // 1. Bundled app: resource_dir/resources/<name>
    if let Ok(dir) = app.path().resource_dir() {
        let p = dir.join("resources").join(name);
        log::info!("find_resource: checking bundled path: {:?} exists={}", p, p.exists());
        if p.exists() {
            return Some(p);
        }
        // Also check directly in resource_dir (Tauri sometimes flattens)
        let p2 = dir.join(name);
        log::info!("find_resource: checking flat path: {:?} exists={}", p2, p2.exists());
        if p2.exists() {
            return Some(p2);
        }
    }
    // 2. Dev mode: src-tauri/resources/<name>
    let dev_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(name);
    log::info!("find_resource: checking dev path: {:?} exists={}", dev_path, dev_path.exists());
    if dev_path.exists() {
        return Some(dev_path);
    }
    // 3. Next to executable
    if let Ok(exe) = std::env::current_exe() {
        let p = exe.parent().unwrap_or(std::path::Path::new(".")).join("resources").join(name);
        log::info!("find_resource: checking exe-relative: {:?} exists={}", p, p.exists());
        if p.exists() {
            return Some(p);
        }
    }
    log::warn!("find_resource: '{}' not found in any location", name);
    None
}

/// Lazily loaded NE bridge dylib — kept alive for the process lifetime
/// so async Swift callbacks can complete after the function returns.
static NE_BRIDGE_LIB: std::sync::OnceLock<Result<libloading::Library, String>> = std::sync::OnceLock::new();

fn get_ne_bridge_lib(app: &tauri::AppHandle) -> Result<&'static libloading::Library, String> {
    NE_BRIDGE_LIB
        .get_or_init(|| {
            let dylib_path = find_resource(app, "libblip_ne_bridge.dylib")
                .ok_or_else(|| "libblip_ne_bridge.dylib not found".to_string())?;
            log::info!("Loading NE bridge dylib from {:?}", dylib_path);
            unsafe {
                libloading::Library::new(&dylib_path)
                    .map_err(|e| format!("Failed to load NE bridge dylib: {}", e))
            }
        })
        .as_ref()
        .map_err(|e| e.clone())
}

/// Call an NE bridge function (non-blocking) and return immediate result.
/// The Swift side dispatches to the main thread and writes the async result
/// to ~/.blip/ne-result.json. We call the FFI, then poll the file.
fn call_ne_bridge_fire(app: &tauri::AppHandle, func_name: &str) -> Result<String, String> {
    let lib = get_ne_bridge_lib(app)?;

    log::info!("Calling NE bridge function: {}", func_name);

    let immediate = unsafe {
        let func: libloading::Symbol<unsafe extern "C" fn() -> *const std::os::raw::c_char> = lib
            .get(func_name.as_bytes())
            .map_err(|e| format!("Failed to find {} in dylib: {}", func_name, e))?;

        let result_ptr = func();
        if result_ptr.is_null() {
            return Ok("{\"status\":\"error\",\"error\":\"null from NE bridge\"}".into());
        }
        std::ffi::CStr::from_ptr(result_ptr)
            .to_string_lossy()
            .into_owned()
    };

    log::info!("NE bridge {} immediate: {}", func_name, immediate);
    Ok(immediate)
}

/// Poll ~/.blip/ne-result.json for the async result from the Swift NE bridge.
async fn poll_ne_result(timeout_ms: u64) -> Result<String, String> {
    let result_path = dirs::home_dir()
        .unwrap_or_default()
        .join(".blip")
        .join("ne-result.json");

    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_millis(timeout_ms);

    loop {
        if start.elapsed() > timeout {
            log::warn!("NE result poll timed out after {}ms", timeout_ms);
            return Ok("{\"status\":\"timeout\"}".into());
        }

        if let Ok(content) = tokio::fs::read_to_string(&result_path).await {
            let content = content.trim().to_string();
            if !content.is_empty() {
                log::info!("NE async result: {}", content);
                // Clean up
                let _ = tokio::fs::remove_file(&result_path).await;
                return Ok(content);
            }
        }

        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
    }
}

#[tauri::command]
async fn activate_network_extension(app: tauri::AppHandle) -> Result<String, String> {
    // Fire the activation (non-blocking — Swift dispatches to main thread)
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        call_ne_bridge_fire(&app_clone, "blip_ne_activate")
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    // Poll for the async result (up to 60s for user approval)
    poll_ne_result(60_000).await
}

#[tauri::command]
async fn deactivate_network_extension(app: tauri::AppHandle) -> Result<String, String> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        call_ne_bridge_fire(&app_clone, "blip_ne_deactivate")
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    poll_ne_result(10_000).await
}

#[tauri::command]
async fn get_network_extension_status(app: tauri::AppHandle) -> Result<String, String> {
    // Try the dylib first (most reliable — queries NEFilterManager directly)
    let app_clone = app.clone();
    let dylib_result = tokio::task::spawn_blocking(move || {
        call_ne_bridge_fire(&app_clone, "blip_ne_status")
    })
    .await;

    if let Ok(Ok(_)) = dylib_result {
        // Poll for result with short timeout
        match tokio::time::timeout(
            tokio::time::Duration::from_secs(3),
            poll_ne_result(3000),
        )
        .await
        {
            Ok(Ok(result)) => return Ok(result),
            _ => {}
        }
    }

    // Fallback: check if the NE socket is connected (NE is running and sending data)
    let socket_path = dirs::home_dir()
        .unwrap_or_default()
        .join(".blip")
        .join("ne.sock");
    if socket_path.exists() {
        // Socket exists — check if NE has connected by looking at logs
        return Ok("{\"status\":\"not_installed\"}".into());
    }

    Ok("{\"status\":\"not_installed\"}".into())
}

// ---- Firewall commands ----

#[tauri::command]
async fn get_firewall_rules(state: tauri::State<'_, AppState>) -> Result<Vec<db::FirewallRule>, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.get_firewall_rules())
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
async fn set_firewall_rule(
    state: tauri::State<'_, AppState>,
    app_id: String,
    app_name: String,
    app_path: Option<String>,
    action: String,
    domain: Option<String>,
    port: Option<u16>,
    protocol: Option<String>,
    lifetime: Option<String>,
    duration_mins: Option<u64>,
) -> Result<db::FirewallRule, String> {
    let db = state.db.clone();
    let rule = tokio::task::spawn_blocking(move || {
        let lt = lifetime.as_deref().unwrap_or("permanent");
        let expires = if lt == "timed" {
            duration_mins.map(|m| {
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as u64
                    + m * 60_000
            })
        } else {
            None
        };
        db.set_firewall_rule(
            &app_id,
            &app_name,
            app_path.as_deref(),
            &action,
            domain.as_deref(),
            port,
            protocol.as_deref(),
            lt,
            expires,
        )
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    // Sync all rules to NE
    sync_firewall_rules_to_ne(&state).await;

    Ok(rule)
}

#[tauri::command]
async fn delete_firewall_rule(state: tauri::State<'_, AppState>, app_id: String) -> Result<(), String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.delete_firewall_rule(&app_id))
        .await
        .map_err(|e| format!("Task error: {}", e))??;

    sync_firewall_rules_to_ne(&state).await;
    Ok(())
}

#[tauri::command]
async fn delete_firewall_rule_by_id(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.delete_firewall_rule_by_id(&id))
        .await
        .map_err(|e| format!("Task error: {}", e))??;

    sync_firewall_rules_to_ne(&state).await;
    Ok(())
}

#[tauri::command]
async fn get_app_list(state: tauri::State<'_, AppState>) -> Result<Vec<db::AppConnectionInfo>, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.get_app_connections())
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
async fn get_firewall_mode(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let db = state.db.clone();
    let mode = tokio::task::spawn_blocking(move || db.get_preference("firewall_mode"))
        .await
        .map_err(|e| format!("Task error: {}", e))??;
    Ok(mode.unwrap_or_else(|| "silent_allow".to_string()))
}

#[tauri::command]
async fn set_firewall_mode(state: tauri::State<'_, AppState>, mode: String) -> Result<(), String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.set_preference("firewall_mode", &mode))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
async fn export_firewall_rules(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let db = state.db.clone();
    let rules = tokio::task::spawn_blocking(move || db.get_firewall_rules())
        .await
        .map_err(|e| format!("Task error: {}", e))??;
    serde_json::to_string_pretty(&rules).map_err(|e| format!("Serialize error: {}", e))
}

#[tauri::command]
async fn import_firewall_rules(state: tauri::State<'_, AppState>, json: String) -> Result<usize, String> {
    let rules: Vec<db::FirewallRule> = serde_json::from_str(&json)
        .map_err(|e| format!("Invalid JSON: {}", e))?;
    let count = rules.len();
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || {
        for rule in &rules {
            db.set_firewall_rule(
                &rule.app_id,
                &rule.app_name,
                rule.app_path.as_deref(),
                &rule.action,
                rule.domain.as_deref(),
                rule.port,
                rule.protocol.as_deref(),
                &rule.lifetime,
                rule.expires_at,
            )?;
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    sync_firewall_rules_to_ne(&state).await;
    Ok(count)
}

/// Helper: sync all firewall rules to NE via socket bridge
async fn sync_firewall_rules_to_ne(state: &AppState) {
    let db = state.db.clone();
    if let Ok(rules) = tokio::task::spawn_blocking(move || db.get_firewall_rules()).await {
        if let Ok(rules) = rules {
            // Write the rules as JSON to the NE socket — the NE bridge will pick them up
            // For now, store them so the NE bridge sends them on next connect
            let _ = state.db.set_preference(
                "firewall_rules_json",
                &serde_json::to_string(&rules.iter().map(|r| {
                    let mut entry = serde_json::json!({"app_id": r.app_id, "action": r.action});
                    if let Some(ref d) = r.domain { entry["domain"] = serde_json::json!(d); }
                    if let Some(p) = r.port { entry["port"] = serde_json::json!(p); }
                    if let Some(ref p) = r.protocol { entry["protocol"] = serde_json::json!(p); }
                    entry
                }).collect::<Vec<_>>()).unwrap_or_default(),
            );
            log::info!("Firewall rules synced: {} rules", rules.len());
        }
    }
}

// ---- App icon resolution ----

#[tauri::command]
async fn get_app_icons(bundle_ids: Vec<String>) -> Result<std::collections::HashMap<String, String>, String> {
    tokio::task::spawn_blocking(move || {
        let mut result = std::collections::HashMap::new();
        let cache_dir = dirs::home_dir()
            .unwrap_or_default()
            .join(".blip/icon-cache");
        let _ = std::fs::create_dir_all(&cache_dir);

        // Known aliases: CLI tools → parent app icons
        let aliases: std::collections::HashMap<&str, &str> = [
            ("com.anthropic.claude-code", "com.anthropic.claudefordesktop"),
        ].into_iter().collect();

        // Use mdfind for fast Spotlight-based lookup (much faster than scanning dirs)
        let mut remaining: std::collections::HashSet<String> = bundle_ids.iter().cloned().collect();

        for bid in &bundle_ids {
            if result.contains_key(bid) { continue; }

            // Check cache first
            let png_path = cache_dir.join(format!("{}.png", bid));
            if png_path.exists() {
                if let Ok(bytes) = std::fs::read(&png_path) {
                    use base64::Engine;
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                    result.insert(bid.clone(), format!("data:image/png;base64,{}", b64));
                    remaining.remove(bid);
                    continue;
                }
            }

            // Check alias
            let bid_str = bid.as_str();
            let lookup_bid = aliases.get(bid_str).copied().unwrap_or(bid_str);

            // Use mdfind to locate the .app bundle by bundle ID (uses Spotlight index, very fast)
            let mdfind = std::process::Command::new("mdfind")
                .args(["kMDItemCFBundleIdentifier", "=", lookup_bid])
                .output();

            let app_path = mdfind.ok()
                .filter(|o| o.status.success())
                .and_then(|o| {
                    String::from_utf8_lossy(&o.stdout)
                        .lines()
                        .find(|l| l.ends_with(".app"))
                        .map(String::from)
                });

            let Some(app_path) = app_path else { continue };
            let path = std::path::Path::new(&app_path);
            let plist_path = path.join("Contents/Info.plist");
            if !plist_path.exists() { continue; }

            // Find icon file name
            let icon_output = std::process::Command::new("plutil")
                .args(["-extract", "CFBundleIconFile", "raw", "-o", "-"])
                .arg(&plist_path)
                .output();

            let icon_name = icon_output.ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_else(|| "AppIcon".to_string());

            let icon_base = if icon_name.ends_with(".icns") {
                icon_name.clone()
            } else {
                format!("{}.icns", icon_name)
            };

            let icon_path = path.join("Contents/Resources").join(&icon_base);
            if !icon_path.exists() { continue; }

            // Convert .icns to .png at 64x64
            if !png_path.exists() {
                let _ = std::process::Command::new("sips")
                    .args(["-s", "format", "png", "-z", "64", "64"])
                    .arg(&icon_path)
                    .arg("--out")
                    .arg(&png_path)
                    .output();
            }

            if png_path.exists() {
                if let Ok(bytes) = std::fs::read(&png_path) {
                    use base64::Engine;
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                    result.insert(bid.clone(), format!("data:image/png;base64,{}", b64));
                    remaining.remove(bid);
                }
            }
        }

        Ok(result)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

// ---- DNS capture commands ----

#[tauri::command]
async fn get_dns_log(state: tauri::State<'_, AppState>) -> Result<Vec<DnsQueryLogEntry>, String> {
    let mapping = state.dns_mapping.read().await;
    Ok(mapping.recent_log(100))
}

#[tauri::command]
async fn get_dns_stats(state: tauri::State<'_, AppState>) -> Result<DnsStats, String> {
    let mapping = state.dns_mapping.read().await;
    Ok(mapping.stats())
}

// ---- Speed test commands ----

#[tauri::command]
async fn run_speed_test(state: tauri::State<'_, AppState>) -> Result<speedtest::SpeedTestResult, String> {
    let result = speedtest::run_speed_test().await?;
    let mut cached = state.speed_test_result.lock().unwrap();
    *cached = Some(result.clone());
    Ok(result)
}

#[tauri::command]
fn get_last_speed_test(state: tauri::State<AppState>) -> Option<speedtest::SpeedTestResult> {
    state.speed_test_result.lock().unwrap().clone()
}

// ---- Port / process management (approach from Emit's PortPilot) ----

#[derive(Debug, Clone, serde::Serialize)]
struct PortEntry {
    port: u16,
    protocol: String,
    state: String,
    pid: u32,
    process_name: String,
    command: String,
    connections: u32,
}

#[tauri::command]
async fn get_listening_ports() -> Result<Vec<PortEntry>, String> {
    tokio::task::spawn_blocking(|| {
        // lsof -i -P -n -sTCP:LISTEN — specifically asks for LISTEN sockets only
        let output = std::process::Command::new("lsof")
            .args(["-i", "-P", "-n", "-sTCP:LISTEN"])
            .output()
            .map_err(|e| format!("lsof failed: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut entries: Vec<PortEntry> = Vec::new();

        for line in stdout.lines().skip(1) {
            // lsof columns: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 10 { continue; }

            let process_name = parts[0].to_string();
            let pid: u32 = match parts[1].parse() {
                Ok(p) => p,
                Err(_) => continue,
            };
            let name = parts[8]; // e.g. *:3000 or 127.0.0.1:8080

            let port: u16 = match name.rsplit(':').next().and_then(|p| p.parse().ok()) {
                Some(p) => p,
                None => continue,
            };

            let state = if parts.len() > 9 {
                parts[9].trim_start_matches('(').trim_end_matches(')').to_string()
            } else {
                "LISTEN".into()
            };

            entries.push(PortEntry {
                port,
                protocol: "TCP".to_string(),
                state,
                pid,
                process_name: process_name.clone(),
                command: process_name,
                connections: 0,
            });
        }

        // Deduplicate by (pid, port) — lsof returns separate rows for IPv4/IPv6
        let mut seen = std::collections::HashSet::new();
        entries.retain(|e| seen.insert((e.pid, e.port)));

        // Enrich with full command lines via sysinfo
        {
            use sysinfo::{Pid, ProcessesToUpdate, System};
            let mut sys = System::new();
            let pids: Vec<Pid> = entries.iter().map(|l| Pid::from_u32(l.pid)).collect();
            sys.refresh_processes_specifics(ProcessesToUpdate::Some(&pids), true, Default::default());

            let proc_map: std::collections::HashMap<u32, String> = sys.processes().iter().map(|(pid, proc_info)| {
                let cmd_parts: Vec<String> = proc_info.cmd().iter().map(|s| s.to_string_lossy().to_string()).collect();
                let cmd = cmd_parts.join(" ");
                let display = if cmd.is_empty() { proc_info.name().to_string_lossy().to_string() } else { cmd };
                (pid.as_u32(), display)
            }).collect();

            for entry in &mut entries {
                if let Some(cmd) = proc_map.get(&entry.pid) {
                    entry.command = cmd.clone();
                }
            }
        }

        // Sort by port
        entries.sort_by_key(|e| e.port);

        Ok(entries)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
async fn kill_process(pid: u32) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        use sysinfo::{Pid, ProcessesToUpdate, System};
        let mut sys = System::new();
        sys.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[Pid::from_u32(pid)]),
            true,
            Default::default(),
        );
        if let Some(process) = sys.process(Pid::from_u32(pid)) {
            let name = process.name().to_string_lossy().to_string();
            if process.kill() {
                log::info!("Killed {} (PID {})", name, pid);
                Ok(true)
            } else {
                Err(format!("Failed to kill {} (PID {})", name, pid))
            }
        } else {
            Err(format!("Process {} not found", pid))
        }
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
fn get_hybrid_tile(z: u32, x: u32, y: u32) -> Result<String, String> {
    // Look in ~/.blip/hybrid-tiles/ (not bundled — too many files for app bundle)
    let home = dirs::home_dir().ok_or("No home dir")?;
    let tile_path = home.join(".blip").join("hybrid-tiles")
        .join(z.to_string()).join(x.to_string()).join(format!("{}.jpg", y));
    if tile_path.exists() {
        let data = std::fs::read(&tile_path).map_err(|e| e.to_string())?;
        Ok(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &data))
    } else {
        Err("Tile not found".to_string())
    }
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    // Hide menubar popup
    if let Some(menubar) = app.get_webview_window("menubar") {
        let _ = menubar.hide();
    }
    Ok(())
}

#[tauri::command]
fn update_dock_icon(png_base64: String) -> Result<(), String> {
    let data = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &png_base64,
    ).map_err(|e| format!("Base64 decode error: {}", e))?;
    dock_icon::set_dock_icon(&data);
    Ok(())
}

/// A blocked DNS attempt with geo coordinates for map display.
#[derive(Debug, Clone, serde::Serialize)]
struct BlockedAttempt {
    domain: String,
    dest_lat: f64,
    dest_lon: f64,
    city: Option<String>,
    country: Option<String>,
    timestamp_ms: u64,
    blocked_by: Option<String>,
    source_app: Option<String>,
}

#[tauri::command]
async fn get_blocked_attempts(state: tauri::State<'_, AppState>) -> Result<Vec<BlockedAttempt>, String> {
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

// ---- Historical data + preference commands ----

#[tauri::command]
async fn get_historical_endpoints(state: tauri::State<'_, AppState>) -> Result<Vec<db::HistoricalEndpoint>, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.get_historical_endpoints())
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
async fn get_historical_stats(state: tauri::State<'_, AppState>) -> Result<db::HistoricalStats, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.get_historical_stats())
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
async fn get_tracker_stats(state: tauri::State<'_, AppState>) -> Result<db::TrackerStats, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.get_tracker_stats())
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
async fn get_preference(state: tauri::State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.get_preference(&key))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
async fn set_preference(state: tauri::State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.set_preference(&key, &value))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
async fn reset_preferences(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.reset_preferences())
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
async fn clear_history(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.clear_history())
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

/// Auto-running diagnostic that writes snapshots every 5s to /tmp/blip-snapshots/
fn start_auto_diagnostics(store: ConnectionStore) {
    tokio::spawn(async move {
        let dir = std::path::Path::new("/tmp/blip-snapshots");
        let _ = std::fs::create_dir_all(dir);
        // Clear old snapshots
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let _ = std::fs::remove_file(entry.path());
            }
        }

        let mut tick = 0u32;
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
            tick += 1;

            let mut output = String::new();
            let now_label = chrono_now();

            // 1. Raw lsof
            let lsof = tokio::process::Command::new("lsof")
                .args(["-i", "-n", "-P", "+c", "0"])
                .output()
                .await;

            let lsof_lines: Vec<String> = match lsof {
                Ok(o) => String::from_utf8_lossy(&o.stdout)
                    .lines()
                    .filter(|l| l.contains("->") && !l.starts_with("COMMAND"))
                    .map(String::from)
                    .collect(),
                Err(e) => {
                    output.push_str(&format!("lsof error: {}\n", e));
                    vec![]
                }
            };

            // Parse lsof public IPs
            let mut lsof_public: Vec<(String, String, String)> = vec![]; // (ip:port, process, full_line)
            for line in &lsof_lines {
                let parts: Vec<&str> = line.split_whitespace().collect();
                let process = parts.first().copied().unwrap_or("?");
                if let Some(name) = parts.iter().find(|p| p.contains("->")) {
                    let arrow: Vec<&str> = name.split("->").collect();
                    if arrow.len() != 2 { continue; }
                    let remote = arrow[1].split(' ').next().unwrap_or(arrow[1]);
                    let (ip, port) = if remote.starts_with('[') {
                        if let Some(b) = remote.find(']') {
                            (remote[1..b].to_string(), remote.get(b+2..).unwrap_or("0").to_string())
                        } else { continue; }
                    } else if let Some(c) = remote.rfind(':') {
                        (remote[..c].to_string(), remote[c+1..].to_string())
                    } else { continue; };

                    // Skip private
                    if ip == "127.0.0.1" || ip == "::1" || ip == "0.0.0.0"
                        || ip.starts_with("fe80:") || ip.starts_with("10.")
                        || ip.starts_with("192.168.") || ip == "*" { continue; }
                    if ip.starts_with("172.") {
                        if let Some(s) = ip.split('.').nth(1) {
                            if let Ok(n) = s.parse::<u8>() {
                                if (16..=31).contains(&n) { continue; }
                            }
                        }
                    }

                    lsof_public.push((format!("{}:{}", ip, port), process.to_string(), line.clone()));
                }
            }

            // 2. Blip state
            let (blip_entries, total_ever, blip_ips) = {
                let state = store.read().unwrap();
                let entries: Vec<String> = state.connections.values().map(|c| {
                    format!("  {}:{} | {} | active={} | {:?}, {:?}",
                        c.dest_ip, c.dest_port,
                        c.process_name.as_deref().unwrap_or("?"),
                        c.active, c.city, c.country)
                }).collect();
                let ips: std::collections::HashSet<String> = state.connections.values()
                    .map(|c| format!("{}:{}", c.dest_ip, c.dest_port))
                    .collect();
                (entries, state.total_ever, ips)
            };

            // 3. Write snapshot
            output.push_str(&format!("=== SNAPSHOT #{} @ {} ===\n\n", tick, now_label));
            output.push_str(&format!("LSOF: {} total with ->, {} public (after filtering)\n", lsof_lines.len(), lsof_public.len()));
            output.push_str(&format!("BLIP: {} tracked, {} total ever\n\n", blip_entries.len(), total_ever));

            output.push_str("--- LSOF PUBLIC ---\n");
            for (key, proc, _) in &lsof_public {
                let tracked = if blip_ips.contains(key) { "OK" } else { "MISSING" };
                output.push_str(&format!("  [{}] {} ({})\n", tracked, key, proc));
            }

            output.push_str("\n--- BLIP TRACKED ---\n");
            for entry in &blip_entries {
                output.push_str(&format!("{}\n", entry));
            }

            // Missing connections
            let missing: Vec<&(String, String, String)> = lsof_public.iter()
                .filter(|(key, _, _)| !blip_ips.contains(key))
                .collect();

            output.push_str(&format!("\n--- MISSING FROM BLIP: {} ---\n", missing.len()));
            for (key, proc, line) in &missing {
                output.push_str(&format!("  {} ({}) | {}\n", key, proc, line.trim()));
            }

            let path = dir.join(format!("snapshot-{:03}.txt", tick));
            let _ = std::fs::write(&path, &output);
        }
    });
}

// ---- Diagnostics command ----

#[derive(serde::Serialize, Clone)]
struct DiagnosticItem {
    name: String,
    status: String, // "ok", "warning", "error"
    detail: String,
}

#[tauri::command]
async fn get_diagnostics(state: tauri::State<'_, AppState>) -> Result<Vec<DiagnosticItem>, String> {
    let mut items = Vec::new();

    // 1. Capture running?
    let running = state.running.load(Ordering::SeqCst);
    items.push(DiagnosticItem {
        name: "Network capture".into(),
        status: if running { "ok" } else { "error" }.into(),
        detail: if running { "Running — polling connections".into() } else { "Stopped".into() },
    });

    // 2. Elevation status
    let elevated = state.elevated.load(Ordering::SeqCst);
    items.push(DiagnosticItem {
        name: "Elevated access".into(),
        status: if elevated { "ok" } else { "warning" }.into(),
        detail: if elevated { "Active — seeing all system connections".into() } else { "Not elevated — limited to your user's connections".into() },
    });

    // 3. lsof available?
    let lsof = tokio::process::Command::new("lsof").arg("-v").output().await;
    items.push(DiagnosticItem {
        name: "lsof".into(),
        status: if lsof.is_ok() { "ok" } else { "error" }.into(),
        detail: match lsof {
            Ok(o) => {
                let ver = String::from_utf8_lossy(&o.stderr);
                let first = ver.lines().next().unwrap_or("available");
                format!("Available — {}", first.trim())
            },
            Err(e) => format!("Not found: {}", e),
        },
    });

    // 4. netstat available?
    let netstat = tokio::process::Command::new("netstat").arg("-V").output().await;
    items.push(DiagnosticItem {
        name: "netstat".into(),
        status: if netstat.is_ok() { "ok" } else { "error" }.into(),
        detail: if netstat.is_ok() { "Available".into() } else { "Not found".into() },
    });

    // 5. GeoIP database
    {
        let store = state.store.read().unwrap();
        let conn_count = store.connections.len();
        let with_geo = store.connections.values().filter(|c| c.dest_lat != 0.0 || c.dest_lon != 0.0).count();
        items.push(DiagnosticItem {
            name: "GeoIP database".into(),
            status: if with_geo > 0 || conn_count == 0 { "ok" } else { "warning" }.into(),
            detail: format!("{}/{} connections geolocated", with_geo, conn_count),
        });
    }

    // 6. DNS resolution
    {
        let store = state.store.read().unwrap();
        let conn_count = store.connections.len();
        let with_domain = store.connections.values().filter(|c| c.domain.is_some()).count();
        items.push(DiagnosticItem {
            name: "DNS resolution".into(),
            status: if with_domain > 0 || conn_count == 0 { "ok" } else { "warning" }.into(),
            detail: format!("{}/{} connections resolved", with_domain, conn_count),
        });
    }

    // 7. Blocklists
    let blocklists = state.blocklists.get_all();
    let enabled_count = blocklists.iter().filter(|b| b.enabled).count();
    let total_domains: usize = blocklists.iter().filter(|b| b.enabled).map(|b| b.domain_count).sum();
    items.push(DiagnosticItem {
        name: "Blocklists".into(),
        status: if enabled_count > 0 { "ok" } else { "warning" }.into(),
        detail: format!("{} active ({} domains)", enabled_count, total_domains),
    });

    // 8. Connection store stats
    {
        let store = state.store.read().unwrap();
        items.push(DiagnosticItem {
            name: "Connection store".into(),
            status: "ok".into(),
            detail: format!("{} active, {} total ever", store.connections.len(), store.total_ever),
        });
    }

    // 9. NE bridge socket
    {
        let socket_path = std::path::Path::new("/private/var/tmp/blip-ne.sock");
        if socket_path.exists() {
            let meta = std::fs::metadata(socket_path);
            let owner_info = match meta {
                Ok(_) => "exists".to_string(),
                Err(e) => format!("error: {}", e),
            };
            // Try to check if any NE is connected by looking at active connections
            items.push(DiagnosticItem {
                name: "NE bridge socket".into(),
                status: "ok".into(),
                detail: format!("Socket {} — {}", socket_path.display(), owner_info),
            });
        } else {
            items.push(DiagnosticItem {
                name: "NE bridge socket".into(),
                status: "error".into(),
                detail: format!("Socket not found at {}", socket_path.display()),
            });
        }
    }

    // 10. NE system extension process
    {
        let ne_proc = tokio::process::Command::new("pgrep")
            .arg("-f")
            .arg("com.infamousvague.blip.network-extension")
            .output()
            .await;
        let ne_running = ne_proc.map(|o| o.status.success()).unwrap_or(false);
        items.push(DiagnosticItem {
            name: "NE process".into(),
            status: if ne_running { "ok" } else { "error" }.into(),
            detail: if ne_running { "Running".into() } else { "Not running".into() },
        });
    }

    // 11. DNS proxy status (from NE bridge result file)
    {
        let result_path = dirs::home_dir()
            .map(|h| h.join(".blip/ne-result.json"))
            .unwrap_or_default();
        let dns_proxy_status = if let Ok(content) = std::fs::read_to_string(&result_path) {
            if content.contains("\"dns_proxy\":true") {
                ("ok", "Enabled".to_string())
            } else if content.contains("\"dns_proxy\":false") {
                ("error", "Disabled — DNS queries won't be captured".to_string())
            } else {
                ("warning", format!("Unknown: {}", content.chars().take(80).collect::<String>()))
            }
        } else {
            ("warning", "No status file found".to_string())
        };
        items.push(DiagnosticItem {
            name: "DNS proxy".into(),
            status: dns_proxy_status.0.into(),
            detail: dns_proxy_status.1,
        });
    }

    // 12. Installed NE version & providers
    {
        let ne_check = tokio::process::Command::new("bash")
            .arg("-c")
            .arg("for d in /Library/SystemExtensions/*/com.infamousvague.blip.network-extension.systemextension; do if [ -f \"$d/Contents/Info.plist\" ]; then plutil -extract CFBundleShortVersionString raw \"$d/Contents/Info.plist\" 2>/dev/null; echo -n ' | '; plutil -extract NetworkExtension.NEProviderClasses raw \"$d/Contents/Info.plist\" 2>/dev/null || echo 'no-providers'; break; fi; done")
            .output()
            .await;
        let ne_info = ne_check
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default();
        if ne_info.is_empty() {
            items.push(DiagnosticItem {
                name: "Installed NE version".into(),
                status: "error".into(),
                detail: "No NE installed in /Library/SystemExtensions".into(),
            });
        } else {
            let has_dns = ne_info.contains("dns-proxy");
            items.push(DiagnosticItem {
                name: "Installed NE version".into(),
                status: if has_dns { "ok" } else { "warning" }.into(),
                detail: ne_info,
            });
        }
    }

    // 13. Installed NE Info.plist provider classes
    {
        let plist_check = tokio::process::Command::new("bash")
            .arg("-c")
            .arg("for d in /Library/SystemExtensions/*/com.infamousvague.blip.network-extension.systemextension; do if [ -f \"$d/Contents/Info.plist\" ]; then plutil -p \"$d/Contents/Info.plist\" 2>/dev/null | grep -o 'networkextension\\.[a-z-]*'; fi; done | sort -u")
            .output()
            .await;
        let providers = plist_check
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default();
        let has_filter = providers.contains("filter-data");
        let has_dns = providers.contains("dns-proxy");
        items.push(DiagnosticItem {
            name: "NE provider classes".into(),
            status: if has_filter && has_dns { "ok" } else if has_filter { "warning" } else { "error" }.into(),
            detail: format!("Filter: {} | DNS proxy: {}", if has_filter { "yes" } else { "no" }, if has_dns { "yes" } else { "no" }),
        });
    }

    // 14. Enricher / ASN database
    {
        let enricher = state.enricher.lock().unwrap();
        let has_asn = enricher.has_asn_db();
        items.push(DiagnosticItem {
            name: "ASN database".into(),
            status: if has_asn { "ok" } else { "error" }.into(),
            detail: if has_asn { "Loaded — ISP/ASN lookups active".into() } else { "Not loaded — ISP will show Unknown".into() },
        });
    }

    // 15. DNS mapping stats
    {
        if let Ok(mapping) = state.dns_mapping.try_read() {
            let stats = mapping.stats();
            items.push(DiagnosticItem {
                name: "DNS mapping".into(),
                status: if stats.total_queries > 0 { "ok" } else { "warning" }.into(),
                detail: format!("{} queries, {} unique domains, {} blocked", stats.total_queries, stats.unique_domains, stats.blocked_count),
            });
        } else {
            items.push(DiagnosticItem {
                name: "DNS mapping".into(),
                status: "warning".into(),
                detail: "Lock busy".into(),
            });
        }
    }

    Ok(items)
}

fn chrono_now() -> String {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap();
    format!("{}.{:03}s", d.as_secs(), d.subsec_millis())
}

fn format_rate(bytes_per_sec: f64) -> String {
    if bytes_per_sec < 1024.0 {
        format!("{:.0} B/s", bytes_per_sec)
    } else if bytes_per_sec < 1024.0 * 1024.0 {
        format!("{:.1} KB/s", bytes_per_sec / 1024.0)
    } else if bytes_per_sec < 1024.0 * 1024.0 * 1024.0 {
        format!("{:.1} MB/s", bytes_per_sec / (1024.0 * 1024.0))
    } else {
        format!("{:.1} GB/s", bytes_per_sec / (1024.0 * 1024.0 * 1024.0))
    }
}

fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::tray::TrayIconBuilder;
    use tauri::image::Image;

    // Create a tiny 1x1 transparent pixel — macOS requires an icon but we only want the title text
    let icon = Image::new_owned(vec![0, 0, 0, 0], 1, 1);

    let tray = TrayIconBuilder::new()
        .icon(icon)
        .icon_as_template(true)
        .title("↑ — ↓ —")
        .tooltip("Blip Network Monitor")
        .on_tray_icon_event(|tray_icon, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                // Open the main desktop app window
                let app = tray_icon.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    // Start bandwidth polling to update tray title every second
    let tray_id = tray.id().clone();
    let app_handle = app.handle().clone();

    std::thread::spawn(move || {
        let mut prev_in: u64 = 0;
        let mut prev_out: u64 = 0;
        let mut prev_time = std::time::Instant::now();

        // Seed initial values
        if let Ok(output) = std::process::Command::new("netstat").args(["-ib"]).output() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let (tin, tout) = parse_netstat_bandwidth(&stdout);
            prev_in = tin;
            prev_out = tout;
        }

        loop {
            std::thread::sleep(std::time::Duration::from_secs(1));

            let output = match std::process::Command::new("netstat").args(["-ib"]).output() {
                Ok(o) => o,
                Err(_) => continue,
            };
            let stdout = String::from_utf8_lossy(&output.stdout);
            let (total_in, total_out) = parse_netstat_bandwidth(&stdout);

            let now = std::time::Instant::now();
            let elapsed = now.duration_since(prev_time).as_secs_f64();
            if elapsed > 0.1 {
                let rate_in = (total_in.saturating_sub(prev_in)) as f64 / elapsed;
                let rate_out = (total_out.saturating_sub(prev_out)) as f64 / elapsed;

                let title = format!("↑ {}  ↓ {}", format_rate(rate_out), format_rate(rate_in));

                if let Some(tray) = app_handle.tray_by_id(&tray_id) {
                    let _ = tray.set_title(Some(&title));
                }
            }

            prev_in = total_in;
            prev_out = total_out;
            prev_time = now;
        }
    });

    Ok(())
}

fn parse_netstat_bandwidth(stdout: &str) -> (u64, u64) {
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
    (total_in, total_out)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize database before Tauri builder
    let db = match Database::open() {
        Ok(db) => Arc::new(db),
        Err(e) => {
            eprintln!("FATAL: Failed to open database: {}", e);
            std::process::exit(1);
        }
    };

    // Load blocklists from DB
    let blocklists = Arc::new(BlocklistStore::new());
    let needs_default_blocklists = match db.load_blocklists() {
        Ok(entries) => {
            let count = entries.len();
            let empty = count == 0;
            blocklists.load_from_db(entries);
            if count > 0 {
                eprintln!("Loaded {} blocklists from database", count);
            }
            empty
        }
        Err(e) => {
            eprintln!("Warning: Failed to load blocklists: {}", e);
            true
        }
    };

    // Auto-load default blocklists on first run
    if needs_default_blocklists {
        let bl = blocklists.clone();
        let db2 = db.clone();
        std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            rt.block_on(async {
                let defaults = [
                    // Core ad/tracker blocking
                    ("Steven Black's Unified Hosts", "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts"),
                    ("Peter Lowe's Ad Servers", "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=0"),
                    ("AdGuard DNS Filter", "https://adguardteam.github.io/AdGuardSDNSFilter/Filters/filter.txt"),
                    // Comprehensive lists
                    ("Hagezi Multi Normal", "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/hosts/multi.txt"),
                    ("OISD Big", "https://big.oisd.nl/"),
                    // Tracking-specific
                    ("EasyPrivacy (domains)", "https://v.firebog.net/hosts/Easyprivacy.txt"),
                    ("Disconnect.me Tracking", "https://s3.amazonaws.com/lists.disconnect.me/simple_tracking.txt"),
                    ("Disconnect.me Ads", "https://s3.amazonaws.com/lists.disconnect.me/simple_ad.txt"),
                    // Malware/phishing
                    ("Phishing Army", "https://phishing.army/download/phishing_army_blocklist.txt"),
                    ("URLhaus Malware", "https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts.txt"),
                    // Social tracking
                    ("Fanboy Social (domains)", "https://v.firebog.net/hosts/Prigent-Crypto.txt"),
                    // Mobile-specific
                    ("GoodbyeAds", "https://raw.githubusercontent.com/jerryn70/GoodbyeAds/master/Hosts/GoodbyeAds.txt"),
                    // Telemetry
                    ("Windows Spy Blocker", "https://raw.githubusercontent.com/nicehash/host/master/spy.txt"),
                ];
                for (name, url) in defaults {
                    eprintln!("Downloading default blocklist: {}", name);
                    match reqwest::get(url).await {
                        Ok(resp) => match resp.text().await {
                            Ok(content) => {
                                let (info, domains) = bl.add(name.to_string(), url.to_string(), &content);
                                if let Err(e) = db2.save_blocklist(&info, &domains) {
                                    eprintln!("Failed to save default blocklist: {}", e);
                                } else {
                                    eprintln!("Loaded default blocklist '{}' ({} domains)", name, info.domain_count);
                                }
                            }
                            Err(e) => eprintln!("Failed to read blocklist '{}': {}", name, e),
                        },
                        Err(e) => eprintln!("Failed to download blocklist '{}': {}", name, e),
                    }
                }
            });
        });
    }

    // Start async batch writer on its own tokio runtime (runs before Tauri's runtime)
    let db_writer = Arc::new(DbWriter::start(db.clone()));

    // Initialize enricher with ASN database
    // We need the resource dir but don't have Tauri's app handle yet.
    // In a bundled app: exe is at Contents/MacOS/app, resources at Contents/Resources/resources
    // In dev mode: exe is at src-tauri/target/debug/app, resources at src-tauri/resources/
    let enricher = {
        let exe = std::env::current_exe().unwrap_or_default();
        let mac_os_dir = exe.parent().unwrap_or(std::path::Path::new("."));
        let bundled_dir = mac_os_dir.parent()
            .map(|contents| contents.join("Resources").join("resources"))
            .unwrap_or_else(|| mac_os_dir.join("resources"));
        // Dev fallback: CARGO_MANIFEST_DIR/resources
        let dev_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let resource_dir = if bundled_dir.join("dbip-asn.mmdb").exists() {
            bundled_dir
        } else {
            dev_dir
        };
        match Enricher::new(&resource_dir) {
            Ok(e) => {
                eprintln!("Enricher loaded (ASN database)");
                Arc::new(Mutex::new(e))
            }
            Err(e) => {
                eprintln!("Warning: Failed to load enricher: {}. Continuing without enrichment.", e);
                Arc::new(Mutex::new(Enricher::empty()))
            }
        }
    };

    eprintln!("[BOOT] Building Tauri app...");

    // Clean up session-scoped and expired firewall rules from previous run
    match db.cleanup_session_rules() {
        Ok(n) if n > 0 => eprintln!("[BOOT] Cleaned up {} session firewall rules", n),
        _ => {}
    }
    match db.cleanup_expired_rules() {
        Ok(n) if n > 0 => eprintln!("[BOOT] Cleaned up {} expired firewall rules", n),
        _ => {}
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_geolocation::init())
        .manage(AppState {
            running: Arc::new(AtomicBool::new(false)),
            elevated: Arc::new(AtomicBool::new(false)),
            elevating: Arc::new(AtomicBool::new(false)),
            store: Arc::new(StdRwLock::new(ConnectionState::new())),
            blocklists,
            db,
            db_writer,
            enricher,
            dns_mapping: Arc::new(RwLock::new(DnsMapping::new())),
            dns_capture: Arc::new(tokio::sync::Mutex::new(None)),
            geoip: Arc::new(StdRwLock::new(None)),
            speed_test_result: Arc::new(Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            start_capture,
            stop_capture,
            get_connections,
            get_connections_delta,
            get_bandwidth,
            request_elevation,
            check_elevation,
            disable_elevation,
            add_blocklist_url,
            add_blocklist_content,
            remove_blocklist,
            toggle_blocklist,
            get_blocklists,
            get_diagnostics,
            get_historical_endpoints,
            get_historical_stats,
            get_tracker_stats,
            get_preference,
            set_preference,
            get_self_info,
            get_user_location,
            get_dns_log,
            get_dns_stats,
            get_blocked_attempts,
            run_speed_test,
            get_last_speed_test,
            update_dock_icon,
            get_hybrid_tile,
            activate_network_extension,
            deactivate_network_extension,
            get_network_extension_status,
            get_firewall_rules,
            set_firewall_rule,
            delete_firewall_rule,
            delete_firewall_rule_by_id,
            get_app_list,
            get_firewall_mode,
            set_firewall_mode,
            export_firewall_rules,
            import_firewall_rules,
            get_app_icons,
            get_listening_ports,
            kill_process,
            show_main_window,
            reset_preferences,
            clear_history
        ])
        .setup(|app| {
            eprintln!("[BOOT] Setup starting...");
            // Always log to a fixed file path + stdout
            let log_path = std::path::PathBuf::from("/tmp/blip-debug.log");
            // Clear previous log
            let _ = std::fs::write(&log_path, "");

            let log_builder = tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Debug)
                .level_for("maxminddb", log::LevelFilter::Warn)
                .level_for("tao", log::LevelFilter::Warn)
                .level_for("wry", log::LevelFilter::Warn)
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Folder {
                        path: std::path::PathBuf::from("/tmp"),
                        file_name: Some("blip-debug".into()),
                    },
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                ));

            app.handle().plugin(log_builder.build())?;
            eprintln!("[BOOT] Log plugin initialized");
            log::info!("Blip started — logs at /tmp/blip-debug.log");

            // Set up menu bar tray icon with live bandwidth text
            setup_tray(app)?;

            eprintln!("[BOOT] Setup complete, running...");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
