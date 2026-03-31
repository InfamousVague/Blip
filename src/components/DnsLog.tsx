import { useState, useMemo } from "react";
import { StatCard } from "../ui/components/StatCard";
import { DnsRow } from "../ui/components/DnsRow";
import { Pagination } from "../ui/components/Pagination";
import { FrostedCard } from "../ui/glass";
import type { DnsQueryLogEntry, DnsStats } from "../types/connection";
import { getBrandIcon } from "../utils/brand-icons";
import "./DnsLog.css";

interface Props {
  log: DnsQueryLogEntry[];
  stats: DnsStats;
}

const PAGE_SIZE = 30;

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function DnsLog({ log, stats }: Props) {
  const [page, setPage] = useState(1);
  const isEmpty = stats.total_queries === 0;

  const totalPages = Math.max(1, Math.ceil(log.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const visibleLog = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return log.slice(start, start + PAGE_SIZE);
  }, [log, safePage]);

  return (
    <div className="dns-log">
      <StatCard
        stats={[
          { label: "QUERIES", value: stats.total_queries, minDigits: 5 },
          { label: "UNIQUE", value: stats.unique_domains, minDigits: 4 },
          { label: "BLOCKED", value: stats.blocked_count, minDigits: 3 },
        ]}
      />

      <div style={{ paddingLeft: 14, paddingBottom: 8 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--blip-text-tertiary)" }}>
          {stats.recent_rate.toFixed(1)} queries/sec
        </span>
      </div>

      {isEmpty ? (
        <div className="dns-log__empty">
          <span style={{ color: "var(--blip-text-tertiary)", fontSize: 13 }}>
            No DNS queries captured yet. DNS monitoring activates with the network extension.
          </span>
        </div>
      ) : (
        <FrostedCard className="blip-scroll-list">
          {visibleLog.map((entry, i) => {
            const brand = getBrandIcon(entry.domain);
            return (
              <DnsRow
                key={`${entry.domain}-${entry.timestamp_ms}-${i}`}
                domain={entry.domain}
                timestamp={formatTime(entry.timestamp_ms)}
                sourceApp={entry.source_app || undefined}
                responseIps={entry.response_ips}
                isBlocked={entry.is_blocked}
                blockedBy={entry.blocked_by || undefined}
                iconUrl={brand?.url}
              />
            );
          })}
        </FrostedCard>
      )}
      <Pagination
        page={safePage}
        totalPages={totalPages}
        totalItems={log.length}
        onPageChange={setPage}
        size="sm"
      />
    </div>
  );
}
