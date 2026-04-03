pub mod types;
mod app_registry;
mod blocklists;
mod connections;
mod dns;
mod firewall;
mod preferences;
mod routes;
mod stats;
mod trackers;

pub use types::*;

use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

// ---- Database ----

pub struct Database {
    pub(crate) conn: Mutex<Connection>,
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

        if current < 6 {
            log::info!("Running migration v6 (traced routes)...");
            conn.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS traced_routes (
                    dest_ip TEXT PRIMARY KEY,
                    hops TEXT NOT NULL,
                    traced_at INTEGER NOT NULL,
                    ttl_ms INTEGER NOT NULL DEFAULT 86400000
                );

                INSERT OR REPLACE INTO schema_version (version) VALUES (6);
                ",
            )
            .map_err(|e| format!("Migration v6 failed: {}", e))?;
            log::info!("Migration v6 complete");
        }

        if current < 7 {
            log::info!("Running migration v7 (route history for comparison)...");
            conn.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS route_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    dest_ip TEXT NOT NULL,
                    hops TEXT NOT NULL,
                    as_path TEXT,
                    traced_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_route_history_dest ON route_history(dest_ip);
                CREATE INDEX IF NOT EXISTS idx_route_history_time ON route_history(traced_at);

                INSERT OR REPLACE INTO schema_version (version) VALUES (7);
                ",
            )
            .map_err(|e| format!("Migration v7 failed: {}", e))?;
            log::info!("Migration v7 complete");
        }

        if current < 8 {
            log::info!("Running migration v8 (firewall rebuild - fresh start)...");
            conn.execute_batch(
                "
                -- Drop old firewall tables (fresh start per design decision)
                DROP TABLE IF EXISTS firewall_rules;
                DROP TABLE IF EXISTS app_connections;

                -- New firewall rules with full granularity
                CREATE TABLE firewall_rules (
                    id TEXT PRIMARY KEY,
                    profile_id TEXT NOT NULL DEFAULT 'default',
                    app_id TEXT NOT NULL,
                    app_name TEXT NOT NULL,
                    app_path TEXT,
                    action TEXT NOT NULL DEFAULT 'ask',
                    domain_pattern TEXT,
                    domain_match_type TEXT,
                    port TEXT,
                    protocol TEXT,
                    direction TEXT NOT NULL DEFAULT 'any',
                    lifetime TEXT NOT NULL DEFAULT 'forever',
                    hit_count INTEGER NOT NULL DEFAULT 0,
                    bytes_allowed INTEGER NOT NULL DEFAULT 0,
                    bytes_blocked INTEGER NOT NULL DEFAULT 0,
                    last_triggered_ms INTEGER,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    priority INTEGER NOT NULL DEFAULT 100,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX idx_fw2_app_profile ON firewall_rules(app_id, profile_id);
                CREATE INDEX idx_fw2_action ON firewall_rules(action);
                CREATE INDEX idx_fw2_enabled ON firewall_rules(enabled);
                CREATE INDEX idx_fw2_profile ON firewall_rules(profile_id);

                -- App registry (replaces app_connections)
                CREATE TABLE app_registry (
                    app_id TEXT PRIMARY KEY,
                    app_name TEXT NOT NULL,
                    app_path TEXT,
                    is_apple_signed INTEGER NOT NULL DEFAULT 0,
                    is_system_app INTEGER NOT NULL DEFAULT 0,
                    code_signing_status TEXT DEFAULT 'unknown',
                    first_seen_ms INTEGER NOT NULL,
                    last_seen_ms INTEGER NOT NULL,
                    total_connections INTEGER NOT NULL DEFAULT 0,
                    total_bytes_in INTEGER NOT NULL DEFAULT 0,
                    total_bytes_out INTEGER NOT NULL DEFAULT 0,
                    privacy_score TEXT,
                    tracker_connection_count INTEGER NOT NULL DEFAULT 0,
                    clean_connection_count INTEGER NOT NULL DEFAULT 0
                );

                -- Network profiles
                CREATE TABLE network_profiles (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    is_active INTEGER NOT NULL DEFAULT 0,
                    auto_switch_ssid TEXT,
                    auto_switch_vpn INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL
                );
                INSERT INTO network_profiles (id, name, description, is_active, created_at)
                    VALUES ('default', 'Default', 'Default network profile', 1, strftime('%s','now') * 1000);

                -- Block history (recent 100)
                CREATE TABLE block_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    app_id TEXT,
                    domain TEXT,
                    dest_ip TEXT,
                    dest_port INTEGER,
                    protocol TEXT,
                    direction TEXT,
                    rule_id TEXT,
                    reason TEXT NOT NULL,
                    timestamp_ms INTEGER NOT NULL
                );
                CREATE INDEX idx_bh_timestamp ON block_history(timestamp_ms);
                CREATE INDEX idx_bh_app ON block_history(app_id);

                -- Hourly block stats aggregation
                CREATE TABLE block_stats_hourly (
                    hour_bucket INTEGER NOT NULL,
                    app_id TEXT NOT NULL,
                    domain TEXT NOT NULL,
                    block_count INTEGER NOT NULL DEFAULT 0,
                    bytes_blocked INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (hour_bucket, app_id, domain)
                );

                -- Domain categories for category-based matching
                CREATE TABLE domain_categories (
                    domain_pattern TEXT NOT NULL,
                    category TEXT NOT NULL,
                    source TEXT DEFAULT 'builtin',
                    PRIMARY KEY (domain_pattern, category)
                );

                INSERT OR REPLACE INTO schema_version (version) VALUES (8);
                ",
            )
            .map_err(|e| format!("Migration v8 failed: {}", e))?;
            log::info!("Migration v8 complete — firewall rebuilt from scratch");
        }

        Ok(())
    }
}
