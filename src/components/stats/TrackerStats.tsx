import { useEffect, useState, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { StatCard } from "../../ui/components/StatCard";
import { TrackerRow } from "../../ui/components/TrackerRow";
import { Pagination } from "../../ui/components/Pagination";
import { FrostedCard } from "../../ui/glass";
import { getBrandIcon } from "../../utils/brand-icons";
import "./TrackerStats.css";

interface TrackerDomainStat {
  domain: string;
  category: string | null;
  total_hits: number;
  total_bytes: number;
  last_seen_ms: number;
}

interface TrackerStats {
  total_tracker_hits: number;
  total_bytes_blocked: number;
  top_domains: TrackerDomainStat[];
}

interface Props {
  visible: boolean;
}

const PAGE_SIZE = 30;

function formatLastSeen(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function TrackerStats({ visible }: Props) {
  const [stats, setStats] = useState<TrackerStats | null>(null);
  const [page, setPage] = useState(1);

  const fetchStats = useCallback(async () => {
    try {
      const data = await invoke<TrackerStats>("get_tracker_stats");
      setStats(data);
    } catch {
      // silently ignore fetch errors
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, [visible, fetchStats]);

  const totalPages = stats ? Math.max(1, Math.ceil(stats.top_domains.length / PAGE_SIZE)) : 1;
  const safePage = Math.min(page, totalPages);

  const visibleDomains = useMemo(() => {
    if (!stats) return [];
    const start = (safePage - 1) * PAGE_SIZE;
    return stats.top_domains.slice(start, start + PAGE_SIZE);
  }, [stats, safePage]);

  if (!stats) {
    return (
      <div style={{ padding: 16, color: "var(--blip-text-tertiary)", fontSize: 13 }}>
        Loading...
      </div>
    );
  }

  const isEmpty = stats.total_tracker_hits === 0;

  return (
    <div className="tracker-stats">
      <StatCard
        stats={[
          { label: "CONNECTIONS", value: stats.total_tracker_hits, minDigits: 5 },
          { label: "DOMAINS", value: stats.top_domains.length, minDigits: 3 },
        ]}
      />

      {isEmpty ? (
        <div className="tracker-stats__empty">
          <span className="tracker-stats__shield-icon">&#128737;</span>
          <span style={{ color: "var(--blip-text-tertiary)", fontSize: 13 }}>No trackers detected</span>
        </div>
      ) : (
        <FrostedCard className="blip-scroll-list">
          {visibleDomains.map((domain) => {
            const brand = getBrandIcon(domain.domain);
            return (
              <TrackerRow
                key={domain.domain}
                domain={domain.domain}
                category={domain.category || undefined}
                totalHits={domain.total_hits}
                lastSeen={formatLastSeen(domain.last_seen_ms)}
                iconUrl={brand?.url}
              />
            );
          })}
        </FrostedCard>
      )}
      <Pagination
        page={safePage}
        totalPages={totalPages}
        totalItems={stats.top_domains.length}
        onPageChange={setPage}
        size="sm"
      />
    </div>
  );
}
