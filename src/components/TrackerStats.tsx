import { useEffect, useState, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Stack } from "@mattmattmattmatt/base/primitives/stack/Stack";
import { Text } from "@mattmattmattmatt/base/primitives/text/Text";
import { NumberRoll } from "@mattmattmattmatt/base/primitives/number-roll/NumberRoll";
import { Pagination } from "@mattmattmattmatt/base/primitives/pagination/Pagination";
import "@mattmattmattmatt/base/primitives/number-roll/number-roll.css";
import "@mattmattmattmatt/base/primitives/stack/stack.css";
import "@mattmattmattmatt/base/primitives/text/text.css";
import "@mattmattmattmatt/base/primitives/pagination/pagination.css";
import { Icon } from "@mattmattmattmatt/base/primitives/icon/Icon";
import { globe } from "@mattmattmattmatt/base/primitives/icon/icons/globe";
import "@mattmattmattmatt/base/primitives/icon/icon.css";
import { getBrandIcon } from "../utils/brand-icons";
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
      <Stack direction="vertical" gap="4" align="stretch">
        <Text size="sm" color="tertiary">Loading...</Text>
      </Stack>
    );
  }

  const isEmpty = stats.total_tracker_hits === 0;

  return (
    <div className="tracker-stats">
      <Stack direction="horizontal" gap="4" align="center" style={{ flexShrink: 0 }}>
        <Stack direction="vertical" gap="1">
          <Text size="xs" color="tertiary" font="mono">CONNECTIONS</Text>
          <NumberRoll value={stats.total_tracker_hits} minDigits={3} fontSize="var(--text-lg-size)" commas />
        </Stack>
        <Stack direction="vertical" gap="1">
          <Text size="xs" color="tertiary" font="mono">DOMAINS</Text>
          <NumberRoll value={stats.top_domains.length} minDigits={3} fontSize="var(--text-lg-size)" commas />
        </Stack>
      </Stack>

      {isEmpty ? (
        <div className="tracker-stats__empty">
          <span className="tracker-stats__shield-icon">&#128737;</span>
          <Text size="sm" color="tertiary">No trackers detected</Text>
        </div>
      ) : (
        <div className="tracker-stats__list">
          {visibleDomains.map((domain) => {
            const brand = getBrandIcon(domain.domain);
            return (
            <div key={domain.domain} className="tracker-stats__row">
              {brand ? (
                <img src={brand.url} alt="" className="tracker-stats__icon" />
              ) : (
                <span className="tracker-stats__icon tracker-stats__icon--default"><Icon icon={globe} size="xs" /></span>
              )}
              <Stack direction="vertical" gap="1" style={{ flex: 1, overflow: "hidden" }}>
                <Text size="sm" weight="medium" truncate={1} font="mono">
                  {domain.domain}
                </Text>
                {domain.category && (
                  <Text size="xs" color="tertiary">{domain.category}</Text>
                )}
              </Stack>
              <Stack direction="horizontal" gap="3" align="center" style={{ flexShrink: 0 }}>
                <Stack direction="vertical" gap={"0" as any} align="end">
                  <Text size="xs" font="mono">
                    <NumberRoll value={domain.total_hits} minDigits={1} fontSize="var(--text-xs-size)" duration={300} commas />
                    <span style={{ opacity: 0.5, marginLeft: 2 }}>hits</span>
                  </Text>
                </Stack>
                <Text size="xs" color="tertiary" style={{ minWidth: 48, textAlign: "right" }}>
                  {formatLastSeen(domain.last_seen_ms)}
                </Text>
              </Stack>
            </div>
            );
          })}
        </div>
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
