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
use std::sync::{Arc, Mutex};
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

/// Returns all current connections — frontend polls this
#[tauri::command]
fn get_connections(state: tauri::State<AppState>) -> CaptureSnapshot {
    let store = state.store.lock().unwrap();
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
        ).await {
            log::warn!("NE bridge failed to start (continuing without): {}", e);
        }

        // Start auto-diagnostics that write snapshots every 5s
        start_auto_diagnostics(store.clone());

        log::info!("Enricher ready");
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
                    let resource_dir = exe.parent().unwrap_or(std::path::Path::new(".")).join("resources");
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
    // Check if the NE dylib is available (production build)
    let dylib_available = find_resource(&app, "libblip_ne_bridge.dylib").is_some();
    if !dylib_available {
        log::info!("NE status: dylib not found, returning unavailable");
        return Ok("{\"status\":\"unavailable\"}".into());
    }

    // Check for a result file from a previous activation
    let result_path = dirs::home_dir()
        .unwrap_or_default()
        .join(".blip")
        .join("ne-result.json");
    if let Ok(content) = tokio::fs::read_to_string(&result_path).await {
        let content = content.trim().to_string();
        if !content.is_empty() && content.contains("status") {
            log::info!("NE status from result file: {}", content);
            return Ok(content);
        }
    }

    // Check if the system extension is registered via systemextensionsctl
    let output = tokio::process::Command::new("systemextensionsctl")
        .arg("list")
        .output()
        .await;

    if let Ok(output) = output {
        let stdout = String::from_utf8_lossy(&output.stdout);
        log::info!("systemextensionsctl output: {}", stdout.chars().take(500).collect::<String>());
        if stdout.contains("com.infamousvague.blip.network-extension") {
            if stdout.contains("[activated enabled]") {
                return Ok("{\"status\":\"active\"}".into());
            }
            return Ok("{\"status\":\"inactive\"}".into());
        }
    }

    log::info!("NE status: not_installed (dylib available, ready to enable)");
    Ok("{\"status\":\"not_installed\"}".into())
}

// ---- DNS capture commands ----

#[tauri::command]
async fn get_dns_log(state: tauri::State<'_, AppState>) -> Result<Vec<DnsQueryLogEntry>, String> {
    let mapping = state.dns_mapping.read().await;
    Ok(mapping.recent_log(200))
}

#[tauri::command]
async fn get_dns_stats(state: tauri::State<'_, AppState>) -> Result<DnsStats, String> {
    let mapping = state.dns_mapping.read().await;
    Ok(mapping.stats())
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
                let state = store.lock().unwrap();
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
        let store = state.store.lock().unwrap();
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
        let store = state.store.lock().unwrap();
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
        let store = state.store.lock().unwrap();
        items.push(DiagnosticItem {
            name: "Connection store".into(),
            status: "ok".into(),
            detail: format!("{} active, {} total ever", store.connections.len(), store.total_ever),
        });
    }

    Ok(items)
}

fn chrono_now() -> String {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap();
    format!("{}.{:03}s", d.as_secs(), d.subsec_millis())
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
                    ("Steven Black's Unified Hosts", "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts"),
                    ("AdGuard DNS Filter", "https://adguardteam.github.io/AdGuardSDNSFilter/Filters/filter.txt"),
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
    // The resources are at the executable's parent dir / resources
    let enricher = {
        let exe = std::env::current_exe().unwrap_or_default();
        let resource_dir = exe.parent().unwrap_or(std::path::Path::new(".")).join("resources");
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

    tauri::Builder::default()
        .plugin(tauri_plugin_geolocation::init())
        .manage(AppState {
            running: Arc::new(AtomicBool::new(false)),
            elevated: Arc::new(AtomicBool::new(false)),
            elevating: Arc::new(AtomicBool::new(false)),
            store: Arc::new(Mutex::new(ConnectionState::new())),
            blocklists,
            db,
            db_writer,
            enricher,
            dns_mapping: Arc::new(RwLock::new(DnsMapping::new())),
            dns_capture: Arc::new(tokio::sync::Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            start_capture,
            stop_capture,
            get_connections,
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
            activate_network_extension,
            deactivate_network_extension,
            get_network_extension_status
        ])
        .setup(|_app| {
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

            _app.handle().plugin(log_builder.build())?;
            log::info!("Blip started — logs at /tmp/blip-debug.log");

            // Open devtools to debug production builds
            if let Some(window) = _app.get_webview_window("main") {
                window.open_devtools();
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
