use crate::db::Database;
use crate::firewall::types::{FirewallRule, NewRuleRequest, RuleConflict};
use rusqlite::params;

impl Database {
    pub fn get_firewall_rules_v2(&self, profile_id: Option<&str>) -> Result<Vec<FirewallRule>, String> {
        let conn = self.conn.lock().unwrap();
        let pid = profile_id.unwrap_or("default");
        let mut stmt = conn
            .prepare(
                "SELECT id, profile_id, app_id, app_name, app_path, action,
                        domain_pattern, domain_match_type, port, protocol, direction,
                        lifetime, hit_count, bytes_allowed, bytes_blocked, last_triggered_ms,
                        enabled, priority, created_at, updated_at
                 FROM firewall_rules
                 WHERE profile_id = ?1
                 ORDER BY app_name, priority",
            )
            .map_err(|e| format!("Prepare failed: {}", e))?;

        let rules = stmt
            .query_map(params![pid], |row| {
                Ok(FirewallRule {
                    id: row.get(0)?,
                    profile_id: row.get(1)?,
                    app_id: row.get(2)?,
                    app_name: row.get(3)?,
                    app_path: row.get(4)?,
                    action: row.get(5)?,
                    domain_pattern: row.get(6)?,
                    domain_match_type: row.get(7)?,
                    port: row.get(8)?,
                    protocol: row.get(9)?,
                    direction: row.get::<_, Option<String>>(10)?
                        .unwrap_or_else(|| "any".to_string()),
                    lifetime: row.get::<_, Option<String>>(11)?
                        .unwrap_or_else(|| "forever".to_string()),
                    hit_count: row.get::<_, i64>(12)? as u64,
                    bytes_allowed: row.get::<_, i64>(13)? as u64,
                    bytes_blocked: row.get::<_, i64>(14)? as u64,
                    last_triggered_ms: row.get(15)?,
                    enabled: row.get::<_, i32>(16)? != 0,
                    priority: row.get(17)?,
                    created_at: row.get(18)?,
                    updated_at: row.get(19)?,
                })
            })
            .map_err(|e| format!("Query failed: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(rules)
    }

    pub fn create_firewall_rule_v2(&self, req: &NewRuleRequest) -> Result<FirewallRule, String> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let id = uuid::Uuid::new_v4().to_string();
        let profile_id = req.profile_id.as_deref().unwrap_or("default");
        let direction = req.direction.as_deref().unwrap_or("any");
        let lifetime = req.lifetime.as_deref().unwrap_or("forever");
        let priority = req.priority.unwrap_or(100);

        conn.execute(
            "INSERT INTO firewall_rules (id, profile_id, app_id, app_name, app_path, action,
                domain_pattern, domain_match_type, port, protocol, direction,
                lifetime, hit_count, bytes_allowed, bytes_blocked, enabled, priority,
                created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0, 0, 0, 1, ?13, ?14, ?14)",
            params![
                id, profile_id, req.app_id, req.app_name, req.app_path, req.action,
                req.domain_pattern, req.domain_match_type, req.port, req.protocol,
                direction, lifetime, priority, now
            ],
        )
        .map_err(|e| format!("Create firewall rule failed: {}", e))?;

        Ok(FirewallRule {
            id,
            profile_id: profile_id.to_string(),
            app_id: req.app_id.clone(),
            app_name: req.app_name.clone(),
            app_path: req.app_path.clone(),
            action: req.action.clone(),
            domain_pattern: req.domain_pattern.clone(),
            domain_match_type: req.domain_match_type.clone(),
            port: req.port.clone(),
            protocol: req.protocol.clone(),
            direction: direction.to_string(),
            lifetime: lifetime.to_string(),
            hit_count: 0,
            bytes_allowed: 0,
            bytes_blocked: 0,
            last_triggered_ms: None,
            enabled: true,
            priority,
            created_at: now,
            updated_at: now,
        })
    }

