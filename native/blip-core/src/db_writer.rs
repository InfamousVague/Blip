use crate::capture::types::ResolvedConnection;
use crate::db::Database;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::time::Duration;

pub enum DbMessage {
    InsertConnection(ResolvedConnection),
    UpdateTracker {
        domain: String,
        category: Option<String>,
        bytes_in: u64,
        bytes_out: u64,
        timestamp_ms: u64,
    },
    InsertDnsQuery {
        domain: String,
        query_type: String,
        response_ips: Vec<String>,
        timestamp_ms: u64,
        is_blocked: bool,
    },
    Shutdown,
}

pub struct DbWriter {
    tx: mpsc::Sender<DbMessage>,
}

impl DbWriter {
    pub fn start(db: Arc<Database>) -> Self {
        let (tx, mut rx) = mpsc::channel::<DbMessage>(2048);

        // Spawn on a dedicated thread with its own tokio runtime
        // so it works even before Tauri's runtime is initialized
        std::thread::Builder::new()
            .name("blip-db-writer".into())
            .spawn(move || {
                let rt = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .expect("Failed to create db writer runtime");
                rt.block_on(async move {
            let mut conn_buffer: Vec<ResolvedConnection> = Vec::with_capacity(128);
            let mut tracker_buffer: HashMap<String, (Option<String>, u64, u64, u64)> =
                HashMap::new();
            let mut dns_buffer: Vec<(String, String, Vec<String>, u64, bool)> = Vec::new();
            let mut interval = tokio::time::interval(Duration::from_secs(2));

            loop {
                tokio::select! {
                    msg = rx.recv() => {
                        match msg {
                            Some(DbMessage::InsertConnection(conn)) => {
                                conn_buffer.push(conn);
                                // Auto-flush if buffer gets large
                                if conn_buffer.len() >= 100 {
                                    flush(&db, &mut conn_buffer, &mut tracker_buffer, &mut dns_buffer);
                                }
                            }
                            Some(DbMessage::UpdateTracker { domain, category, bytes_in, bytes_out, timestamp_ms }) => {
                                let entry = tracker_buffer.entry(domain).or_insert((category, 0, 0, timestamp_ms));
                                entry.1 += bytes_in;
                                entry.2 += bytes_out;
                                entry.3 = timestamp_ms;
                            }
                            Some(DbMessage::InsertDnsQuery { domain, query_type, response_ips, timestamp_ms, is_blocked }) => {
                                dns_buffer.push((domain, query_type, response_ips, timestamp_ms, is_blocked));
                            }
                            Some(DbMessage::Shutdown) => {
                                log::info!("DbWriter shutting down, flushing {} connections", conn_buffer.len());
                                flush(&db, &mut conn_buffer, &mut tracker_buffer, &mut dns_buffer);
                                break;
                            }
                            None => {
                                // Channel closed
                                flush(&db, &mut conn_buffer, &mut tracker_buffer, &mut dns_buffer);
                                break;
                            }
                        }
                    }
                    _ = interval.tick() => {
                        if !conn_buffer.is_empty() || !tracker_buffer.is_empty() || !dns_buffer.is_empty() {
                            flush(&db, &mut conn_buffer, &mut tracker_buffer, &mut dns_buffer);
                        }
                    }
                }
            }

            log::info!("DbWriter stopped");
                });
            })
            .expect("Failed to spawn db writer thread");

        Self { tx }
    }

    pub fn send(&self, msg: DbMessage) {
        // Non-blocking send — drop if channel full (don't block capture loop)
        let _ = self.tx.try_send(msg);
    }

    pub async fn send_async(&self, msg: DbMessage) {
        let _ = self.tx.send(msg).await;
    }

    pub fn send_dns_query(
        &self,
        domain: String,
        query_type: String,
        response_ips: Vec<String>,
        timestamp_ms: u64,
        is_blocked: bool,
    ) {
        let _ = self.tx.try_send(DbMessage::InsertDnsQuery {
            domain,
            query_type,
            response_ips,
            timestamp_ms,
            is_blocked,
        });
    }

    pub async fn shutdown(&self) {
        let _ = self.tx.send(DbMessage::Shutdown).await;
    }
}

fn flush(
    db: &Arc<Database>,
    conn_buffer: &mut Vec<ResolvedConnection>,
    tracker_buffer: &mut HashMap<String, (Option<String>, u64, u64, u64)>,
    dns_buffer: &mut Vec<(String, String, Vec<String>, u64, bool)>,
) {
    if !conn_buffer.is_empty() {
        let conns: Vec<ResolvedConnection> = conn_buffer.drain(..).collect();
        // Runs on dedicated thread, so synchronous DB work is fine
        match db.insert_connections(&conns) {
            Ok(n) => log::debug!("Flushed {} connections to DB", n),
            Err(e) => log::error!("DB flush error: {}", e),
        }
    }

    if !tracker_buffer.is_empty() {
        let trackers: Vec<(String, Option<String>, u64, u64, u64)> = tracker_buffer
            .drain()
            .map(|(domain, (cat, bi, bo, ts))| (domain, cat, bi, bo, ts))
            .collect();
        for (domain, category, bytes_in, bytes_out, ts) in &trackers {
            if let Err(e) = db.update_tracker_summary(
                domain,
                category.as_deref(),
                *bytes_in,
                *bytes_out,
                *ts,
            ) {
                log::error!("Tracker summary update error: {}", e);
            }
        }
    }

    if !dns_buffer.is_empty() {
        let queries: Vec<_> = dns_buffer.drain(..).collect();
        if let Err(e) = db.insert_dns_queries(&queries) {
            log::error!("DNS query insert error: {}", e);
        }
    }
}
