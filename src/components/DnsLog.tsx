import { Stack } from "@mattmattmattmatt/base/primitives/stack/Stack";
import { Text } from "@mattmattmattmatt/base/primitives/text/Text";
import { NumberRoll } from "@mattmattmattmatt/base/primitives/number-roll/NumberRoll";
import "@mattmattmattmatt/base/primitives/stack/stack.css";
import "@mattmattmattmatt/base/primitives/text/text.css";
import "@mattmattmattmatt/base/primitives/number-roll/number-roll.css";
import type { DnsQueryLogEntry, DnsStats } from "../types/connection";
import "./DnsLog.css";

interface Props {
  log: DnsQueryLogEntry[];
  stats: DnsStats;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function DnsLog({ log, stats }: Props) {
  const isEmpty = stats.total_queries === 0;

  return (
    <Stack direction="vertical" gap="4" align="stretch">
      <Stack direction="horizontal" gap="4" align="center">
        <Stack direction="vertical" gap="1">
          <Text size="xs" color="tertiary" font="mono">QUERIES</Text>
          <NumberRoll value={stats.total_queries} minDigits={3} fontSize="var(--text-2xl-size)" commas />
        </Stack>
        <Stack direction="vertical" gap="1">
          <Text size="xs" color="tertiary" font="mono">UNIQUE</Text>
          <NumberRoll value={stats.unique_domains} minDigits={3} fontSize="var(--text-2xl-size)" commas />
        </Stack>
        <Stack direction="vertical" gap="1">
          <Text size="xs" color="tertiary" font="mono">BLOCKED</Text>
          <NumberRoll value={stats.blocked_count} minDigits={1} fontSize="var(--text-2xl-size)" commas />
        </Stack>
      </Stack>

      <Text size="xs" color="tertiary" font="mono">
        {stats.recent_rate.toFixed(1)} queries/sec
      </Text>

      {isEmpty ? (
        <div className="dns-log__empty">
          <Text size="sm" color="tertiary">
            No DNS queries captured yet. Requires elevated access.
          </Text>
        </div>
      ) : (
        <div className="dns-log__list">
          {log.map((entry, i) => (
            <div
              key={`${entry.domain}-${entry.timestamp_ms}-${i}`}
              className={`dns-log__row${entry.is_blocked ? " dns-log__row--blocked" : ""}`}
            >
              <div className="dns-log__row-main">
                <Text
                  size="sm"
                  weight={entry.is_blocked ? "semibold" : "regular"}
                  font="mono"
                  truncate={1}
                  style={entry.is_blocked ? { color: "var(--color-danger)" } : undefined}
                >
                  {entry.domain}
                </Text>
                <Text size="xs" color="tertiary" style={{ flexShrink: 0 }}>
                  {formatTime(entry.timestamp_ms)}
                </Text>
              </div>
              {entry.response_ips.length > 0 && (
                <Text size="xs" color="tertiary" font="mono" truncate={1}>
                  {entry.response_ips.slice(0, 3).join(", ")}
                  {entry.response_ips.length > 3 ? ` +${entry.response_ips.length - 3}` : ""}
                </Text>
              )}
              <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
                {entry.source_app && (
                  <Text size="xs" color="tertiary" font="mono" truncate={1} style={{ opacity: 0.6 }}>
                    {entry.source_app}
                  </Text>
                )}
                {entry.is_blocked && entry.blocked_by && (
                  <Text size="xs" style={{ color: "var(--color-danger)", opacity: 0.7 }}>
                    Blocked by {entry.blocked_by}
                  </Text>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Stack>
  );
}
