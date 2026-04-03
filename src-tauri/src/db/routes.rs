use super::Database;

impl Database {
    pub fn insert_traced_route(&self, route: &crate::traceroute::TracedRoute) {
        let conn = self.conn.lock().unwrap();
        let hops_json = serde_json::to_string(&route.hops).unwrap_or_default();
        let _ = conn.execute(
            "INSERT OR REPLACE INTO traced_routes (dest_ip, hops, traced_at, ttl_ms) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![route.dest_ip, hops_json, route.traced_at, 86400000i64],
        );
    }

    pub fn get_traced_route(&self, dest_ip: &str) -> Option<crate::traceroute::TracedRoute> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        conn.query_row(
            "SELECT dest_ip, hops, traced_at FROM traced_routes WHERE dest_ip = ?1 AND (traced_at + ttl_ms) > ?2",
            rusqlite::params![dest_ip, now],
            |row| {
                let dest_ip: String = row.get(0)?;
                let hops_json: String = row.get(1)?;
                let traced_at: u64 = row.get(2)?;
                let hops: Vec<crate::traceroute::TracerouteHop> =
                    serde_json::from_str(&hops_json).unwrap_or_default();
                Ok(crate::traceroute::TracedRoute { dest_ip, hops, traced_at })
            },
        )
        .ok()
    }

    pub fn get_all_traced_routes(&self) -> std::collections::HashMap<String, crate::traceroute::TracedRoute> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        let mut stmt = match conn.prepare(
            "SELECT dest_ip, hops, traced_at FROM traced_routes WHERE (traced_at + ttl_ms) > ?1"
        ) {
            Ok(s) => s,
            Err(_) => return std::collections::HashMap::new(),
        };
        let routes = stmt
            .query_map(rusqlite::params![now], |row| {
                let dest_ip: String = row.get(0)?;
                let hops_json: String = row.get(1)?;
                let traced_at: u64 = row.get(2)?;
                let hops: Vec<crate::traceroute::TracerouteHop> =
                    serde_json::from_str(&hops_json).unwrap_or_default();
                Ok(crate::traceroute::TracedRoute { dest_ip, hops, traced_at })
            })
            .ok();
        match routes {
            Some(rows) => rows
                .filter_map(|r| r.ok())
                .map(|r| (r.dest_ip.clone(), r))
                .collect(),
            None => std::collections::HashMap::new(),
        }
    }

    // ---- Route History (for comparison) ----

    pub fn insert_route_history(&self, route: &crate::traceroute::TracedRoute) {
        let conn = self.conn.lock().unwrap();
        let hops_json = serde_json::to_string(&route.hops).unwrap_or_default();
        // Extract AS path as comma-separated ASNs for quick comparison
        let as_path: String = route.hops.iter()
            .filter_map(|h| h.asn)
            .map(|a| a.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let _ = conn.execute(
            "INSERT INTO route_history (dest_ip, hops, as_path, traced_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![route.dest_ip, hops_json, as_path, route.traced_at],
        );
    }

    /// Get the previous AS path for a destination (most recent before the given timestamp).
    pub fn get_previous_as_path(&self, dest_ip: &str, before_ms: u64) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT as_path FROM route_history WHERE dest_ip = ?1 AND traced_at < ?2 ORDER BY traced_at DESC LIMIT 1",
            rusqlite::params![dest_ip, before_ms],
            |row| row.get(0),
        ).ok()
    }
}
