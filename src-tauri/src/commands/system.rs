use crate::db;
use crate::dock_icon;
use crate::enrichment;
use crate::state::{AppState, TileServerState};

use tauri::Manager;

// ---- Preference commands ----

#[tauri::command]
pub async fn get_preference(state: tauri::State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.get_preference(&key))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn set_preference(state: tauri::State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.set_preference(&key, &value))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn reset_preferences(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.reset_preferences())
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn clear_history(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.clear_history())
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

// ---- Self IP info ----

#[tauri::command]
pub async fn get_self_info(state: tauri::State<'_, AppState>) -> Result<enrichment::SelfIpInfo, String> {
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

// ---- Geolocation ----

#[derive(serde::Serialize)]
pub struct UserLocation {
    latitude: f64,
    longitude: f64,
    ip: String,
}

#[tauri::command]
pub async fn get_user_location() -> Result<UserLocation, String> {
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

// ---- Network Extension commands ----

/// Find a resource binary, checking both bundled and dev paths.
pub fn find_resource(app: &tauri::AppHandle, name: &str) -> Option<std::path::PathBuf> {
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

pub fn get_ne_bridge_lib(app: &tauri::AppHandle) -> Result<&'static libloading::Library, String> {
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
pub fn call_ne_bridge_fire(app: &tauri::AppHandle, func_name: &str) -> Result<String, String> {
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
pub async fn poll_ne_result(timeout_ms: u64) -> Result<String, String> {
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
pub async fn activate_network_extension(app: tauri::AppHandle) -> Result<String, String> {
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
pub async fn deactivate_network_extension(app: tauri::AppHandle) -> Result<String, String> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        call_ne_bridge_fire(&app_clone, "blip_ne_deactivate")
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    poll_ne_result(10_000).await
}

#[tauri::command]
pub async fn get_network_extension_status(app: tauri::AppHandle) -> Result<String, String> {
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

// ---- Tile server / offline map commands ----

/// Returns the local tile server port (0 if not available)
#[tauri::command]
pub fn get_tile_server_port(state: tauri::State<TileServerState>) -> u16 {
    state.port.load(std::sync::atomic::Ordering::Relaxed)
}

#[tauri::command]
pub fn get_offline_glyph(app: tauri::AppHandle, fontstack: String, range: String) -> Result<String, String> {
    let resource_path = app.path().resource_dir()
        .map_err(|e| e.to_string())?
        .join("resources")
        .join("fonts")
        .join(&fontstack)
        .join(format!("{}.pbf", range));

    if resource_path.exists() {
        let data = std::fs::read(&resource_path).map_err(|e| e.to_string())?;
        Ok(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &data))
    } else {
        Err(format!("Glyph not found: {}/{}", fontstack, range))
    }
}

// ---- Window management ----

#[tauri::command]
pub fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
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

// ---- Database stats ----

#[derive(serde::Serialize)]
pub struct DatabaseStats {
    file_size_bytes: u64,
    connections: u64,
    dns_queries: u64,
    traced_routes: u64,
    firewall_rules: u64,
}

#[tauri::command]
pub fn get_database_stats(state: tauri::State<AppState>) -> DatabaseStats {
    let (connections, dns_queries, traced_routes, firewall_rules) = state.db.get_database_stats();
    let db_path = state.db.get_database_path();
    let file_size_bytes = std::fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0);
    DatabaseStats { file_size_bytes, connections, dns_queries, traced_routes, firewall_rules }
}

// ---- Dock icon ----

#[tauri::command]
pub fn update_dock_icon(png_base64: String) -> Result<(), String> {
    let data = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &png_base64,
    ).map_err(|e| format!("Base64 decode error: {}", e))?;
    dock_icon::set_dock_icon(&data);
    Ok(())
}

// ---- App icon resolution ----

#[tauri::command]
pub async fn get_app_icons(bundle_ids: Vec<String>) -> Result<std::collections::HashMap<String, String>, String> {
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

// ---- Historical data commands ----

#[tauri::command]
pub async fn get_historical_endpoints(state: tauri::State<'_, AppState>) -> Result<Vec<db::HistoricalEndpoint>, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.get_historical_endpoints())
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn get_historical_stats(state: tauri::State<'_, AppState>) -> Result<db::HistoricalStats, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.get_historical_stats())
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn get_tracker_stats(state: tauri::State<'_, AppState>) -> Result<db::TrackerStats, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.get_tracker_stats())
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

// ---- Port / process management ----

#[derive(Debug, Clone, serde::Serialize)]
pub struct PortEntry {
    port: u16,
    protocol: String,
    state: String,
    pid: u32,
    process_name: String,
    command: String,
    connections: u32,
}

#[tauri::command]
pub async fn get_listening_ports() -> Result<Vec<PortEntry>, String> {
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
pub async fn kill_process(pid: u32) -> Result<bool, String> {
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

// ---- Tray setup ----

pub fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
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

                let title = format!("↑ {}  ↓ {}", super::diagnostics::format_rate(rate_out), super::diagnostics::format_rate(rate_in));

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
