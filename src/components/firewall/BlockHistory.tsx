import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Separator } from "../../ui/components/Separator";
import type { BlockHistoryEntry, BlockStatsHourly } from "../../types/firewall";
import "./BlockHistory.css";

type Tab = "recent" | "stats";

export function BlockHistory() {
  const [tab, setTab] = useState<Tab>("recent");
  const [entries, setEntries] = useState<BlockHistoryEntry[]>([]);
  const [stats, setStats] = useState<BlockStatsHourly[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        if (tab === "recent") {
          const data = await invoke<BlockHistoryEntry[]>("get_block_history", { limit: 100 });
          setEntries(data);
        } else {
          const data = await invoke<BlockStatsHourly[]>("get_block_stats_hourly", { hoursBack: 24 });
          setStats(data);
        }
      } catch {}
    };
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [tab]);

  // Aggregate stats for the stats tab
  const topApps = new globalThis.Map<string, number>();
  const topDomains = new globalThis.Map<string, number>();
  for (const s of stats) {
    if (s.app_id) topApps.set(s.app_id, (topApps.get(s.app_id) || 0) + s.block_count);
    if (s.domain) topDomains.set(s.domain, (topDomains.get(s.domain) || 0) + s.block_count);
  }
  const sortedApps = [...topApps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const sortedDomains = [...topDomains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const totalBlocks = stats.reduce((sum, s) => sum + s.block_count, 0);

  return (
    <div className="block-history">
      <div className="block-history__tabs">
        <button
          className={`block-history__tab ${tab === "recent" ? "block-history__tab--active" : ""}`}
          onClick={() => setTab("recent")}
        >
          Recent
        </button>
        <button
          className={`block-history__tab ${tab === "stats" ? "block-history__tab--active" : ""}`}
          onClick={() => setTab("stats")}
        >
          Stats (24h)
        </button>
      </div>

      {tab === "recent" && (
        <div className="block-history__list">
          {entries.length === 0 && (
            <div className="block-history__empty">No blocked connections yet</div>
          )}
          {entries.map((entry) => (
            <div key={entry.id} className="block-history__entry">
              <div className="block-history__entry-main">
                <span className="block-history__entry-app">
                  {entry.app_id?.split(".").pop() || "Unknown"}
                </span>
                <span className="block-history__entry-arrow">→</span>
                <span className="block-history__entry-domain">
                  {entry.domain || entry.dest_ip || "?"}
                </span>
                {entry.dest_port && (
                  <span className="block-history__entry-port">:{entry.dest_port}</span>
                )}
              </div>
              <div className="block-history__entry-meta">
                <span className={`block-history__reason block-history__reason--${entry.reason}`}>
                  {entry.reason.replace("_", " ")}
                </span>
                <span className="block-history__entry-time">
                  {new Date(entry.timestamp_ms).toLocaleTimeString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "stats" && (
        <div className="block-history__stats">
          <div className="block-history__stat-total">
            <span className="block-history__stat-value">{totalBlocks.toLocaleString()}</span>
            <span className="block-history__stat-label">blocks in last 24h</span>
          </div>

          <Separator />

          <div className="block-history__stat-section">
            <span className="block-history__stat-heading">Top Blocked Apps</span>
            {sortedApps.map(([app, count]) => (
              <div key={app} className="block-history__stat-row">
                <span className="block-history__stat-name">{app.split(".").pop()}</span>
                <span className="block-history__stat-count">{count}</span>
              </div>
            ))}
            {sortedApps.length === 0 && (
              <span className="block-history__empty">No data</span>
            )}
          </div>

          <Separator />

          <div className="block-history__stat-section">
            <span className="block-history__stat-heading">Top Blocked Domains</span>
            {sortedDomains.map(([domain, count]) => (
              <div key={domain} className="block-history__stat-row">
                <span className="block-history__stat-name">{domain}</span>
                <span className="block-history__stat-count">{count}</span>
              </div>
            ))}
            {sortedDomains.length === 0 && (
              <span className="block-history__empty">No data</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
