pub mod parser;
pub mod types;

use crate::blocklist::BlocklistStore;
use crate::db_writer::DbWriter;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::RwLock;
use types::{DnsEvent, DnsMapping};

pub type SharedDnsMapping = Arc<RwLock<DnsMapping>>;

/// Manages the privileged DNS capture helper process.
pub struct DnsCaptureManager {
    child: Option<tokio::process::Child>,
}

impl DnsCaptureManager {
    /// Start DNS capture by spawning the helper binary with sudo.
    /// Returns the manager handle and spawns a background task that reads events.
    pub async fn start(
        helper_path: PathBuf,
        dns_mapping: SharedDnsMapping,
        blocklists: Arc<BlocklistStore>,
        db_writer: Arc<DbWriter>,
    ) -> Result<Self, String> {
        let mut child = Command::new("sudo")
            .arg("-n") // non-interactive, use cached credentials
            .arg(&helper_path)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .stdin(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("Failed to spawn blip-dns-helper: {}", e))?;

        let stdout = child
            .stdout
            .take()
            .ok_or("Failed to capture helper stdout")?;

        let stderr = child
            .stderr
            .take()
            .ok_or("Failed to capture helper stderr")?;

        // Spawn stderr reader (logs)
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                log::info!("[dns-helper] {}", line);
            }
        });

        // Spawn stdout reader (DNS events)
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                match serde_json::from_str::<DnsEvent>(&line) {
                    Ok(event) => {
                        process_dns_event(&event, &dns_mapping, &blocklists, &db_writer).await;
                    }
                    Err(e) => {
                        log::warn!("Failed to parse DNS event: {} — line: {}", e, line);
                    }
                }
            }
            log::info!("DNS capture helper stdout closed");
        });

        log::info!(
            "DNS capture started with helper: {}",
            helper_path.display()
        );
        Ok(Self { child: Some(child) })
    }

    /// Stop the DNS capture helper.
    pub async fn stop(&mut self) {
        if let Some(ref mut child) = self.child {
            // Send SIGTERM via sudo kill
            if let Some(pid) = child.id() {
                let _ = Command::new("sudo")
                    .arg("-n")
                    .arg("kill")
                    .arg(pid.to_string())
                    .output()
                    .await;
            }
            let _ = child.wait().await;
            self.child = None;
            log::info!("DNS capture stopped");
        }
    }
}

async fn process_dns_event(
    event: &DnsEvent,
    dns_mapping: &SharedDnsMapping,
    blocklists: &BlocklistStore,
    db_writer: &DbWriter,
) {
    let is_blocked = blocklists.is_blocked(&event.domain);
    let blocked_by = if is_blocked {
        blocklists.blocked_by(&event.domain)
    } else {
        None
    };

    // Update the shared mapping
    {
        let mut mapping = dns_mapping.write().await;
        mapping.record(event, is_blocked, blocked_by.clone());
    }

    // Persist to database
    db_writer.send_dns_query(
        event.domain.clone(),
        event.query_type.clone(),
        event.ips.clone(),
        event.ts,
        is_blocked,
    );
}
