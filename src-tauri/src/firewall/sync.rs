use crate::db::Database;
use crate::firewall::types::FirewallRule;

impl Database {
    /// Serialize rules for sending to the NE filter provider.
    /// Returns JSON-ready structures for the firewall_config message.
    pub fn get_rules_for_ne(&self, profile_id: &str) -> Result<Vec<serde_json::Value>, String> {
        let rules = self.get_firewall_rules_v2(Some(profile_id))?;

        let ne_rules: Vec<serde_json::Value> = rules
            .iter()
            .filter(|r| r.enabled && r.action != "ask") // "ask" rules are handled by approval flow
            .map(|r| rule_to_ne_json(r))
            .collect();

        Ok(ne_rules)
    }

    /// Get all rules for NE including "ask" rules (NE needs to know to send approval requests).
    pub fn get_all_rules_for_ne(&self, profile_id: &str) -> Result<Vec<serde_json::Value>, String> {
        let rules = self.get_firewall_rules_v2(Some(profile_id))?;

        let ne_rules: Vec<serde_json::Value> = rules
            .iter()
            .filter(|r| r.enabled)
            .map(|r| rule_to_ne_json(r))
            .collect();

        Ok(ne_rules)
    }
}

fn rule_to_ne_json(r: &FirewallRule) -> serde_json::Value {
    let mut entry = serde_json::json!({
        "id": r.id,
        "app_id": r.app_id,
        "action": r.action,
        "direction": r.direction,
        "lifetime": r.lifetime,
        "priority": r.priority,
    });

    if let Some(ref dp) = r.domain_pattern {
        entry["domain_pattern"] = serde_json::json!(dp);
    }
    if let Some(ref dmt) = r.domain_match_type {
        entry["domain_match_type"] = serde_json::json!(dmt);
    }
    if let Some(ref port) = r.port {
        entry["port"] = serde_json::json!(port);
    }
    if let Some(ref proto) = r.protocol {
        entry["protocol"] = serde_json::json!(proto);
    }

    entry
}
