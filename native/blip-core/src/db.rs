use crate::blocklist::BlocklistInfo;
use crate::capture::types::{Protocol, ResolvedConnection};
use rusqlite::{params, Connection};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;

#[allow(dead_code)]
const CURRENT_SCHEMA_VERSION: i32 = 2;

// ---- Return types for queries ----

#[derive(Debug, Clone, serde::Serialize)]
pub struct HistoricalEndpoint {
    pub dest_lat: f64,
    pub dest_lon: f64,
    pub connection_count: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct HistoricalStats {
    pub total_connections: u64,
    pub total_bytes_in: u64,
    pub total_bytes_out: u64,
    pub first_seen_ms: Option<u64>,
    pub last_seen_ms: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TrackerStats {
    pub total_tracker_hits: u64,
    pub total_bytes_blocked: u64,
    pub top_domains: Vec<TrackerDomainStat>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TrackerDomainStat {
    pub domain: String,
    pub category: Option<String>,
    pub total_hits: u64,
    pub total_bytes: u64,
    pub last_seen_ms: u64,
}

// ---- Database ----

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn open() -> Result<Self, String> {
        let dir = dirs::home_dir()
            .ok_or("Cannot find home directory")?
            .join(".blip");
        std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create ~/.blip: {}", e))?;

        let db_path = dir.join("data.db");
        log::info!("Opening database at {:?}", db_path);

        let conn =
            Connection::open(&db_path).map_err(|e| format!("Failed to open database: {}", e))?;

        // WAL mode for concurrent reads
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;")
            .map_err(|e| format!("Failed to set pragmas: {}", e))?;

        let db = Self {
            conn: Mutex::new(conn),
        };
        db.run_migrations()?;

        Ok(db)
    }

    pub fn path() -> PathBuf {
        dirs::home_dir()
            .unwrap_or_default()
            .join(".blip")
            .join("data.db")
    }

    fn run_migrations(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();

        // Create schema_version table if missing
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);",
        )
        .map_err(|e| format!("Failed to create schema_version: {}", e))?;

        let current: i32 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_version",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);

        if current < 1 {
            log::info!("Running migration v1...");
            conn.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS connections (
                    id TEXT PRIMARY KEY,
                    dest_ip TEXT NOT NULL,
                    dest_port INTEGER NOT NULL,
                    process_name TEXT,
                    protocol TEXT NOT NULL,
                    dest_lat REAL NOT NULL,
                    dest_lon REAL NOT NULL,
                    domain TEXT,
                    city TEXT,
                    country TEXT,
                    bytes_sent INTEGER NOT NULL DEFAULT 0,
                    bytes_received INTEGER NOT NULL DEFAULT 0,
                    first_seen_ms INTEGER NOT NULL,
                    last_seen_ms INTEGER NOT NULL,
                    active INTEGER NOT NULL DEFAULT 1,
                    ping_ms REAL,
                    is_tracker INTEGER NOT NULL DEFAULT 0,
                    tracker_category TEXT,
                    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
                );
                CREATE INDEX IF NOT EXISTS idx_conn_domain ON connections(domain);
                CREATE INDEX IF NOT EXISTS idx_conn_dest_ip ON connections(dest_ip);
                CREATE INDEX IF NOT EXISTS idx_conn_tracker ON connections(is_tracker);
                CREATE INDEX IF NOT EXISTS idx_conn_first_seen ON connections(first_seen_ms);

                CREATE TABLE IF NOT EXISTS tracker_summary (
                    domain TEXT PRIMARY KEY,
                    category TEXT,
                    total_hits INTEGER NOT NULL DEFAULT 0,
                    total_bytes_in INTEGER NOT NULL DEFAULT 0,
                    total_bytes_out INTEGER NOT NULL DEFAULT 0,
                    first_seen_ms INTEGER NOT NULL,
                    last_seen_ms INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS blocklists (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    source_url TEXT NOT NULL,
                    domain_count INTEGER NOT NULL DEFAULT 0,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
                );

                CREATE TABLE IF NOT EXISTS blocklist_domains (
                    blocklist_id TEXT NOT NULL REFERENCES blocklists(id) ON DELETE CASCADE,
                    domain TEXT NOT NULL,
                    PRIMARY KEY (blocklist_id, domain)
                );
                CREATE INDEX IF NOT EXISTS idx_bl_domain ON blocklist_domains(domain);

                CREATE TABLE IF NOT EXISTS preferences (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );

                INSERT OR REPLACE INTO schema_version (version) VALUES (1);
                ",
            )
            .map_err(|e| format!("Migration v1 failed: {}", e))?;
            log::info!("Migration v1 complete");
        }

        if current < 2 {
            log::info!("Running migration v2 (DNS queries)...");
            conn.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS dns_queries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    domain TEXT NOT NULL,
                    query_type TEXT NOT NULL,
                    response_ips TEXT,
                    timestamp_ms INTEGER NOT NULL,
                    is_blocked INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_dns_domain ON dns_queries(domain);
                CREATE INDEX IF NOT EXISTS idx_dns_timestamp ON dns_queries(timestamp_ms);

                INSERT OR REPLACE INTO schema_version (version) VALUES (2);
                ",
            )
            .map_err(|e| format!("Migration v2 failed: {}", e))?;
            log::info!("Migration v2 complete");
        }

        Ok(())
    }

    // ---- Connections ----

    pub fn insert_connections(&self, conns: &[ResolvedConnection]) -> Result<usize, String> {
        let conn = self.conn.lock().unwrap();
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| format!("Transaction failed: {}", e))?;

        let mut count = 0;
        {
            let mut stmt = tx
                .prepare_cached(
                    "INSERT OR REPLACE INTO connections
                    (id, dest_ip, dest_port, process_name, protocol, dest_lat, dest_lon,
                     domain, city, country, bytes_sent, bytes_received,
                     first_seen_ms, last_seen_ms, active, ping_ms, is_tracker, tracker_category)
                    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)",
                )
                .map_err(|e| format!("Prepare failed: {}", e))?;

            for c in conns {
                let proto = match c.protocol {
                    Protocol::Tcp => "Tcp",
                    Protocol::Udp => "Udp",
                    Protocol::Other => "Other",
                };
                stmt.execute(params![
                    c.id,
                    c.dest_ip,
                    c.dest_port,
                    c.process_name,
                    proto,
                    c.dest_lat,
                    c.dest_lon,
                    c.domain,
                    c.city,
                    c.country,
                    c.bytes_sent,
                    c.bytes_received,
                    c.first_seen_ms,
                    c.last_seen_ms,
                    c.active,
                    c.ping_ms,
                    c.is_tracker,
                    c.tracker_category
                ])
                .map_err(|e| format!("Insert failed: {}", e))?;
                count += 1;
            }
        }

        tx.commit()
            .map_err(|e| format!("Commit failed: {}", e))?;
        Ok(count)
    }

    // ---- DNS queries ----

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

    // ---- Tracker summary ----

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

    // ---- Historical queries ----

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
                 LIMIT 20",
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

    // ---- Preferences ----

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

    // ---- Blocklists ----

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