    pub fn update_firewall_rule_v2(
        &self,
        id: &str,
        action: Option<&str>,
        domain_pattern: Option<&str>,
        domain_match_type: Option<&str>,
        port: Option<&str>,
        protocol: Option<&str>,
        direction: Option<&str>,
        lifetime: Option<&str>,
        enabled: Option<bool>,
        priority: Option<i32>,
    ) -> Result<FirewallRule, String> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        // Build dynamic UPDATE
        let mut sets = vec!["updated_at = ?1".to_string()];
        let mut param_idx = 2u32;
        let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now as i64)];

        macro_rules! maybe_set {
            ($field:expr, $val:expr) => {
                if let Some(v) = $val {
                    sets.push(format!("{} = ?{}", $field, param_idx));
                    values.push(Box::new(v.to_string()));
                    param_idx += 1;
                }
            };
        }

        maybe_set!("action", action);
        maybe_set!("domain_pattern", domain_pattern);
        maybe_set!("domain_match_type", domain_match_type);
        maybe_set!("port", port);
        maybe_set!("protocol", protocol);
        maybe_set!("direction", direction);
        maybe_set!("lifetime", lifetime);

        if let Some(e) = enabled {
            sets.push(format!("enabled = ?{}", param_idx));
            values.push(Box::new(e as i32));
            param_idx += 1;
        }
        if let Some(p) = priority {
            sets.push(format!("priority = ?{}", param_idx));
            values.push(Box::new(p));
            param_idx += 1;
        }

        // WHERE id = ?N
        values.push(Box::new(id.to_string()));
        let sql = format!(
            "UPDATE firewall_rules SET {} WHERE id = ?{}",
            sets.join(", "),
            param_idx
        );

        let params_refs: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();
        conn.execute(&sql, params_refs.as_slice())
            .map_err(|e| format!("Update firewall rule failed: {}", e))?;

        // Return the updated rule
        drop(conn);
        self.get_firewall_rule_by_id(id)
    }

    pub fn get_firewall_rule_by_id(&self, id: &str) -> Result<FirewallRule, String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, profile_id, app_id, app_name, app_path, action,
                    domain_pattern, domain_match_type, port, protocol, direction,
                    lifetime, hit_count, bytes_allowed, bytes_blocked, last_triggered_ms,
                    enabled, priority, created_at, updated_at
             FROM firewall_rules WHERE id = ?1",
            params![id],
            |row| {
                Ok(FirewallRule {
                    id: row.get(0)?,
                    profile_id: row.get(1)?,
                    app_id: row.get(2)?,
                    app_name: row.get(3)?,
                    app_path: row.get(4)?,
                    action: row.get(5)?,
                    domain_pattern: row.get(6)?,
                    domain_match_type: row.get(7)?,
                    port: row.get(8)?,
                    protocol: row.get(9)?,
                    direction: row.get::<_, Option<String>>(10)?
                        .unwrap_or_else(|| "any".to_string()),
                    lifetime: row.get::<_, Option<String>>(11)?
                        .unwrap_or_else(|| "forever".to_string()),
                    hit_count: row.get::<_, i64>(12)? as u64,
                    bytes_allowed: row.get::<_, i64>(13)? as u64,
                    bytes_blocked: row.get::<_, i64>(14)? as u64,
                    last_triggered_ms: row.get(15)?,
                    enabled: row.get::<_, i32>(16)? != 0,
                    priority: row.get(17)?,
                    created_at: row.get(18)?,
                    updated_at: row.get(19)?,
                })
            },
        )
        .map_err(|e| format!("Rule not found: {}", e))
    }

    pub fn delete_firewall_rule_v2(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM firewall_rules WHERE id = ?1", params![id])
            .map_err(|e| format!("Delete firewall rule failed: {}", e))?;
        Ok(())
    }

    pub fn delete_firewall_rules_for_app(&self, app_id: &str, profile_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM firewall_rules WHERE app_id = ?1 AND profile_id = ?2",
            params![app_id, profile_id],
        )
        .map_err(|e| format!("Delete rules for app failed: {}", e))?;
        Ok(())
    }

    /// Check for conflicting rules before creating a new one.
    pub fn check_rule_conflicts(&self, req: &NewRuleRequest) -> Result<Vec<RuleConflict>, String> {
        let profile_id = req.profile_id.as_deref().unwrap_or("default");
        let existing = self.get_firewall_rules_v2(Some(profile_id))?;

        let mut conflicts = Vec::new();

        for rule in &existing {
            if rule.app_id != req.app_id {
                continue;
            }

            // Check domain overlap
            let domain_overlaps = match (&rule.domain_pattern, &req.domain_pattern) {
                (None, None) => true,                    // both blanket
                (None, Some(_)) | (Some(_), None) => true, // blanket overlaps with specific
                (Some(a), Some(b)) => domains_overlap(a, b),
            };

            if !domain_overlaps {
                continue;
            }

            // Check port overlap
            let port_overlaps = match (&rule.port, &req.port) {
                (None, None) => true,
                (None, Some(_)) | (Some(_), None) => true,
                (Some(a), Some(b)) => ports_overlap(a, b),
            };

            if !port_overlaps {
                continue;
            }

            // Check protocol overlap
            let proto_overlaps = match (&rule.protocol, &req.protocol) {
                (None, None) | (None, Some(_)) | (Some(_), None) => true,
                (Some(a), Some(b)) => a == "any" || b == "any" || a == b,
            };

            if !proto_overlaps {
                continue;
            }

            // Overlapping scope with different action = conflict
            if rule.action != req.action {
                let desc = format!(
                    "Existing rule '{}' ({}) conflicts on {}",
                    rule.domain_pattern.as_deref().unwrap_or("all domains"),
                    rule.action,
                    if domain_overlaps && port_overlaps { "domain and port" }
                    else if domain_overlaps { "domain" }
                    else { "port" }
                );
                conflicts.push(RuleConflict {
                    existing_rule: rule.clone(),
                    overlap_description: desc,
                });
            }
        }

        Ok(conflicts)
    }

    /// Increment hit count and bytes for a rule (called from NE stats batch).
    pub fn update_rule_stats(
        &self,
        rule_id: &str,
        hits_delta: u64,
        bytes_allowed_delta: u64,
        bytes_blocked_delta: u64,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        conn.execute(
            "UPDATE firewall_rules SET
                hit_count = hit_count + ?2,
                bytes_allowed = bytes_allowed + ?3,
                bytes_blocked = bytes_blocked + ?4,
                last_triggered_ms = ?5
             WHERE id = ?1",
            params![rule_id, hits_delta as i64, bytes_allowed_delta as i64, bytes_blocked_delta as i64, now],
        )
        .map_err(|e| format!("Update rule stats failed: {}", e))?;
        Ok(())
    }

    /// Cleanup "session" lifetime rules (called on app startup).
    pub fn cleanup_session_rules_v2(&self) -> Result<usize, String> {
        let conn = self.conn.lock().unwrap();
        let count = conn
            .execute("DELETE FROM firewall_rules WHERE lifetime = 'session'", [])
            .map_err(|e| format!("Cleanup session rules failed: {}", e))?;
        Ok(count)
    }

    /// Cleanup "once" rules by ID (called after NE reports a match).
    pub fn cleanup_once_rule(&self, rule_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM firewall_rules WHERE id = ?1 AND lifetime = 'once'",
            params![rule_id],
        )
        .map_err(|e| format!("Cleanup once rule failed: {}", e))?;
        Ok(())
    }
}

