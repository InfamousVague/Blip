#[allow(dead_code)]
mod blocklist;
mod capture;
mod commands;
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
pub(crate) mod state;
mod dock_icon;
pub mod firewall;
pub mod wifi;
pub mod traceroute;

use blocklist::{BlocklistInfo, BlocklistStore};
use capture::nettop::ConnectionState;
use db::Database;
use db_writer::DbWriter;
use dns_capture::types::DnsMapping;
use enrichment::Enricher;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock as StdRwLock};
use tauri::Manager;
use tokio::sync::RwLock;

use state::{AppState, TileServerState};


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


// --- WiFi Scanner ---

#[tauri::command]
async fn scan_wifi() -> Result<Vec<wifi::WifiNetwork>, String> {
    wifi::scan().await
}

#[tauri::command]
async fn get_wifi_recommendation() -> Result<wifi::analysis::ChannelRecommendation, String> {
    let networks = wifi::scan().await?;
    Ok(wifi::analysis::analyze(&networks))
}

// --- NE Live Status ---

struct NEStatusState {
    status: std::sync::Mutex<ne_bridge::types::NELiveStatus>,
}

#[tauri::command]
fn get_ne_live_status(app: tauri::AppHandle) -> Result<ne_bridge::types::NELiveStatus, String> {
    let state: tauri::State<NEStatusState> = app.state();
    let s = state.status.lock().map_err(|e| e.to_string())?;
    Ok(s.clone())
}

#[tauri::command]
fn get_expected_ne_version() -> String {
    ne_bridge::EXPECTED_NE_VERSION.to_string()
}

// --- Offline tile serving via local HTTP ---

use std::collections::HashMap;

/// State holding the local tile server port (0 = not started / no pmtiles found)

