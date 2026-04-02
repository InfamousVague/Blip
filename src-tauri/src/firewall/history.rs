use crate::db::Database;
use crate::firewall::types::{BlockHistoryEntry, BlockStatsHourly};
use rusqlite::params;

impl Database {
    /// Insert a block event into block_history. Auto-trim keeps newest 100.
    pub fn insert_block_history(
        &self,
        app_id: Option<&str>,
        domain: Option<&str>,
        dest_ip: Option<&str>,
        dest_port: Option<u16>,
        protocol: Option<&str>,
        direction: Option<&str>,
        rule_id: Option<&str>,
        reason: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        conn.execute(
            "INSERT INTO block_history (app_id, domain, dest_ip, dest_port, protocol, direction, rule_id, reason, timestamp_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![app_id, domain, dest_ip, dest_port.map(|p| p as i32), protocol, direction, rule_id, reason, now],
        )
        .map_err(|e| format!("Insert block history failed: {}", e))?;

        // Trim to newest 100
        conn.execute(
            "DELETE FROM block_history WHERE id NOT IN (SELECT id FROM block_history ORDER BY timestamp_ms DESC LIMIT 100)",
            [],
        )
        .ok(); // Ignore trim errors

        // Update hourly aggregation
        let hour_bucket = now / 3_600_000 * 3_600_000; // Round down to hour
        conn.execute(
            "INSERT INTO block_stats_hourly (hour_bucket, app_id, domain, block_count, bytes_blocked)
             VALUES (?1, ?2, ?3, 1, 0)
             ON CONFLICT(hour_bucket, app_id, domain) DO UPDATE SET
                block_count = block_count + 1",
            params![hour_bucket as i64, app_id.unwrap_or("unknown"), domain.unwrap_or("unknown")],
        )
        .ok(); // Ignore aggregation errors

        Ok(())
    }

    pub fn get_block_history(&self, limit: usize) -> Result<Vec<BlockHistoryEntry>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, app_id, domain, dest_ip, dest_port, protocol, direction, rule_id, reason, timestamp_ms
                 FROM block_history ORDER BY timestamp_ms DESC LIMIT ?1",
            )
            .map_err(|e| format!("Prepare failed: {}", e))?;

        let entries = stmt
            .query_map(params![limit as i64], |row| {
                Ok(BlockHistoryEntry {
                    id: row.get(0)?,
                    app_id: row.get(1)?,
                    domain: row.get(2)?,
                    dest_ip: row.get(3)?,
                    dest_port: row.get::<_, Option<i32>>(4)?.map(|p| p as u16),
                    protocol: row.get(5)?,
                    direction: row.get(6)?,
                    rule_id: row.get(7)?,
                    reason: row.get(8)?,
                    timestamp_ms: row.get(9)?,
                })
            })
            .map_err(|e| format!("Query failed: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(entries)
    }

    pub fn get_block_stats_hourly(&self, hours_back: u32) -> Result<Vec<BlockStatsHourly>, String> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        let cutoff = now - (hours_back as u64 * 3_600_000);

        let mut stmt = conn
            .prepare(
                "SELECT hour_bucket, app_id, domain, block_count, bytes_blocked
                 FROM block_stats_hourly
                 WHERE hour_bucket >= ?1
                 ORDER BY hour_bucket",
            )
            .map_err(|e| format!("Prepare failed: {}", e))?;

        let stats = stmt
            .query_map(params![cutoff as i64], |row| {
                Ok(BlockStatsHourly {
                    hour_bucket: row.get::<_, i64>(0)? as u64,
                    app_id: row.get(1)?,
                    domain: row.get(2)?,
                    block_count: row.get::<_, i64>(3)? as u64,
                    bytes_blocked: row.get::<_, i64>(4)? as u64,
                })
            })
            .map_err(|e| format!("Query failed: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(stats)
    }
}
