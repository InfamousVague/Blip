import { useState, useMemo } from "react";
import { Text } from "@mattmattmattmatt/base/primitives/text/Text";
import { Input } from "@mattmattmattmatt/base/primitives/input/Input";
import { Icon } from "@mattmattmattmatt/base/primitives/icon/Icon";
import { shield } from "@mattmattmattmatt/base/primitives/icon/icons/shield";
import { shieldCheck } from "@mattmattmattmatt/base/primitives/icon/icons/shield-check";
import { shieldX } from "@mattmattmattmatt/base/primitives/icon/icons/shield-x";
import { search as searchIcon } from "@mattmattmattmatt/base/primitives/icon/icons/search";
import "@mattmattmattmatt/base/primitives/text/text.css";
import "@mattmattmattmatt/base/primitives/input/input.css";
import "@mattmattmattmatt/base/primitives/icon/icon.css";
import { FirewallAppRow } from "./FirewallAppRow";
import { Pagination } from "@mattmattmattmatt/base/primitives/pagination/Pagination";
import "@mattmattmattmatt/base/primitives/pagination/pagination.css";
import type { AppWithRule } from "../hooks/useFirewallRules";
import type { ResolvedConnection } from "../types/connection";
import "./FirewallSidebar.css";

type StatusFilter = "all" | "allow" | "deny";

interface Props {
  apps: AppWithRule[];
  onSetRule: (appId: string, appName: string, action: "allow" | "deny" | "unspecified") => void;
  connections?: ResolvedConnection[];
}

const PAGE_SIZE = 40;

function getAppDisplayName(appId: string): string {
  const parts = appId.split(".");
  const last = parts[parts.length - 1] || appId;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

/** Firewall content — renders inside the shared Sidebar wrapper */
export function FirewallContent({ apps, onSetRule, connections = [] }: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [expandedApp, setExpandedApp] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // Compute bytes per app by matching connections to app bundle IDs.
  // NE sets process_name to the bundle ID; nettop uses the executable name.
  // Build a lookup: for each app, sum bytes from all connections whose
  // process_name matches the app_id, app_name, or display name.
  const { bytesMap, maxBytes } = useMemo(() => {
    // First pass: bucket connection bytes by process_name
    const byProcess = new Map<string, number>();
    for (const c of connections) {
      if (!c.process_name) continue;
      const total = c.bytes_sent + c.bytes_received;
      const key = c.process_name.toLowerCase();
      byProcess.set(key, (byProcess.get(key) || 0) + total);
    }

    // Second pass: for each app, find matching bytes
    const result = new Map<string, number>();
    let max = 0;
    for (const app of apps) {
      const candidates = [
        app.app_id.toLowerCase(),
        app.app_name.toLowerCase(),
        getAppDisplayName(app.app_id).toLowerCase(),
      ];
      let bytes = 0;
      for (const key of candidates) {
        const found = byProcess.get(key);
        if (found) { bytes = Math.max(bytes, found); break; }
      }
      // Also try matching process_name keys that contain the last segment
      // e.g. process "com.google.Chrome" matches app_id "com.google.Chrome"
      if (bytes === 0) {
        const lastSeg = app.app_id.split(".").pop()?.toLowerCase();
        if (lastSeg) {
          for (const [proc, procBytes] of byProcess) {
            if (proc === lastSeg || proc.endsWith(`.${lastSeg}`)) {
              bytes = procBytes;
              break;
            }
          }
        }
      }
      result.set(app.app_id, bytes);
      if (bytes > max) max = bytes;
    }
    return { bytesMap: result, maxBytes: max };
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
      <div className="sidebar-tabs">
        <button className={`sidebar-tab${filter === "all" ? " sidebar-tab--active" : ""}`} onClick={() => { setFilter("all"); setPage(1); }}>
          <Icon icon={shield} size="xs" />
          All
        </button>
        <button className={`sidebar-tab${filter === "allow" ? " sidebar-tab--active" : ""}`} onClick={() => { setFilter("allow"); setPage(1); }}>
          <Icon icon={shieldCheck} size="xs" />
          Allowed
        </button>
        <button className={`sidebar-tab${filter === "deny" ? " sidebar-tab--active" : ""}`} onClick={() => { setFilter("deny"); setPage(1); }}>
          <Icon icon={shieldX} size="xs" />
          Blocked
        </button>
      </div>

      <div className="fw-sidebar__search">
        <Input
          placeholder="Search apps..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          onClear={() => { setSearch(""); setPage(1); }}
          size="md"
          iconLeft={searchIcon}
          variant="filled"
        />
      </div>

      <div className="fw-sidebar__list">
        {visible.length === 0 ? (
          <div className="fw-sidebar__empty">
            <Text size="xs" color="tertiary">
              {apps.length === 0
                ? "No apps detected yet. Browse the web to discover apps."
                : "No apps match your filter."}
            </Text>
          </div>
        ) : (
          visible.map((app) => {
            const name = getAppDisplayName(app.app_id);
            const bytes = bytesMap.get(app.app_id) || 0;
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
                bytes={bytes}
                maxBytes={maxBytes}
              />
            );
          })
        )}
      </div>

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
