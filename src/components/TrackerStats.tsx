import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Stack } from "@mattmattmattmatt/base/primitives/stack/Stack";
import { Text } from "@mattmattmattmatt/base/primitives/text/Text";
import { NumberRoll } from "@mattmattmattmatt/base/primitives/number-roll/NumberRoll";
import "@mattmattmattmatt/base/primitives/number-roll/number-roll.css";
import "@mattmattmattmatt/base/primitives/stack/stack.css";
import "@mattmattmattmatt/base/primitives/text/text.css";
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[Math.min(i, sizes.length - 1)]}`;
}

function formatLastSeen(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function TrackerStats({ visible }: Props) {
  const [stats, setStats] = useState<TrackerStats | null>(null);

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

  if (!stats) {
    return (
      <Stack direction="vertical" gap="4" align="stretch">
        <Text size="sm" color="tertiary">Loading...</Text>
      </Stack>
    );
  }

  const isEmpty = stats.total_tracker_hits === 0;

  return (
    <Stack direction="vertical" gap="4" align="stretch">
      <Stack direction="horizontal" gap="4" align="center">
        <Stack direction="vertical" gap="1">
          <Text size="xs" color="tertiary" font="mono">HITS</Text>
          <NumberRoll value={stats.total_tracker_hits} minDigits={3} fontSize="var(--text-2xl-size)" commas />
        </Stack>
        <Stack direction="vertical" gap="1">
          <Text size="xs" color="tertiary" font="mono">BYTES</Text>
          <Text size="2xl" weight="semibold">{formatBytes(stats.total_bytes_blocked)}</Text>
        </Stack>
      </Stack>

      {isEmpty ? (
        <div className="tracker-stats__empty">
          <span className="tracker-stats__shield-icon">&#128737;</span>
          <Text size="sm" color="tertiary">No trackers detected</Text>
        </div>
      ) : (
        <div className="tracker-stats__list">
          {stats.top_domains.slice(0, 20).map((domain) => (
            <div key={domain.domain} className="tracker-stats__row">
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
                  </Text>
                  <Text size="xs" color="tertiary">{formatBytes(domain.total_bytes)}</Text>
                </Stack>
                <Text size="xs" color="tertiary" style={{ minWidth: 48, textAlign: "right" }}>
                  {formatLastSeen(domain.last_seen_ms)}
                </Text>
              </Stack>
            </div>
          ))}
        </div>
      )}
    </Stack>
  );
}
