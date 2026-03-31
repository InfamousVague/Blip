use crate::blocklist::BlocklistInfo;
use crate::capture::types::{Protocol, ResolvedConnection};
use rusqlite::{params, Connection};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;

#[allow(dead_code)]
const CURRENT_SCHEMA_VERSION: i32 = 5;

// ---- Firewall types ----

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FirewallRule {
    pub id: String,
    pub app_id: String,
    pub app_name: String,
    pub app_path: Option<String>,
    pub action: String, // "allow", "deny", "unspecified"
    pub domain: Option<String>,
    pub port: Option<u16>,
    pub protocol: Option<String>,
    pub expires_at: Option<u64>,
    pub lifetime: String, // "permanent", "session", "timed"
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AppConnectionInfo {
    pub app_id: String,
    pub app_name: String,
    pub app_path: Option<String>,
    pub first_seen_ms: u64,
    pub last_seen_ms: u64,
    pub total_connections: u64,
    pub is_apple_signed: bool,
}

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

        if current < 3 {
            log::info!("Running migration v3 (enrichment columns + session stats)...");
            conn.execute_batch(
                "
                -- Add enrichment columns to connections (ignore if they already exist)
                ALTER TABLE connections ADD COLUMN asn INTEGER;
                ALTER TABLE connections ADD COLUMN asn_org TEXT;
                ALTER TABLE connections ADD COLUMN cloud_provider TEXT;
                ALTER TABLE connections ADD COLUMN cloud_region TEXT;
                ALTER TABLE connections ADD COLUMN datacenter TEXT;
                ALTER TABLE connections ADD COLUMN is_cdn INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE connections ADD COLUMN network_type TEXT;

                -- Session stats table for tracking cumulative metrics across restarts
                CREATE TABLE IF NOT EXISTS session_stats (
                    key TEXT PRIMARY KEY,
                    value_int INTEGER NOT NULL DEFAULT 0
                );

                CREATE INDEX IF NOT EXISTS idx_conn_asn ON connections(asn_org);
                CREATE INDEX IF NOT EXISTS idx_conn_cloud ON connections(cloud_provider);

                INSERT OR REPLACE INTO schema_version (version) VALUES (3);
                ",
            )
            .map_err(|e| format!("Migration v3 failed: {}", e))?;
            log::info!("Migration v3 complete");
        }

        if current < 4 {
            log::info!("Running migration v4 (firewall rules + app connections)...");
            conn.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS firewall_rules (
                    id TEXT PRIMARY KEY,
                    app_id TEXT NOT NULL UNIQUE,
                    app_name TEXT NOT NULL,
                    app_path TEXT,
                    action TEXT NOT NULL DEFAULT 'unspecified',
                    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
                    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
                );
                CREATE INDEX IF NOT EXISTS idx_fw_app_id ON firewall_rules(app_id);
                CREATE INDEX IF NOT EXISTS idx_fw_action ON firewall_rules(action);

                CREATE TABLE IF NOT EXISTS app_connections (
                    app_id TEXT PRIMARY KEY,
                    app_name TEXT NOT NULL,
                    app_path TEXT,
                    first_seen_ms INTEGER NOT NULL,
                    last_seen_ms INTEGER NOT NULL,
                    total_connections INTEGER NOT NULL DEFAULT 0,
                    is_apple_signed INTEGER NOT NULL DEFAULT 0
                );

                INSERT OR REPLACE INTO schema_version (version) VALUES (4);
                ",
            )
            .map_err(|e| format!("Migration v4 failed: {}", e))?;
            log::info!("Migration v4 complete");
        }

        if current < 5 {
            log::info!("Running migration v5 (scoped + temporary rules)...");
            // Rebuild firewall_rules: drop UNIQUE on app_id, add domain/port/protocol/expires_at/lifetime
            conn.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS firewall_rules_new (
                    id TEXT PRIMARY KEY,
                    app_id TEXT NOT NULL,
                    app_name TEXT NOT NULL,
                    app_path TEXT,
                    action TEXT NOT NULL DEFAULT 'unspecified',
                    domain TEXT,
                    port INTEGER,
                    protocol TEXT,
                    expires_at INTEGER,
                    lifetime TEXT NOT NULL DEFAULT 'permanent',
                    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
                    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
                );

                INSERT INTO firewall_rules_new (id, app_id, app_name, app_path, action, created_at, updated_at)
                    SELECT id, app_id, app_name, app_path, action, created_at, updated_at
                    FROM firewall_rules;

                DROP TABLE IF EXISTS firewall_rules;
                ALTER TABLE firewall_rules_new RENAME TO firewall_rules;

                CREATE INDEX IF NOT EXISTS idx_fw_app_id ON firewall_rules(app_id);
                CREATE INDEX IF NOT EXISTS idx_fw_action ON firewall_rules(action);
                CREATE INDEX IF NOT EXISTS idx_fw_expires ON firewall_rules(expires_at);

                INSERT OR REPLACE INTO schema_version (version) VALUES (5);
                ",
            )
            .map_err(|e| format!("Migration v5 failed: {}", e))?;
            log::info!("Migration v5 complete");
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
                     first_seen_ms, last_seen_ms, active, ping_ms, is_tracker, tracker_category,
                     asn, asn_org, cloud_provider, cloud_region, datacenter, is_cdn, network_type)
                    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25)",
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
                    c.tracker_category,
                    c.asn,
                    c.asn_org,
                    c.cloud_provider,
                    c.cloud_region,
                    c.datacenter,
                    c.is_cdn,
                    c.network_type
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

    // ---- DNS Stats from DB ----

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

    /// Load recent IP→domain mappings from dns_queries for seeding DnsMapping
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

    // ---- Session stats ----

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

    // ---- Firewall rules ----

    pub fn get_firewall_rules(&self) -> Result<Vec<FirewallRule>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, app_id, app_name, app_path, action, domain, port, protocol, expires_at, lifetime, created_at, updated_at
                 FROM firewall_rules ORDER BY app_name"
            )
            .map_err(|e| format!("Prepare failed: {}", e))?;

        let rules = stmt
            .query_map([], |row| {
                Ok(FirewallRule {
                    id: row.get(0)?,
                    app_id: row.get(1)?,
                    app_name: row.get(2)?,
                    app_path: row.get(3)?,
                    action: row.get(4)?,
                    domain: row.get(5)?,
                    port: row.get::<_, Option<i32>>(6)?.map(|p| p as u16),
                    protocol: row.get(7)?,
                    expires_at: row.get(8)?,
                    lifetime: row.get::<_, Option<String>>(9)?.unwrap_or_else(|| "permanent".to_string()),
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            })
            .map_err(|e| format!("Query failed: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(rules)
    }

    pub fn set_firewall_rule(
        &self,
        app_id: &str,
        app_name: &str,
        app_path: Option<&str>,
        action: &str,
        domain: Option<&str>,
        port: Option<u16>,
        protocol: Option<&str>,
        lifetime: &str,
        expires_at: Option<u64>,
    ) -> Result<FirewallRule, String> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        // Match on (app_id, domain, port, protocol) for upserts
        let existing_id: Option<String> = conn
            .query_row(
                "SELECT id FROM firewall_rules WHERE app_id = ?1 AND domain IS ?2 AND port IS ?3 AND protocol IS ?4",
                params![app_id, domain, port.map(|p| p as i32), protocol],
                |row| row.get(0),
            )
            .ok();

        let id = existing_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        conn.execute(
            "INSERT OR REPLACE INTO firewall_rules (id, app_id, app_name, app_path, action, domain, port, protocol, expires_at, lifetime, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, COALESCE((SELECT created_at FROM firewall_rules WHERE id = ?1), ?11), ?11)",
            params![id, app_id, app_name, app_path, action, domain, port.map(|p| p as i32), protocol, expires_at, lifetime, now],
        )
        .map_err(|e| format!("Set firewall rule failed: {}", e))?;

        Ok(FirewallRule {
            id,
            app_id: app_id.to_string(),
            app_name: app_name.to_string(),
            app_path: app_path.map(String::from),
            action: action.to_string(),
            domain: domain.map(String::from),
            port,
            protocol: protocol.map(String::from),
            expires_at,
            lifetime: lifetime.to_string(),
            created_at: now,
            updated_at: now,
        })
    }

    pub fn delete_firewall_rule_by_id(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM firewall_rules WHERE id = ?1", params![id])
            .map_err(|e| format!("Delete firewall rule by id failed: {}", e))?;
        Ok(())
    }

    pub fn cleanup_expired_rules(&self) -> Result<usize, String> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        let count = conn.execute(
            "DELETE FROM firewall_rules WHERE expires_at IS NOT NULL AND expires_at <= ?1",
            params![now],
        )
        .map_err(|e| format!("Cleanup expired rules failed: {}", e))?;
        Ok(count)
    }

    pub fn cleanup_session_rules(&self) -> Result<usize, String> {
        let conn = self.conn.lock().unwrap();
        let count = conn.execute(
            "DELETE FROM firewall_rules WHERE lifetime = 'session'",
            [],
        )
        .map_err(|e| format!("Cleanup session rules failed: {}", e))?;
        Ok(count)
    }

    pub fn delete_firewall_rule(&self, app_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM firewall_rules WHERE app_id = ?1", params![app_id])
            .map_err(|e| format!("Delete firewall rule failed: {}", e))?;
        Ok(())
    }

    // ---- App connections (auto-discovered apps) ----

    /// Upsert an app connection record. Returns `true` if this is a newly discovered app.
    pub fn upsert_app_connection(&self, app_id: &str, app_name: &str, app_path: Option<&str>, is_apple: bool) -> Result<bool, String> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        // Check if this app already exists
        let is_new = conn
            .query_row(
                "SELECT 1 FROM app_connections WHERE app_id = ?1",
                params![app_id],
                |_| Ok(true),
            )
            .unwrap_or(false);

        conn.execute(
            "INSERT INTO app_connections (app_id, app_name, app_path, first_seen_ms, last_seen_ms, total_connections, is_apple_signed)
             VALUES (?1, ?2, ?3, ?4, ?4, 1, ?5)
             ON CONFLICT(app_id) DO UPDATE SET
                last_seen_ms = ?4,
                total_connections = total_connections + 1,
                app_name = CASE WHEN ?2 != 'unknown' THEN ?2 ELSE app_name END",
            params![app_id, app_name, app_path, now, is_apple],
        )
        .map_err(|e| format!("Upsert app connection failed: {}", e))?;
        Ok(!is_new)
    }

    pub fn get_app_connections(&self) -> Result<Vec<AppConnectionInfo>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT app_id, app_name, app_path, first_seen_ms, last_seen_ms, total_connections, is_apple_signed
                 FROM app_connections ORDER BY last_seen_ms DESC",
            )
            .map_err(|e| format!("Prepare failed: {}", e))?;

        let apps = stmt
            .query_map([], |row| {
                Ok(AppConnectionInfo {
                    app_id: row.get(0)?,
                    app_name: row.get(1)?,
                    app_path: row.get(2)?,
                    first_seen_ms: row.get(3)?,
                    last_seen_ms: row.get(4)?,
                    total_connections: row.get(5)?,
                    is_apple_signed: row.get::<_, i32>(6)? != 0,
                })
            })
            .map_err(|e| format!("Query failed: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(apps)
    }
}
