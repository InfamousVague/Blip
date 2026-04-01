import { useState, useMemo } from "react";
import { SearchBar } from "../ui/components/SearchBar";
import { SegmentedControl } from "../ui/components/SegmentedControl";
import { Pagination } from "../ui/components/Pagination";
import { FrostedCard } from "../ui/glass";
import { FirewallAppRow } from "./FirewallAppRow";
import type { AppWithRule } from "../hooks/useFirewallRules";
import type { ResolvedConnection } from "../types/connection";
import "./FirewallSidebar.css";

type StatusFilter = "all" | "allow" | "deny";

interface Props {
  apps: AppWithRule[];
  onSetRule: (
    appId: string,
    appName: string,
    action: "allow" | "deny" | "unspecified",
    opts?: { domain?: string; port?: number; protocol?: string; lifetime?: string; durationMins?: number },
  ) => void;
  onDeleteRuleById?: (id: string) => void;
  connections?: ResolvedConnection[];
}

const PAGE_SIZE = 15;

function getAppDisplayName(appId: string): string {
  const parts = appId.split(".");
  const last = parts[parts.length - 1] || appId;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

/** Firewall content — renders inside the shared Sidebar wrapper */
export function FirewallContent({ apps, onSetRule, onDeleteRuleById, connections = [] }: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [expandedApp, setExpandedApp] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // Compute bytes per app by matching connections to app bundle IDs.
  // NE sets process_name to the bundle ID; nettop uses the executable name.
  // Build a lookup: for each app, sum bytes from all connections whose
  // process_name matches the app_id, app_name, or display name.
  const { bytesMap, bytesSentMap, bytesRecvMap, maxBytes } = useMemo(() => {
    // First pass: bucket connection bytes by process_name (both total and split)
    const byProcess = new Map<string, { total: number; sent: number; recv: number }>();
    for (const c of connections) {
      if (!c.process_name) continue;
      const key = c.process_name.toLowerCase();
      const existing = byProcess.get(key) || { total: 0, sent: 0, recv: 0 };
      existing.total += c.bytes_sent + c.bytes_received;
      existing.sent += c.bytes_sent;
      existing.recv += c.bytes_received;
      byProcess.set(key, existing);
    }

    // Build a secondary index by last bundle ID segment for fuzzy matching
    // e.g. "chrome" → bytes from "com.google.chrome"
    const byShortName = new Map<string, { total: number; sent: number; recv: number }>();
    for (const [proc, data] of byProcess) {
      const lastSeg = proc.split(".").pop();
      if (lastSeg && lastSeg !== proc) {
        const existing = byShortName.get(lastSeg) || { total: 0, sent: 0, recv: 0 };
        existing.total += data.total;
        existing.sent += data.sent;
        existing.recv += data.recv;
        byShortName.set(lastSeg, existing);
      }
    }

    // Second pass: for each app, find matching bytes
    const result = new Map<string, number>();
    const sentResult = new Map<string, number>();
    const recvResult = new Map<string, number>();
    let max = 0;

    for (const app of apps) {
      const candidates = [
        app.app_id.toLowerCase(),
        app.app_name.toLowerCase(),
        getAppDisplayName(app.app_id).toLowerCase(),
      ];

      let match: { total: number; sent: number; recv: number } | undefined;

      // Try exact match against process names
      for (const key of candidates) {
        match = byProcess.get(key);
        if (match) break;
      }

      // Try short name match (last segment of bundle ID)
      if (!match) {
        const lastSeg = app.app_id.split(".").pop()?.toLowerCase();
        if (lastSeg) {
          match = byProcess.get(lastSeg) || byShortName.get(lastSeg);
          // Also try: process keys that contain any app segment
          if (!match) {
            for (const [proc, procData] of byProcess) {
              const procLast = proc.split(".").pop() || proc;
              if (procLast === lastSeg || lastSeg.includes(procLast) || procLast.includes(lastSeg)) {
                match = procData;
                break;
              }
            }
          }
        }
      }

      const bytes = match?.total ?? 0;
      result.set(app.app_id, bytes);
      sentResult.set(app.app_id, match?.sent ?? 0);
      recvResult.set(app.app_id, match?.recv ?? 0);
      if (bytes > max) max = bytes;
    }
    return { bytesMap: result, bytesSentMap: sentResult, bytesRecvMap: recvResult, maxBytes: max };
  }, [apps, connections]);

  const filtered = useMemo(() => {
    let list = apps.filter((a) => !a.app_id.startsWith("com.infamousvague.blip"));

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) =>
          a.app_id.toLowerCase().includes(q) ||
          a.app_name.toLowerCase().includes(q) ||
          getAppDisplayName(a.app_id).toLowerCase().includes(q)
      );
    }

    if (filter === "allow") {
      list = list.filter((a) => a.action === "allow");
    } else if (filter === "deny") {
      list = list.filter((a) => a.action === "deny");
    }

    // Sort by most recent activity first
    list.sort((a, b) => b.last_seen_ms - a.last_seen_ms);

    return list;
  }, [apps, search, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  return (
    <>
      <SearchBar
        placeholder="Search apps..."
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        onClear={() => { setSearch(""); setPage(1); }}
      />

      <SegmentedControl
        options={[
          { value: "all", label: "All" },
          { value: "allow", label: "Allow" },
          { value: "deny", label: "Deny" },
        ]}
        value={filter}
        onChange={(v) => { setFilter(v as StatusFilter); setPage(1); }}
        size="md"
      />

      <FrostedCard gap={8} className="fw-sidebar__list">
        {visible.length === 0 ? (
          <div className="fw-sidebar__empty">
            <span style={{ color: "var(--blip-text-tertiary)", fontSize: 12 }}>
              {apps.length === 0
                ? "No apps detected yet. Browse the web to discover apps."
                : "No apps match your filter."}
            </span>
          </div>
        ) : (
          visible.map((app) => {
            const name = getAppDisplayName(app.app_id);
            const bytes = bytesMap.get(app.app_id) || 0;
            const bytesSent = bytesSentMap.get(app.app_id) || 0;
            const bytesRecv = bytesRecvMap.get(app.app_id) || 0;
            return (
              <FirewallAppRow
                key={app.app_id}
                app={app}
                displayName={name}
                expanded={expandedApp === app.app_id}
                onToggleExpand={() =>
                  setExpandedApp(expandedApp === app.app_id ? null : app.app_id)
                }
                onSetAction={(action) => onSetRule(app.app_id, app.app_name, action)}
                onAddScopedRule={(action, opts) => onSetRule(app.app_id, app.app_name, action, opts)}
                onDeleteRuleById={onDeleteRuleById}
                bytes={bytes}
                bytesSent={bytesSent}
                bytesReceived={bytesRecv}
              />
            );
          })
        )}
      </FrostedCard>

      <Pagination
        page={safePage}
        totalPages={totalPages}
        totalItems={filtered.length}
        onPageChange={setPage}
        size="sm"
      />
    </>
  );
}
