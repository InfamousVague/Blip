use super::Database;
use rusqlite::params;

impl Database {
    pub fn get_database_stats(&self) -> (u64, u64, u64, u64) {
        let conn = self.conn.lock().unwrap();
        let connections: u64 = conn.query_row("SELECT COUNT(*) FROM connections", [], |r| r.get(0)).unwrap_or(0);
        let dns_queries: u64 = conn.query_row("SELECT COUNT(*) FROM dns_queries", [], |r| r.get(0)).unwrap_or(0);
        let traced_routes: u64 = conn.query_row("SELECT COUNT(*) FROM traced_routes", [], |r| r.get(0)).unwrap_or(0);
        // Try new table first, fall back to old
        let firewall_rules: u64 = conn.query_row("SELECT COUNT(*) FROM firewall_rules", [], |r| r.get(0)).unwrap_or(0);
        (connections, dns_queries, traced_routes, firewall_rules)
    }

    pub fn get_database_path(&self) -> String {
        let conn = self.conn.lock().unwrap();
        conn.path().unwrap_or("").to_string()
    }

    /// Delete connections and DNS queries older than `days` days.
    pub fn cleanup_old_data(&self, days: u32) -> (u64, u64) {
        let conn = self.conn.lock().unwrap();
        let cutoff_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64
            - (days as i64 * 24 * 60 * 60 * 1000);
        let conns_deleted: u64 = conn.execute(
            "DELETE FROM connections WHERE last_seen_ms < ?1",
            rusqlite::params![cutoff_ms],
        ).map(|c| c as u64).unwrap_or(0);
        let dns_deleted: u64 = conn.execute(
            "DELETE FROM dns_queries WHERE timestamp_ms < ?1",
            rusqlite::params![cutoff_ms],
        ).map(|c| c as u64).unwrap_or(0);
        (conns_deleted, dns_deleted)
    }

    pub fn set_session_stat(&self, key: &str, value: i64) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO session_stats (key, value_int) VALUES (?1, ?2)",
            params![key, value],
        )
        .map_err(|e| format!("Set session stat failed: {}", e))?;
        Ok(())
    }

    pub fn get_session_stat(&self, key: &str) -> Result<Option<i64>, String> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT value_int FROM session_stats WHERE key = ?1",
            params![key],
            |row| row.get(0),
        );
        match result {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("Get session stat failed: {}", e)),
        }
    }
}
