use crate::db::Database;
use crate::firewall::types::PrivacyScore;
use rusqlite::params;

impl Database {
    /// Calculate privacy score for an app based on tracker vs clean connection ratio.
    /// A+ = 0%, A = <5%, B = <15%, C = <30%, D = <50%, F = ≥50%
    pub fn calculate_privacy_score(&self, app_id: &str) -> Result<Option<PrivacyScore>, String> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        // Get tracker stats from app_registry
        let result: Result<(u64, u64, u64, u64), _> = conn.query_row(
            "SELECT tracker_connection_count, clean_connection_count, total_bytes_in, total_bytes_out
             FROM app_registry WHERE app_id = ?1",
            params![app_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)? as u64,
                    row.get::<_, i64>(1)? as u64,
                    row.get::<_, i64>(2)? as u64,
                    row.get::<_, i64>(3)? as u64,
                ))
            },
        );

        let (tracker_count, clean_count, bytes_in, bytes_out) = match result {
            Ok(v) => v,
            Err(_) => return Ok(None),
        };

        let total = tracker_count + clean_count;
        if total == 0 {
            return Ok(None);
        }

        let tracker_ratio = tracker_count as f64 / total as f64;
        let score = if tracker_ratio == 0.0 {
            "A+"
        } else if tracker_ratio < 0.05 {
            "A"
        } else if tracker_ratio < 0.15 {
            "B"
        } else if tracker_ratio < 0.30 {
            "C"
        } else if tracker_ratio < 0.50 {
            "D"
        } else {
            "F"
        };

        // Cache the score
        conn.execute(
            "UPDATE app_registry SET privacy_score = ?2 WHERE app_id = ?1",
            params![app_id, score],
        )
        .ok();

        Ok(Some(PrivacyScore {
            app_id: app_id.to_string(),
            score: score.to_string(),
            tracker_domains: tracker_count,
            total_domains: total,
            tracker_bytes: 0, // TODO: track per-connection tracker bytes
            total_bytes: bytes_in + bytes_out,
            last_calculated_ms: now,
        }))
    }

    pub fn get_all_privacy_scores(&self) -> Result<Vec<PrivacyScore>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT app_id, privacy_score, tracker_connection_count, clean_connection_count,
                        total_bytes_in, total_bytes_out
                 FROM app_registry
                 WHERE privacy_score IS NOT NULL
                 ORDER BY app_name",
            )
            .map_err(|e| format!("Prepare failed: {}", e))?;

        let rows = stmt
            .query_map([], |row: &rusqlite::Row| {
                let tracker: u64 = row.get::<_, i64>(2)? as u64;
                let clean: u64 = row.get::<_, i64>(3)? as u64;
                let bytes_in: u64 = row.get::<_, i64>(4)? as u64;
                let bytes_out: u64 = row.get::<_, i64>(5)? as u64;
                Ok(PrivacyScore {
                    app_id: row.get(0)?,
                    score: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    tracker_domains: tracker,
                    total_domains: tracker + clean,
                    tracker_bytes: 0,
                    total_bytes: bytes_in + bytes_out,
                    last_calculated_ms: 0,
                })
            })
            .map_err(|e| format!("Query failed: {}", e))?;
        let scores: Vec<PrivacyScore> = rows.filter_map(|r| r.ok()).collect();

        Ok(scores)
    }
}
