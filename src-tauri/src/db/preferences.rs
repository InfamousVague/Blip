use super::Database;
use rusqlite::params;

impl Database {
    pub fn get_preference(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT value FROM preferences WHERE key = ?1",
            params![key],
            |row| row.get(0),
        );
        match result {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("Preference query failed: {}", e)),
        }
    }

    pub fn set_preference(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO preferences (key, value) VALUES (?1, ?2)",
            params![key, value],
        )
        .map_err(|e| format!("Preference set failed: {}", e))?;
        Ok(())
    }

    pub fn delete_preference(&self, key: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM preferences WHERE key = ?1", params![key])
            .map_err(|e| format!("Preference delete failed: {}", e))?;
        Ok(())
    }

    pub fn reset_preferences(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM preferences", [])
            .map_err(|e| format!("Reset preferences failed: {}", e))?;
        Ok(())
    }

    pub fn clear_history(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "DELETE FROM connections;
             DELETE FROM dns_queries;
             DELETE FROM tracker_summary;
             DELETE FROM session_stats;"
        ).map_err(|e| format!("Clear history failed: {}", e))?;
        Ok(())
    }
}