/// Check if two domain patterns overlap.
fn domains_overlap(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    // Wildcard *.example.com overlaps with exact foo.example.com
    if a.starts_with("*.") {
        let suffix = &a[1..]; // ".example.com"
        if b.ends_with(suffix) || b == &a[2..] {
            return true;
        }
    }
    if b.starts_with("*.") {
        let suffix = &b[1..];
        if a.ends_with(suffix) || a == &b[2..] {
            return true;
        }
    }
    // Regex patterns — conservatively flag as overlapping
    if a.starts_with("regex:") || b.starts_with("regex:") {
        return true;
    }
    false
}

/// Check if two port specifications overlap.
fn ports_overlap(a: &str, b: &str) -> bool {
    let set_a = parse_port_set(a);
    let set_b = parse_port_set(b);
    set_a.iter().any(|p| set_b.contains(p))
}

fn parse_port_set(spec: &str) -> Vec<u16> {
    let mut ports = Vec::new();
    for part in spec.split(',') {
        let part = part.trim();
        if let Some((start, end)) = part.split_once('-') {
            if let (Ok(s), Ok(e)) = (start.trim().parse::<u16>(), end.trim().parse::<u16>()) {
                for p in s..=e {
                    ports.push(p);
                    if ports.len() > 1000 {
                        return ports; // safety cap
                    }
                }
            }
        } else if let Ok(p) = part.parse::<u16>() {
            ports.push(p);
        }
    }
    ports
}
