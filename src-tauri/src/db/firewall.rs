use super::types::FirewallRule;
use super::Database;
use rusqlite::params;

impl Database {
    pub fn get_firewall_rules(&self) -> Result<Vec<FirewallRule>, String> {
        // Map from new v8 schema to legacy FirewallRule type for backwards compatibility
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, app_id, app_name, app_path, action, domain_pattern, port, protocol, lifetime, created_at, updated_at
                 FROM firewall_rules ORDER BY app_name"
            )
            .map_err(|e| format!("Prepare failed: {}", e))?;

        let rules = stmt
            .query_map([], |row| {
                Ok(FirewallRule {
                    id: row.get(0)?,
                    app_id: row.get(1)?,
                    app_name: row.get(2)?,
                    app_path: row.get(3)?,
                    action: row.get(4)?,
                    domain: row.get(5)?,       // domain_pattern -> domain
                    port: row.get::<_, Option<String>>(6)?
                        .and_then(|s| s.parse::<u16>().ok()), // string port -> u16
                    protocol: row.get(7)?,
                    expires_at: None,          // No longer used
                    lifetime: row.get::<_, Option<String>>(8)?.unwrap_or_else(|| "forever".to_string()),
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            })
            .map_err(|e| format!("Query failed: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(rules)
    }

    pub fn set_firewall_rule(
        &self,
        app_id: &str,
        app_name: &str,
        app_path: Option<&str>,
        action: &str,
        domain: Option<&str>,
        port: Option<u16>,
        protocol: Option<&str>,
        lifetime: &str,
        _expires_at: Option<u64>,
    ) -> Result<FirewallRule, String> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let port_str = port.map(|p| p.to_string());

        // Match on (app_id, domain_pattern, port, protocol) for upserts
        let existing_id: Option<String> = conn
            .query_row(
                "SELECT id FROM firewall_rules WHERE app_id = ?1 AND domain_pattern IS ?2 AND port IS ?3 AND protocol IS ?4",
                params![app_id, domain, port_str, protocol],
                |row| row.get(0),
            )
            .ok();

        let id = existing_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let lt = if lifetime == "permanent" || lifetime == "timed" { "forever" } else { lifetime };

        conn.execute(
            "INSERT OR REPLACE INTO firewall_rules (id, profile_id, app_id, app_name, app_path, action,
                domain_pattern, port, protocol, direction, lifetime, hit_count, bytes_allowed, bytes_blocked,
                enabled, priority, created_at, updated_at)
             VALUES (?1, 'default', ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'any', ?9, 0, 0, 0, 1, 100,
                COALESCE((SELECT created_at FROM firewall_rules WHERE id = ?1), ?10), ?10)",
            params![id, app_id, app_name, app_path, action, domain, port_str, protocol, lt, now],
        )
        .map_err(|e| format!("Set firewall rule failed: {}", e))?;

        Ok(FirewallRule {
            id,
            app_id: app_id.to_string(),
            app_name: app_name.to_string(),
            app_path: app_path.map(String::from),
            action: action.to_string(),
            domain: domain.map(String::from),
            port,
            protocol: protocol.map(String::from),
            expires_at: None,
            lifetime: lt.to_string(),
            created_at: now,
            updated_at: now,
        })
    }

    pub fn delete_firewall_rule_by_id(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM firewall_rules WHERE id = ?1", params![id])
            .map_err(|e| format!("Delete firewall rule by id failed: {}", e))?;
        Ok(())
    }

    pub fn cleanup_expired_rules(&self) -> Result<usize, String> {
        // No longer have expires_at in v8 schema -- session rules cleaned on startup instead
        Ok(0)
    }

    pub fn cleanup_session_rules(&self) -> Result<usize, String> {
        let conn = self.conn.lock().unwrap();
        let count = conn.execute(
            "DELETE FROM firewall_rules WHERE lifetime = 'session'",
            [],
        )
        .map_err(|e| format!("Cleanup session rules failed: {}", e))?;
        Ok(count)
    }

    pub fn delete_firewall_rule(&self, app_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM firewall_rules WHERE app_id = ?1", params![app_id])
            .map_err(|e| format!("Delete firewall rule failed: {}", e))?;
        Ok(())
    }
}
