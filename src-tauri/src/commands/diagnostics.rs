use crate::capture::nettop::ConnectionStore;
use crate::state::AppState;
use std::sync::atomic::Ordering;

#[derive(serde::Serialize, Clone)]
pub struct DiagnosticItem {
    pub name: String,
    pub status: String, // "ok", "warning", "error"
    pub detail: String,
}

#[tauri::command]
pub async fn get_diagnostics(state: tauri::State<'_, AppState>) -> Result<Vec<DiagnosticItem>, String> {
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

/// Auto-running diagnostic that writes snapshots every 5s to /tmp/blip-snapshots/
pub(crate) fn start_auto_diagnostics(store: ConnectionStore) {
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

fn chrono_now() -> String {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap();
    format!("{}.{:03}s", d.as_secs(), d.subsec_millis())
}

pub(crate) fn format_rate(bytes_per_sec: f64) -> String {
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
