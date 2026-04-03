use super::Database;
use crate::capture::types::{Protocol, ResolvedConnection};
use rusqlite::params;

impl Database {
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
}
