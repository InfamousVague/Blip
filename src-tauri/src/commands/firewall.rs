use crate::db;
use crate::firewall;
use crate::state::AppState;

// ---- V1 Firewall commands ----

#[tauri::command]
pub async fn get_firewall_rules(state: tauri::State<'_, AppState>) -> Result<Vec<db::FirewallRule>, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.get_firewall_rules())
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn set_firewall_rule(
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
pub async fn delete_firewall_rule(state: tauri::State<'_, AppState>, app_id: String) -> Result<(), String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.delete_firewall_rule(&app_id))
        .await
        .map_err(|e| format!("Task error: {}", e))??;

    sync_firewall_rules_to_ne(&state).await;
    Ok(())
}

#[tauri::command]
pub async fn delete_firewall_rule_by_id(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.delete_firewall_rule_by_id(&id))
        .await
        .map_err(|e| format!("Task error: {}", e))??;

    sync_firewall_rules_to_ne(&state).await;
    Ok(())
}

#[tauri::command]
pub async fn get_app_list(state: tauri::State<'_, AppState>) -> Result<Vec<db::AppConnectionInfo>, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.get_app_connections())
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn get_firewall_mode(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let db = state.db.clone();
    let mode = tokio::task::spawn_blocking(move || db.get_preference("firewall_mode"))
        .await
        .map_err(|e| format!("Task error: {}", e))??;
    Ok(mode.unwrap_or_else(|| "ask".to_string()))
}

#[tauri::command]
pub async fn set_firewall_mode(state: tauri::State<'_, AppState>, mode: String) -> Result<(), String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.set_preference("firewall_mode", &mode))
        .await
        .map_err(|e| format!("Task error: {}", e))??;
    // Push the mode change to connected NE clients immediately
    sync_firewall_rules_to_ne(&state).await;
    Ok(())
}

#[tauri::command]
pub async fn export_firewall_rules(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let db = state.db.clone();
    let rules = tokio::task::spawn_blocking(move || db.get_firewall_rules())
        .await
        .map_err(|e| format!("Task error: {}", e))??;
    serde_json::to_string_pretty(&rules).map_err(|e| format!("Serialize error: {}", e))
}

#[tauri::command]
pub async fn import_firewall_rules(state: tauri::State<'_, AppState>, json: String) -> Result<usize, String> {
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

// ---- V2 Firewall commands ----

#[tauri::command]
pub async fn get_firewall_rules_v2(
    state: tauri::State<'_, AppState>,
    profile_id: Option<String>,
) -> Result<Vec<firewall::types::FirewallRule>, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.get_firewall_rules_v2(profile_id.as_deref()))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn create_firewall_rule_v2(
    state: tauri::State<'_, AppState>,
    rule: firewall::types::NewRuleRequest,
) -> Result<firewall::types::FirewallRule, String> {
    let db = state.db.clone();
    let result = tokio::task::spawn_blocking(move || db.create_firewall_rule_v2(&rule))
        .await
        .map_err(|e| format!("Task error: {}", e))??;
    sync_firewall_rules_to_ne(&state).await;
    Ok(result)
}

#[tauri::command]
pub async fn update_firewall_rule_v2(
    state: tauri::State<'_, AppState>,
    id: String,
    action: Option<String>,
    domain_pattern: Option<String>,
    domain_match_type: Option<String>,
    port: Option<String>,
    protocol: Option<String>,
    direction: Option<String>,
    lifetime: Option<String>,
    enabled: Option<bool>,
    priority: Option<i32>,
) -> Result<firewall::types::FirewallRule, String> {
    let db = state.db.clone();
    let result = tokio::task::spawn_blocking(move || {
        db.update_firewall_rule_v2(
            &id,
            action.as_deref(),
            domain_pattern.as_deref(),
            domain_match_type.as_deref(),
            port.as_deref(),
            protocol.as_deref(),
            direction.as_deref(),
            lifetime.as_deref(),
            enabled,
            priority,
        )
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;
    sync_firewall_rules_to_ne(&state).await;
    Ok(result)
}

#[tauri::command]
pub async fn delete_firewall_rule_v2(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.delete_firewall_rule_v2(&id))
        .await
        .map_err(|e| format!("Task error: {}", e))??;
    sync_firewall_rules_to_ne(&state).await;
    Ok(())
}

#[tauri::command]
pub async fn check_rule_conflicts(
    state: tauri::State<'_, AppState>,
    rule: firewall::types::NewRuleRequest,
) -> Result<Vec<firewall::types::RuleConflict>, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.check_rule_conflicts(&rule))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn get_app_registry(state: tauri::State<'_, AppState>) -> Result<Vec<firewall::types::AppInfo>, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.get_app_registry())
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

// ---- Profiles & State commands ----

#[tauri::command]
pub async fn get_network_profiles(state: tauri::State<'_, AppState>) -> Result<Vec<firewall::types::NetworkProfile>, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.get_network_profiles())
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn create_network_profile(
    state: tauri::State<'_, AppState>,
    name: String,
    description: Option<String>,
    auto_switch_ssid: Option<String>,
    auto_switch_vpn: bool,
) -> Result<firewall::types::NetworkProfile, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || {
        db.create_network_profile(&name, description.as_deref(), auto_switch_ssid.as_deref(), auto_switch_vpn)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn delete_network_profile(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.delete_network_profile(&id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn switch_network_profile(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.switch_network_profile(&id))
        .await
        .map_err(|e| format!("Task error: {}", e))??;
    sync_firewall_rules_to_ne(&state).await;
    Ok(())
}

#[tauri::command]
pub async fn get_block_history(
    state: tauri::State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<firewall::types::BlockHistoryEntry>, String> {
    let db = state.db.clone();
    let lim = limit.unwrap_or(100);
    tokio::task::spawn_blocking(move || db.get_block_history(lim))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn get_block_stats_hourly(
    state: tauri::State<'_, AppState>,
    hours_back: u32,
) -> Result<Vec<firewall::types::BlockStatsHourly>, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.get_block_stats_hourly(hours_back))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn get_privacy_scores(state: tauri::State<'_, AppState>) -> Result<Vec<firewall::types::PrivacyScore>, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.get_all_privacy_scores())
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn get_firewall_state(state: tauri::State<'_, AppState>) -> Result<firewall::types::FirewallState, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || {
        let mode = db.get_preference("firewall_mode")
            .ok().flatten().unwrap_or_else(|| "ask".to_string());
        let kill_switch = db.get_preference("kill_switch_active")
            .ok().flatten().map(|v| v == "true").unwrap_or(false);
        let profile_id = db.get_active_profile_id();
        let wizard_completed = db.get_preference("firewall_wizard_completed")
            .ok().flatten().map(|v| v == "true").unwrap_or(false);

        Ok(firewall::types::FirewallState {
            mode,
            kill_switch_active: kill_switch,
            active_profile_id: profile_id,
            wizard_completed,
        })
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn toggle_kill_switch(state: tauri::State<'_, AppState>, active: bool) -> Result<(), String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.set_preference("kill_switch_active", if active { "true" } else { "false" }))
        .await
        .map_err(|e| format!("Task error: {}", e))??;
    // Sync to NE immediately
    sync_firewall_rules_to_ne(&state).await;
    Ok(())
}

#[tauri::command]
pub async fn complete_setup_wizard(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.set_preference("firewall_wizard_completed", "true"))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

#[tauri::command]
pub async fn respond_to_approval(
    state: tauri::State<'_, AppState>,
    _request_id: String,
    action: String,
    lifetime: String,
    app_id: String,
    app_name: String,
    domain: Option<String>,
    dest_port: Option<u16>,
    protocol: Option<String>,
) -> Result<(), String> {
    // Create a rule based on the approval response
    if action != "dismiss" {
        let db = state.db.clone();
        let rule_action = action.clone();
        let rule_lifetime = lifetime.clone();
        let rule_domain = domain.clone();
        let rule_port = dest_port.map(|p| p.to_string());
        let rule_protocol = protocol.clone();
        tokio::task::spawn_blocking(move || {
            db.create_firewall_rule_v2(&firewall::types::NewRuleRequest {
                profile_id: None,
                app_id,
                app_name,
                app_path: None,
                action: rule_action,
                domain_pattern: rule_domain,
                domain_match_type: None, // Will be inferred as "exact" if domain is set
                port: rule_port,
                protocol: rule_protocol,
                direction: None,
                lifetime: Some(rule_lifetime),
                priority: None,
            })
        })
        .await
        .map_err(|e| format!("Task error: {}", e))??;
    }

    sync_firewall_rules_to_ne(&state).await;
    Ok(())
}

#[tauri::command]
pub async fn get_system_whitelist() -> Result<Vec<String>, String> {
    Ok(firewall::whitelist::get_system_whitelist())
}

#[tauri::command]
pub async fn export_firewall_config(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let db = state.db.clone();
    let rules = tokio::task::spawn_blocking(move || db.get_firewall_rules_v2(None))
        .await
        .map_err(|e| format!("Task error: {}", e))??;
    serde_json::to_string_pretty(&rules).map_err(|e| format!("Serialize error: {}", e))
}

#[tauri::command]
pub async fn import_firewall_config(state: tauri::State<'_, AppState>, json: String) -> Result<usize, String> {
    let rules: Vec<firewall::types::NewRuleRequest> = serde_json::from_str(&json)
        .map_err(|e| format!("Invalid JSON: {}", e))?;
    let count = rules.len();
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || {
        for rule in &rules {
            db.create_firewall_rule_v2(rule)?;
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;
    sync_firewall_rules_to_ne(&state).await;
    Ok(count)
}

// ---- Helper ----

/// Helper: sync firewall config (mode + rules + kill switch) to NE via broadcast.
/// This pushes the full config to ALL connected NE clients immediately.
pub(crate) async fn sync_firewall_rules_to_ne(state: &AppState) {
    let db = state.db.clone();
    let config = tokio::task::spawn_blocking(move || {
        let profile_id = db.get_active_profile_id();
        let mode = db.get_preference("firewall_mode")
            .ok().flatten().unwrap_or_else(|| "ask".to_string());
        let kill_switch = db.get_preference("kill_switch_active")
            .ok().flatten().map(|v| v == "true").unwrap_or(false);
        let rules = db.get_all_rules_for_ne(&profile_id).unwrap_or_default();

        serde_json::json!({
            "type": "firewall_config",
            "mode": mode,
            "kill_switch": kill_switch,
            "active_profile_id": profile_id,
            "rules": rules
        })
    }).await;

    if let Ok(config) = config {
        if let Ok(ne_bc) = state.ne_broadcast.lock() {
            if let Some(ref broadcast) = *ne_bc {
                broadcast.send_firewall_config(config);
                log::info!("Firewall config broadcast to NE");
            } else {
                log::debug!("No NE broadcast handle — NE not connected yet");
            }
        }
    }
}
