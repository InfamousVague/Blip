use super::Database;
use rusqlite::params;

impl Database {
    pub fn insert_dns_queries(
        &self,
        queries: &[(String, String, Vec<String>, u64, bool)],
    ) -> Result<usize, String> {
        let conn = self.conn.lock().unwrap();
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| format!("Transaction failed: {}", e))?;

        let mut count = 0;
        {
            let mut stmt = tx
                .prepare_cached(
                    "INSERT INTO dns_queries (domain, query_type, response_ips, timestamp_ms, is_blocked)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                )
                .map_err(|e| format!("Prepare failed: {}", e))?;

            for (domain, query_type, response_ips, timestamp_ms, is_blocked) in queries {
                let ips_json = serde_json::to_string(response_ips).unwrap_or_default();
                stmt.execute(params![domain, query_type, ips_json, timestamp_ms, is_blocked])
                    .map_err(|e| format!("Insert DNS query failed: {}", e))?;
                count += 1;
            }
        }

        tx.commit()
            .map_err(|e| format!("Commit failed: {}", e))?;
        log::debug!("Flushed {} DNS queries to DB", count);
        Ok(count)
    }

    /// Get cumulative DNS stats for seeding on startup
    pub fn get_dns_stats_cumulative(&self) -> Result<(u64, u64), String> {
        let conn = self.conn.lock().unwrap();
        let (total, blocked): (u64, u64) = conn
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(CASE WHEN is_blocked THEN 1 ELSE 0 END), 0) FROM dns_queries",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap_or((0, 0));
        Ok((total, blocked))
    }

    /// Load most recent DNS queries for populating the in-memory log on startup
    pub fn get_recent_dns_queries(&self, limit: usize) -> Result<Vec<(String, String, Vec<String>, u64, bool)>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT domain, query_type, response_ips, timestamp_ms, is_blocked
                 FROM dns_queries ORDER BY timestamp_ms DESC LIMIT ?1",
            )
            .map_err(|e| format!("Prepare failed: {}", e))?;

        let rows: Vec<(String, String, Vec<String>, u64, bool)> = stmt
            .query_map(params![limit as i64], |row| {
                let domain: String = row.get(0)?;
                let qtype: String = row.get(1)?;
                let ips_json: Option<String> = row.get(2)?;
                let ts: u64 = row.get(3)?;
                let blocked: bool = row.get(4)?;
                let ips: Vec<String> = ips_json
                    .and_then(|j| serde_json::from_str(&j).ok())
                    .unwrap_or_default();
                Ok((domain, qtype, ips, ts, blocked))
            })
            .map_err(|e| format!("Query failed: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(rows)
    }

    /// Load recent IP->domain mappings from dns_queries for seeding DnsMapping
    pub fn get_recent_ip_domain_mappings(&self, limit: usize) -> Result<Vec<(String, Vec<String>)>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT domain, response_ips FROM dns_queries
                 WHERE response_ips IS NOT NULL AND response_ips != '[]'
                 ORDER BY timestamp_ms DESC LIMIT ?1",
            )
            .map_err(|e| format!("Prepare failed: {}", e))?;

        let rows: Vec<(String, Vec<String>)> = stmt
            .query_map(params![limit as i64], |row| {
                let domain: String = row.get(0)?;
                let ips_json: String = row.get(1)?;
                let ips: Vec<String> = serde_json::from_str(&ips_json).unwrap_or_default();
                Ok((domain, ips))
            })
            .map_err(|e| format!("Query failed: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(rows)
    }
}
