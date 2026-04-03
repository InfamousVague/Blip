use super::Database;
use crate::blocklist::BlocklistInfo;
use rusqlite::params;
use std::collections::HashSet;

impl Database {
    pub fn save_blocklist(
        &self,
        info: &BlocklistInfo,
        domains: &HashSet<String>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| format!("Transaction failed: {}", e))?;

        tx.execute(
            "INSERT OR REPLACE INTO blocklists (id, name, source_url, domain_count, enabled)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![info.id, info.name, info.source_url, info.domain_count, info.enabled],
        )
        .map_err(|e| format!("Insert blocklist failed: {}", e))?;

        // Delete old domains for this list
        tx.execute(
            "DELETE FROM blocklist_domains WHERE blocklist_id = ?1",
            params![info.id],
        )
        .map_err(|e| format!("Delete domains failed: {}", e))?;

        // Insert new domains
        {
            let mut stmt = tx
                .prepare_cached(
                    "INSERT OR IGNORE INTO blocklist_domains (blocklist_id, domain) VALUES (?1, ?2)",
                )
                .map_err(|e| format!("Prepare failed: {}", e))?;

            for domain in domains {
                stmt.execute(params![info.id, domain])
                    .map_err(|e| format!("Insert domain failed: {}", e))?;
            }
        }

        tx.commit()
            .map_err(|e| format!("Commit failed: {}", e))?;
        log::info!(
            "Saved blocklist '{}' with {} domains",
            info.name,
            domains.len()
        );
        Ok(())
    }

    pub fn remove_blocklist(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM blocklists WHERE id = ?1", params![id])
            .map_err(|e| format!("Remove blocklist failed: {}", e))?;
        // CASCADE deletes domains
        Ok(())
    }

    pub fn toggle_blocklist(&self, id: &str, enabled: bool) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE blocklists SET enabled = ?2 WHERE id = ?1",
            params![id, enabled],
        )
        .map_err(|e| format!("Toggle blocklist failed: {}", e))?;
        Ok(())
    }

    pub fn load_blocklists(&self) -> Result<Vec<(BlocklistInfo, HashSet<String>)>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, name, source_url, domain_count, enabled FROM blocklists")
            .map_err(|e| format!("Prepare failed: {}", e))?;

        let lists: Vec<BlocklistInfo> = stmt
            .query_map([], |row| {
                Ok(BlocklistInfo {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    source_url: row.get(2)?,
                    domain_count: row.get(3)?,
                    enabled: row.get(4)?,
                })
            })
            .map_err(|e| format!("Query failed: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        let mut result = Vec::new();
        for info in lists {
            let mut domain_stmt = conn
                .prepare("SELECT domain FROM blocklist_domains WHERE blocklist_id = ?1")
                .map_err(|e| format!("Prepare domains failed: {}", e))?;

            let domains: HashSet<String> = domain_stmt
                .query_map(params![info.id], |row| row.get(0))
                .map_err(|e| format!("Query domains failed: {}", e))?
                .filter_map(|r| r.ok())
                .collect();

            result.push((info, domains));
        }

        log::info!("Loaded {} blocklists from database", result.len());
        Ok(result)
    }
}
