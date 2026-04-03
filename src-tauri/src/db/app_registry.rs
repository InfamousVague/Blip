use super::types::AppConnectionInfo;
use super::Database;
use rusqlite::params;

impl Database {
    /// Upsert an app in the registry. Returns `true` if this is a newly discovered app.
    pub fn upsert_app_registry(
        &self,
        app_id: &str,
        app_name: &str,
        app_path: Option<&str>,
        is_apple: bool,
        is_tracker: bool,
    ) -> Result<bool, String> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let is_system = crate::firewall::whitelist::is_system_whitelisted(app_id);
        let signing_status = if is_apple { "apple" } else { "unknown" };

        // Check if this app already exists
        let exists = conn
            .query_row(
                "SELECT 1 FROM app_registry WHERE app_id = ?1",
                params![app_id],
                |_| Ok(true),
            )
            .unwrap_or(false);

        let tracker_inc = if is_tracker { 1i64 } else { 0 };
        let clean_inc = if is_tracker { 0i64 } else { 1 };

        conn.execute(
            "INSERT INTO app_registry (app_id, app_name, app_path, is_apple_signed, is_system_app,
                code_signing_status, first_seen_ms, last_seen_ms, total_connections,
                tracker_connection_count, clean_connection_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, 1, ?8, ?9)
             ON CONFLICT(app_id) DO UPDATE SET
                last_seen_ms = ?7,
                total_connections = total_connections + 1,
                tracker_connection_count = tracker_connection_count + ?8,
                clean_connection_count = clean_connection_count + ?9,
                app_name = CASE WHEN ?2 != 'unknown' THEN ?2 ELSE app_name END",
            params![app_id, app_name, app_path, is_apple, is_system, signing_status, now, tracker_inc, clean_inc],
        )
        .map_err(|e| format!("Upsert app registry failed: {}", e))?;
        Ok(!exists)
    }

    pub fn get_app_registry(&self) -> Result<Vec<crate::firewall::types::AppInfo>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT app_id, app_name, app_path, is_apple_signed, is_system_app,
                        code_signing_status, first_seen_ms, last_seen_ms, total_connections,
                        total_bytes_in, total_bytes_out, privacy_score,
                        tracker_connection_count, clean_connection_count
                 FROM app_registry ORDER BY last_seen_ms DESC",
            )
            .map_err(|e| format!("Prepare failed: {}", e))?;

        let apps = stmt
            .query_map([], |row| {
                Ok(crate::firewall::types::AppInfo {
                    app_id: row.get(0)?,
                    app_name: row.get(1)?,
                    app_path: row.get(2)?,
                    is_apple_signed: row.get::<_, i32>(3)? != 0,
                    is_system_app: row.get::<_, i32>(4)? != 0,
                    code_signing_status: row.get::<_, Option<String>>(5)?
                        .unwrap_or_else(|| "unknown".to_string()),
                    first_seen_ms: row.get(6)?,
                    last_seen_ms: row.get(7)?,
                    total_connections: row.get::<_, i64>(8)? as u64,
                    total_bytes_in: row.get::<_, i64>(9)? as u64,
                    total_bytes_out: row.get::<_, i64>(10)? as u64,
                    privacy_score: row.get(11)?,
                    tracker_connection_count: row.get::<_, i64>(12)? as u64,
                    clean_connection_count: row.get::<_, i64>(13)? as u64,
                })
            })
            .map_err(|e| format!("Query failed: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(apps)
    }

    // Legacy compat: keep old function signature working during transition
    pub fn upsert_app_connection(&self, app_id: &str, app_name: &str, app_path: Option<&str>, is_apple: bool) -> Result<bool, String> {
        self.upsert_app_registry(app_id, app_name, app_path, is_apple, false)
    }

    pub fn get_app_connections(&self) -> Result<Vec<AppConnectionInfo>, String> {
        // Map from new schema to old type for legacy callers
        let apps = self.get_app_registry()?;
        Ok(apps.iter().map(|a| AppConnectionInfo {
            app_id: a.app_id.clone(),
            app_name: a.app_name.clone(),
            app_path: a.app_path.clone(),
            first_seen_ms: a.first_seen_ms,
            last_seen_ms: a.last_seen_ms,
            total_connections: a.total_connections,
            is_apple_signed: a.is_apple_signed,
        }).collect())
    }
}
