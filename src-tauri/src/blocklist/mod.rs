pub mod updater;

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlocklistInfo {
    pub id: String,
    pub name: String,
    pub domain_count: usize,
    pub enabled: bool,
    #[serde(alias = "source")]
    pub source_url: String, // URL or "file"
}

struct BlocklistEntry {
    info: BlocklistInfo,
    domains: HashSet<String>,
}

pub struct BlocklistStore {
    lists: Mutex<HashMap<String, BlocklistEntry>>,
}

impl BlocklistStore {
    pub fn new() -> Self {
        Self {
            lists: Mutex::new(HashMap::new()),
        }
    }

    pub fn add(&self, name: String, source: String, content: &str) -> (BlocklistInfo, HashSet<String>) {
        let domains = parse_auto(content);
        let id = Uuid::new_v4().to_string();
        let info = BlocklistInfo {
            id: id.clone(),
            name,
            domain_count: domains.len(),
            enabled: true,
            source_url: source,
        };
        let entry = BlocklistEntry {
            info: info.clone(),
            domains: domains.clone(),
        };
        self.lists.lock().unwrap().insert(id, entry);
        (info, domains)
    }

    /// Bulk load blocklists from database on startup
    pub fn load_from_db(&self, entries: Vec<(BlocklistInfo, HashSet<String>)>) {
        let mut lists = self.lists.lock().unwrap();
        for (info, domains) in entries {
            let id = info.id.clone();
            lists.insert(id, BlocklistEntry { info, domains });
        }
    }

    /// Get domains for a specific blocklist (for DB persistence)
    pub fn get_domains(&self, id: &str) -> Option<HashSet<String>> {
        self.lists.lock().unwrap().get(id).map(|e| e.domains.clone())
    }

    pub fn remove(&self, id: &str) {
        self.lists.lock().unwrap().remove(id);
    }

    pub fn toggle(&self, id: &str, enabled: bool) {
        if let Some(entry) = self.lists.lock().unwrap().get_mut(id) {
            entry.info.enabled = enabled;
        }
    }

    pub fn get_all(&self) -> Vec<BlocklistInfo> {
        self.lists
            .lock()
            .unwrap()
            .values()
            .map(|e| e.info.clone())
            .collect()
    }

    /// Check if a domain is blocked by any enabled list.
    /// Supports subdomain matching: "ad.tracker.com" matches blocklist entry "tracker.com".
    pub fn is_blocked(&self, domain: &str) -> bool {
        let domain_lower = domain.to_lowercase();
        let lists = self.lists.lock().unwrap();
        for entry in lists.values() {
            if !entry.info.enabled {
                continue;
            }
            // Exact match
            if entry.domains.contains(&domain_lower) {
                return true;
            }
            // Subdomain match: walk up the domain parts
            let mut d = domain_lower.as_str();
            while let Some(dot_pos) = d.find('.') {
                d = &d[dot_pos + 1..];
                if entry.domains.contains(d) {
                    return true;
                }
            }
        }
        false
    }

    /// Replace domains for an existing blocklist (used during update).
    pub fn update_domains(&self, id: &str, domains: std::collections::HashSet<String>) {
        let mut lists = self.lists.lock().unwrap();
        if let Some(entry) = lists.get_mut(id) {
            entry.info.domain_count = domains.len();
            entry.domains = domains;
        }
    }

    /// Returns all blocked domains from all enabled lists (for NE sync).
    pub fn all_blocked_domains(&self) -> Vec<String> {
        let lists = self.lists.lock().unwrap();
        let mut all = Vec::new();
        for entry in lists.values() {
            if entry.info.enabled {
                all.extend(entry.domains.iter().cloned());
            }
        }
        all
    }

    /// Returns the name of the blocklist that blocked this domain, if any.
    pub fn blocked_by(&self, domain: &str) -> Option<String> {
        let domain_lower = domain.to_lowercase();
        let lists = self.lists.lock().unwrap();
        for entry in lists.values() {
            if !entry.info.enabled {
                continue;
            }
            if entry.domains.contains(&domain_lower) {
                return Some(entry.info.name.clone());
            }
            let mut d = domain_lower.as_str();
            while let Some(dot_pos) = d.find('.') {
                d = &d[dot_pos + 1..];
                if entry.domains.contains(d) {
                    return Some(entry.info.name.clone());
                }
            }
        }
        None
    }
}

/// Auto-detect format and parse domains (public for updater)
pub fn parse_auto_pub(content: &str) -> HashSet<String> {
    parse_auto(content)
}

/// Auto-detect format and parse domains
fn parse_auto(content: &str) -> HashSet<String> {
    let mut domains = HashSet::new();

    for line in content.lines() {
        let line = line.trim();

        // Skip comments and empty lines
        if line.is_empty() || line.starts_with('#') || line.starts_with('!') {
            continue;
        }

        // Hosts file format: "0.0.0.0 domain" or "127.0.0.1 domain"
        if line.starts_with("0.0.0.0 ") || line.starts_with("127.0.0.1 ") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                let domain = parts[1].to_lowercase();
                if domain != "localhost" && domain.contains('.') {
                    domains.insert(domain);
                }
            }
            continue;
        }

        // Adblock Plus format: "||domain^"
        if line.starts_with("||") && line.ends_with('^') {
            let domain = &line[2..line.len() - 1];
            if domain.contains('.') && !domain.contains('/') {
                domains.insert(domain.to_lowercase());
            }
            continue;
        }

        // Plain domain format: one domain per line
        if !line.contains(' ') && line.contains('.') && !line.starts_with('[') {
            domains.insert(line.to_lowercase());
        }
    }

    domains
}
