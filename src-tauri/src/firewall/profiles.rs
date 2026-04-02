use crate::db::Database;
use crate::firewall::types::NetworkProfile;
use rusqlite::params;

impl Database {
    pub fn get_network_profiles(&self) -> Result<Vec<NetworkProfile>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, name, description, is_active, auto_switch_ssid, auto_switch_vpn, created_at
                 FROM network_profiles ORDER BY created_at",
            )
            .map_err(|e| format!("Prepare failed: {}", e))?;

        let profiles = stmt
            .query_map([], |row| {
                Ok(NetworkProfile {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    is_active: row.get::<_, i32>(3)? != 0,
                    auto_switch_ssid: row.get(4)?,
                    auto_switch_vpn: row.get::<_, i32>(5)? != 0,
                    created_at: row.get(6)?,
                })
            })
            .map_err(|e| format!("Query failed: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(profiles)
    }

    pub fn create_network_profile(
        &self,
        name: &str,
        description: Option<&str>,
        auto_switch_ssid: Option<&str>,
        auto_switch_vpn: bool,
    ) -> Result<NetworkProfile, String> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        let id = uuid::Uuid::new_v4().to_string();

        conn.execute(
            "INSERT INTO network_profiles (id, name, description, is_active, auto_switch_ssid, auto_switch_vpn, created_at)
             VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6)",
            params![id, name, description, auto_switch_ssid, auto_switch_vpn as i32, now],
        )
        .map_err(|e| format!("Create profile failed: {}", e))?;

        Ok(NetworkProfile {
            id,
            name: name.to_string(),
            description: description.map(String::from),
            is_active: false,
            auto_switch_ssid: auto_switch_ssid.map(String::from),
            auto_switch_vpn,
            created_at: now,
        })
    }

    pub fn delete_network_profile(&self, id: &str) -> Result<(), String> {
        if id == "default" {
            return Err("Cannot delete the default profile".to_string());
        }
        let conn = self.conn.lock().unwrap();
        // Delete associated rules first
        conn.execute(
            "DELETE FROM firewall_rules WHERE profile_id = ?1",
            params![id],
        )
        .map_err(|e| format!("Delete profile rules failed: {}", e))?;
        conn.execute("DELETE FROM network_profiles WHERE id = ?1", params![id])
            .map_err(|e| format!("Delete profile failed: {}", e))?;
        Ok(())
    }

    pub fn switch_network_profile(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE network_profiles SET is_active = 0", [])
            .map_err(|e| format!("Deactivate profiles failed: {}", e))?;
        conn.execute(
            "UPDATE network_profiles SET is_active = 1 WHERE id = ?1",
            params![id],
        )
        .map_err(|e| format!("Activate profile failed: {}", e))?;
        Ok(())
    }

    pub fn get_active_profile_id(&self) -> String {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id FROM network_profiles WHERE is_active = 1 LIMIT 1",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "default".to_string())
    }

    /// Find a profile whose auto_switch_ssid matches the given SSID.
    pub fn find_profile_for_ssid(&self, ssid: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id FROM network_profiles WHERE auto_switch_ssid = ?1",
            params![ssid],
            |row| row.get(0),
        )
        .ok()
    }
}
