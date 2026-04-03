use super::types::{HistoricalEndpoint, HistoricalStats, TrackerDomainStat, TrackerStats};
use super::Database;
use rusqlite::params;

impl Database {
    pub fn update_tracker_summary(
        &self,
        domain: &str,
        category: Option<&str>,
        bytes_in: u64,
        bytes_out: u64,
        timestamp_ms: u64,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO tracker_summary (domain, category, total_hits, total_bytes_in, total_bytes_out, first_seen_ms, last_seen_ms)
             VALUES (?1, ?2, 1, ?3, ?4, ?5, ?5)
             ON CONFLICT(domain) DO UPDATE SET
                total_hits = total_hits + 1,
                total_bytes_in = total_bytes_in + ?3,
                total_bytes_out = total_bytes_out + ?4,
                last_seen_ms = ?5",
            params![domain, category, bytes_in, bytes_out, timestamp_ms],
        )
        .map_err(|e| format!("Tracker summary update failed: {}", e))?;
        Ok(())
    }

    pub fn get_tracker_stats(&self) -> Result<TrackerStats, String> {
        let conn = self.conn.lock().unwrap();

        let (total_hits, total_bytes): (u64, u64) = conn
            .query_row(
                "SELECT COALESCE(SUM(total_hits), 0), COALESCE(SUM(total_bytes_in + total_bytes_out), 0)
                 FROM tracker_summary",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap_or((0, 0));

        let mut stmt = conn
            .prepare(
                "SELECT domain, category, total_hits, total_bytes_in + total_bytes_out, last_seen_ms
                 FROM tracker_summary
                 ORDER BY total_hits DESC
                 LIMIT 500",
            )
            .map_err(|e| format!("Prepare failed: {}", e))?;

        let top_domains: Vec<TrackerDomainStat> = stmt
            .query_map([], |row| {
                Ok(TrackerDomainStat {
                    domain: row.get(0)?,
                    category: row.get(1)?,
                    total_hits: row.get(2)?,
                    total_bytes: row.get(3)?,
                    last_seen_ms: row.get(4)?,
                })
            })
            .map_err(|e| format!("Query failed: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(TrackerStats {
            total_tracker_hits: total_hits,
            total_bytes_blocked: total_bytes,
            top_domains,
        })
    }

    pub fn get_historical_endpoints(&self) -> Result<Vec<HistoricalEndpoint>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT ROUND(dest_lat, 2) as lat, ROUND(dest_lon, 2) as lon, COUNT(*) as cnt
                 FROM connections
                 WHERE dest_lat != 0 OR dest_lon != 0
                 GROUP BY ROUND(dest_lat, 2), ROUND(dest_lon, 2)",
            )
            .map_err(|e| format!("Prepare failed: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(HistoricalEndpoint {
                    dest_lat: row.get(0)?,
                    dest_lon: row.get(1)?,
                    connection_count: row.get(2)?,
                })
            })
            .map_err(|e| format!("Query failed: {}", e))?;

        let mut endpoints = Vec::new();
        for row in rows {
            endpoints.push(row.map_err(|e| format!("Row error: {}", e))?);
        }
        Ok(endpoints)
    }

    pub fn get_historical_stats(&self) -> Result<HistoricalStats, String> {
        let conn = self.conn.lock().unwrap();
        let stats = conn
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(bytes_received), 0), COALESCE(SUM(bytes_sent), 0),
                        MIN(first_seen_ms), MAX(last_seen_ms)
                 FROM connections",
                [],
                |row| {
                    Ok(HistoricalStats {
                        total_connections: row.get(0)?,
                        total_bytes_in: row.get(1)?,
                        total_bytes_out: row.get(2)?,
                        first_seen_ms: row.get(3)?,
                        last_seen_ms: row.get(4)?,
                    })
                },
            )
            .map_err(|e| format!("Stats query failed: {}", e))?;
        Ok(stats)
    }
}
