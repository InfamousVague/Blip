use crate::blocklist::BlocklistStore;
use crate::db::Database;
use std::sync::Arc;
use tokio::time::{Duration, interval};

const UPDATE_INTERVAL_HOURS: u64 = 6;

/// Background blocklist updater — refreshes all blocklists periodically.
pub async fn start_blocklist_updater(
    blocklists: Arc<BlocklistStore>,
    db: Arc<Database>,
) {
    let mut tick = interval(Duration::from_secs(UPDATE_INTERVAL_HOURS * 3600));
    // Skip the first immediate tick
    tick.tick().await;

    loop {
        tick.tick().await;
        log::info!("Blocklist updater: checking for updates...");
        update_all_blocklists(&blocklists, &db).await;
    }
}

/// Re-download all blocklists from their source URLs and update the store + DB.
pub async fn update_all_blocklists(
    blocklists: &BlocklistStore,
    db: &Database,
) {
    let lists = blocklists.get_all();
    let mut updated = 0;
    let mut failed = 0;

    for list in &lists {
        if !list.enabled {
            continue;
        }
        if list.source_url == "file" || list.source_url.is_empty() {
            continue; // Skip manually imported files
        }

        log::info!("Updating blocklist: {} ({})", list.name, list.source_url);
        match reqwest::get(&list.source_url).await {
            Ok(resp) => match resp.text().await {
                Ok(content) => {
                    // Update the existing list with new content
                    let new_domains = crate::blocklist::parse_auto_pub(&content);
                    let old_count = list.domain_count;
                    let new_count = new_domains.len();

                    // Update in-memory store
                    blocklists.update_domains(&list.id, new_domains.clone());

                    // Update database
                    let mut updated_info = list.clone();
                    updated_info.domain_count = new_count;
                    if let Err(e) = db.save_blocklist(&updated_info, &new_domains) {
                        log::error!("Failed to persist updated blocklist '{}': {}", list.name, e);
                        failed += 1;
                    } else {
                        log::info!(
                            "Updated '{}': {} → {} domains",
                            list.name, old_count, new_count
                        );
                        updated += 1;
                    }
                }
                Err(e) => {
                    log::warn!("Failed to read blocklist '{}': {}", list.name, e);
                    failed += 1;
                }
            },
            Err(e) => {
                log::warn!("Failed to download blocklist '{}': {}", list.name, e);
                failed += 1;
            }
        }
    }

    log::info!(
        "Blocklist update complete: {} updated, {} failed",
        updated, failed
    );
}
