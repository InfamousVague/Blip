import { Text } from "@mattmattmattmatt/base/primitives/text/Text";
import { TriStateToggle } from "@mattmattmattmatt/base/primitives/tri-state-toggle/TriStateToggle";
import "@mattmattmattmatt/base/primitives/text/text.css";
import "@mattmattmattmatt/base/primitives/tri-state-toggle/tri-state-toggle.css";
import type { AppWithRule } from "../hooks/useFirewallRules";
import "./FirewallAppRow.css";

interface Props {
  app: AppWithRule;
  displayName: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onSetAction: (action: "allow" | "deny" | "unspecified") => void;
  bytes?: number;
  maxBytes?: number;
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[Math.min(i, sizes.length - 1)]}`;
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

export function FirewallAppRow({ app, displayName, expanded, onToggleExpand, onSetAction, bytes = 0, maxBytes = 0 }: Props) {
  const isApple = app.is_apple_signed;
  const barPct = maxBytes > 0 ? (bytes / maxBytes) * 100 : 0;
  const barColor = app.action === "deny" ? "rgba(255, 50, 50, 0.5)" : "rgba(140, 120, 255, 0.35)";

  return (
    <div className={`fw-row${expanded ? " fw-row--expanded" : ""}`}>
      <div className="fw-row__main" onClick={onToggleExpand}>
        <div className="fw-row__icon">
          {app.iconUrl ? (
            <img src={app.iconUrl} alt="" className="fw-row__app-img" />
          ) : isApple ? (
            <span className="fw-row__apple-badge" title="Apple-signed process">
              <svg width="16" height="16" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                <path d="M9.2 6.3c0-1.5 1.2-2.2 1.3-2.3-.7-1-1.8-1.2-2.2-1.2-1-.1-1.9.6-2.4.6s-1.2-.5-2-.5C2.6 2.9 1.3 4 1.3 6.4c0 1.4.5 2.9 1.2 3.9.5.8 1.2 1.7 2 1.7s1.1-.5 2-.5 1.2.5 2 .5 1.4-.8 1.9-1.6c.6-.9.9-1.7.9-1.8 0 0-1.6-.7-1.6-2.3h-.5zM7.8 2c.4-.5.7-1.3.6-2-.6 0-1.3.4-1.8 1-.4.4-.7 1.2-.6 1.9.6 0 1.3-.4 1.8-.9z"/>
              </svg>
            </span>
          ) : (
            <span className="fw-row__app-icon">{displayName.charAt(0)}</span>
          )}
        </div>
        <div className="fw-row__info">
          <Text size="sm" weight="medium" truncate={1}>
            {displayName}
          </Text>
          <div className="fw-row__bar-row">
            <div className="fw-row__bar-track">
              <div
                className="fw-row__bar-fill"
                style={{ width: `${barPct}%`, background: barColor }}
              />
            </div>
            <Text size="xs" color="tertiary" font="mono" className="fw-row__bar-label">
              {bytes > 0 ? formatBytes(bytes) : "—"}
            </Text>
          </div>
        </div>
        <div className="fw-row__meta">
          <Text size="xs" color="tertiary" font="mono">
            {formatCount(app.total_connections)}
          </Text>
        </div>
        <div className="fw-row__toggle" onClick={(e) => e.stopPropagation()}>
          <TriStateToggle value={app.action} onChange={onSetAction} size="md" />
        </div>
      </div>

      {expanded && (
        <div className="fw-row__detail">
          <div className="fw-row__detail-row">
            <Text size="xs" color="tertiary">Bundle ID</Text>
            <Text size="xs" font="mono" truncate={1}>{app.app_id}</Text>
          </div>
          <div className="fw-row__detail-row">
            <Text size="xs" color="tertiary">Connections</Text>
            <Text size="xs" font="mono">{app.total_connections}</Text>
          </div>
          <div className="fw-row__detail-row">
            <Text size="xs" color="tertiary">Data usage</Text>
            <Text size="xs" font="mono">{bytes > 0 ? formatBytes(bytes) : "—"}</Text>
          </div>
          <div className="fw-row__detail-row">
            <Text size="xs" color="tertiary">First seen</Text>
            <Text size="xs" font="mono">{new Date(app.first_seen_ms).toLocaleDateString()}</Text>
          </div>
          <div className="fw-row__detail-row">
            <Text size="xs" color="tertiary">Last seen</Text>
            <Text size="xs" font="mono">{timeAgo(app.last_seen_ms)} ago</Text>
          </div>
          {app.is_apple_signed && (
            <div className="fw-row__detail-row">
              <Text size="xs" color="tertiary">Signed by</Text>
              <Text size="xs" font="mono">Apple</Text>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