/// Spawn a minimal HTTP file server that serves multiple PMTiles files with Range request support.
/// Files are served at /{filename}.pmtiles. Returns the port it's listening on.
async fn start_tile_server(dirs: Vec<std::path::PathBuf>) -> u16 {
    use tokio::net::TcpListener;
    use tokio::io::AsyncWriteExt;

    // Load all .pmtiles files from multiple directories into memory
    let mut files: HashMap<String, std::sync::Arc<Vec<u8>>> = HashMap::new();
    for dir in &dirs {
        eprintln!("[BOOT] Scanning for PMTiles in: {:?}", dir);
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().map_or(false, |e| e == "pmtiles") {
                    let name = path.file_name().unwrap().to_string_lossy().to_string();
                    let key = format!("/{}", name);
                    if files.contains_key(&key) { continue; } // skip duplicates
                    match std::fs::read(&path) {
                        Ok(d) => {
                            eprintln!("[BOOT] Loaded {} ({:.1} MB)", name, d.len() as f64 / 1_048_576.0);
                            files.insert(key, std::sync::Arc::new(d));
                        }
                        Err(e) => eprintln!("[BOOT] Failed to read {}: {}", name, e),
                    }
                }
            }
        }
    }

    eprintln!("[BOOT] PMTiles loaded: {:?}", files.keys().collect::<Vec<_>>());
    if files.is_empty() {
        eprintln!("[BOOT] No PMTiles files found in {:?} — tile server not started", dirs);
        return 0;
    }

    let files = std::sync::Arc::new(files);

    // Bind to a random available port on localhost
    let listener = match TcpListener::bind("127.0.0.1:0").await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[BOOT] Failed to bind tile server: {}", e);
            return 0;
        }
    };
    let port = listener.local_addr().unwrap().port();
    eprintln!("[BOOT] Tile server listening on http://127.0.0.1:{}", port);

    // Serve connections in the background
    tokio::spawn(async move {
        loop {
            let (mut stream, _) = match listener.accept().await {
                Ok(s) => s,
                Err(_) => continue,
            };
            let files = files.clone();
            tokio::spawn(async move {
                let mut buf = vec![0u8; 4096];
                let n = match tokio::io::AsyncReadExt::read(&mut stream, &mut buf).await {
                    Ok(n) if n > 0 => n,
                    _ => return,
                };
                let request = String::from_utf8_lossy(&buf[..n]);

                // Parse request path from "GET /planet.pmtiles HTTP/1.1"
                let req_path = request.split_whitespace().nth(1).unwrap_or("/");

                // Handle CORS preflight
                if request.starts_with("OPTIONS") {
                    let cors = "HTTP/1.1 204 No Content\r\n\
                        Access-Control-Allow-Origin: *\r\n\
                        Access-Control-Allow-Methods: GET, OPTIONS\r\n\
                        Access-Control-Allow-Headers: Range\r\n\
                        Access-Control-Max-Age: 86400\r\n\
                        Connection: close\r\n\r\n";
                    let _ = tokio::io::AsyncWriteExt::write_all(&mut stream, cors.as_bytes()).await;
                    return;
                }

                // Find the requested file
                // Strip query string if present (pmtiles lib may add cache busters)
                let clean_path = req_path.split('?').next().unwrap_or(req_path);
                let data = match files.get(clean_path) {
                    Some(d) => d.clone(),
                    None => {
                        eprintln!("[tile-server] 404: {} (available: {:?})", clean_path, files.keys().collect::<Vec<_>>());
                        let resp = "HTTP/1.1 404 Not Found\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                        let _ = tokio::io::AsyncWriteExt::write_all(&mut stream, resp.as_bytes()).await;
                        return;
                    }
                };

                // Parse Range header if present
                let (start, end) = if let Some(range_line) = request.lines()
                    .find(|l| l.to_lowercase().starts_with("range:"))
                {
                    let spec = range_line.split('=').nth(1).unwrap_or("");
                    let parts: Vec<&str> = spec.trim().split('-').collect();
                    let s: usize = parts.first().and_then(|p| p.parse().ok()).unwrap_or(0);
                    let e: usize = parts.get(1)
                        .and_then(|p| if p.is_empty() { None } else { p.parse().ok() })
                        .unwrap_or(data.len() - 1)
                        .min(data.len() - 1);
                    (s, e)
                } else {
                    (0, data.len() - 1)
                };

                let slice = &data[start..=end];
                let is_range = start > 0 || end < data.len() - 1;
                let status = if is_range { "206 Partial Content" } else { "200 OK" };

                let header = format!(
                    "HTTP/1.1 {status}\r\n\
                     Content-Type: application/octet-stream\r\n\
                     Content-Length: {}\r\n\
                     Accept-Ranges: bytes\r\n\
                     Content-Range: bytes {start}-{end}/{}\r\n\
                     Access-Control-Allow-Origin: *\r\n\
                     Access-Control-Allow-Headers: Range\r\n\
                     Access-Control-Expose-Headers: Content-Range\r\n\
                     Connection: close\r\n\r\n",
                    slice.len(),
                    data.len(),
                );

                let _ = tokio::io::AsyncWriteExt::write_all(&mut stream, header.as_bytes()).await;
                let _ = tokio::io::AsyncWriteExt::write_all(&mut stream, slice).await;
            });
        }
    });

    port
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
        .plugin(tauri_plugin_notification::init())
        .manage(NEStatusState {
            status: std::sync::Mutex::new(ne_bridge::types::NELiveStatus::default()),
        })
        .manage(TileServerState {
            port: std::sync::Arc::new(std::sync::atomic::AtomicU16::new(0)),
        })
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
            speed_test_running: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            ne_broadcast: Arc::new(Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            commands::capture::start_capture,
            commands::capture::stop_capture,
            commands::capture::get_connections,
            commands::capture::get_connections_delta,
            commands::capture::get_bandwidth,
            commands::capture::request_elevation,
            commands::capture::check_elevation,
            commands::capture::disable_elevation,
            add_blocklist_url,
            add_blocklist_content,
            remove_blocklist,
            toggle_blocklist,
            get_blocklists,
            commands::diagnostics::get_diagnostics,
            commands::system::get_historical_endpoints,
            commands::system::get_historical_stats,
            commands::system::get_tracker_stats,
            commands::system::get_preference,
            commands::system::set_preference,
            commands::system::get_self_info,
            commands::system::get_user_location,
            commands::dns::get_dns_log,
            commands::dns::get_dns_stats,
            commands::dns::get_blocked_attempts,
            commands::speedtest::run_speed_test,
            commands::speedtest::get_last_speed_test,
            commands::system::update_dock_icon,

            commands::system::activate_network_extension,
            commands::system::deactivate_network_extension,
            commands::system::get_network_extension_status,
            commands::firewall::get_firewall_rules,
            commands::firewall::set_firewall_rule,
            commands::firewall::delete_firewall_rule,
            commands::firewall::delete_firewall_rule_by_id,
            commands::firewall::get_app_list,
            commands::firewall::get_firewall_mode,
            commands::firewall::set_firewall_mode,
            commands::firewall::export_firewall_rules,
            commands::firewall::import_firewall_rules,
            commands::system::get_app_icons,
            commands::system::get_listening_ports,
            commands::system::kill_process,
            commands::system::show_main_window,
            commands::system::reset_preferences,
            commands::system::clear_history,
            commands::system::get_tile_server_port,
            commands::system::get_offline_glyph,
            get_ne_live_status,
            get_expected_ne_version,
            scan_wifi,
            get_wifi_recommendation,
            commands::network::trace_route,
            commands::system::get_database_stats,
            commands::network::get_traced_route,
            commands::network::get_all_traced_routes,

            // Firewall v2 commands
            commands::firewall::get_firewall_rules_v2,
            commands::firewall::create_firewall_rule_v2,
            commands::firewall::update_firewall_rule_v2,
            commands::firewall::delete_firewall_rule_v2,
            commands::firewall::check_rule_conflicts,
            commands::firewall::get_app_registry,
            commands::firewall::get_network_profiles,
            commands::firewall::create_network_profile,
            commands::firewall::delete_network_profile,
            commands::firewall::switch_network_profile,
            commands::firewall::get_block_history,
            commands::firewall::get_block_stats_hourly,
            commands::firewall::get_privacy_scores,
            commands::firewall::get_firewall_state,
            commands::firewall::toggle_kill_switch,
            commands::firewall::complete_setup_wizard,
            commands::firewall::respond_to_approval,
            commands::firewall::get_system_whitelist,
            commands::firewall::export_firewall_config,
            commands::firewall::import_firewall_config
        ])
        .setup(|app| {
            eprintln!("[BOOT] Setup starting...");

            // Open devtools automatically in debug builds
            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }

            // Start local tile server for offline PMTiles support
            let res_dir = app.path().resource_dir()
                .expect("failed to resolve resource dir")
                .join("resources");
            let dev_res_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");

            // Scan both bundled and dev source directories for pmtiles files.
            // In dev mode, some files may be in target/debug/resources/ (copied by Tauri)
            // while newer files are only in src-tauri/resources/ (source).
            // Merge both, preferring bundled over dev for duplicates.
            let tile_dirs = vec![res_dir.clone(), dev_res_dir.clone()];

            let port_ref = {
                let tile_state: tauri::State<TileServerState> = app.state();
                tile_state.port.clone()
            };
            tauri::async_runtime::spawn(async move {
                let port = start_tile_server(tile_dirs).await;
                port_ref.store(port, std::sync::atomic::Ordering::Relaxed);
            });

            // Always log to a fixed file path + stdout
            let log_path = std::path::PathBuf::from("/tmp/blip-debug.log");
            // Clear previous log
            let _ = std::fs::write(&log_path, "");

            let log_level = if cfg!(debug_assertions) {
                log::LevelFilter::Info // dev mode: info and above
            } else {
                log::LevelFilter::Info // release: info and above
            };

            let log_builder = tauri_plugin_log::Builder::default()
                .level(log_level)
                .level_for("maxminddb", log::LevelFilter::Warn)
                .level_for("tao", log::LevelFilter::Warn)
                .level_for("wry", log::LevelFilter::Warn)
                .level_for("reqwest", log::LevelFilter::Warn)
                .level_for("hyper", log::LevelFilter::Warn)
                .level_for("tauri_plugin_updater", log::LevelFilter::Warn)
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
            commands::system::setup_tray(app)?;

            // Data retention cleanup — on launch + every 6 hours
            {
                let cleanup_db = app.state::<AppState>().db.clone();
                let run_cleanup = move || {
                    let days_str = cleanup_db.get_preference("data_retention_days").ok().flatten().unwrap_or_default();
                    let days: u32 = days_str.parse().unwrap_or(30);
                    if days > 0 {
                        let (conns, dns) = cleanup_db.cleanup_old_data(days);
                        if conns > 0 || dns > 0 {
                            log::info!("[cleanup] Deleted {} connections + {} DNS queries older than {} days", conns, dns, days);
                        }
                    }
                };
                // Run on launch
                run_cleanup();
                // Run every 6 hours
                let cleanup_db2 = app.state::<AppState>().db.clone();
                std::thread::spawn(move || {
                    loop {
                        std::thread::sleep(std::time::Duration::from_secs(6 * 60 * 60));
                        let days_str = cleanup_db2.get_preference("data_retention_days").ok().flatten().unwrap_or_default();
                        let days: u32 = days_str.parse().unwrap_or(30);
                        if days > 0 {
                            let (conns, dns) = cleanup_db2.cleanup_old_data(days);
                            if conns > 0 || dns > 0 {
                                log::info!("[cleanup] Periodic: deleted {} connections + {} DNS queries", conns, dns);
                            }
                        }
                    }
                });
            }

            eprintln!("[BOOT] Setup complete, running...");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
