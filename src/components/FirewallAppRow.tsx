import { useState } from "react";
import { Text } from "@mattmattmattmatt/base/primitives/text/Text";
import { Button } from "@mattmattmattmatt/base/primitives/button/Button";
import { Input } from "@mattmattmattmatt/base/primitives/input/Input";
import { TriStateToggle } from "@mattmattmattmatt/base/primitives/tri-state-toggle/TriStateToggle";
import { SegmentedControl } from "@mattmattmattmatt/base/primitives/segmented-control/SegmentedControl";
import { Icon } from "@mattmattmattmatt/base/primitives/icon/Icon";
import { Badge } from "@mattmattmattmatt/base/primitives/badge/Badge";
import { plus } from "@mattmattmattmatt/base/primitives/icon/icons/plus";
import { trash2 } from "@mattmattmattmatt/base/primitives/icon/icons/trash-2";
import "@mattmattmattmatt/base/primitives/text/text.css";
import "@mattmattmattmatt/base/primitives/badge/badge.css";
import "@mattmattmattmatt/base/primitives/button/button.css";
import "@mattmattmattmatt/base/primitives/input/input.css";
import "@mattmattmattmatt/base/primitives/tri-state-toggle/tri-state-toggle.css";
import "@mattmattmattmatt/base/primitives/segmented-control/segmented-control.css";
import "@mattmattmattmatt/base/primitives/icon/icon.css";
import type { AppWithRule } from "../hooks/useFirewallRules";
import "./FirewallAppRow.css";

interface Props {
  app: AppWithRule;
  displayName: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onSetAction: (action: "allow" | "deny" | "unspecified") => void;
  onAddScopedRule?: (
    action: "allow" | "deny",
    opts: { domain?: string; port?: number; protocol?: string; lifetime?: string; durationMins?: number },
  ) => void;
  onDeleteRuleById?: (id: string) => void;
  bytes?: number;
  bytesSent?: number;
  bytesReceived?: number;
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

function formatLifetime(lifetime: string, expiresAt: number | null): string {
  if (lifetime === "session") return "Session";
  if (lifetime === "timed" && expiresAt) {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) return "Expired";
    if (remaining < 3_600_000) return `${Math.ceil(remaining / 60_000)}m left`;
    return `${Math.ceil(remaining / 3_600_000)}h left`;
  }
  return "Permanent";
}

const ARROW_UP_SVG = '<path d="M12 19V5M12 5l-5 5M12 5l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
const ARROW_DOWN_SVG = '<path d="M12 5v14M12 19l-5-5M12 19l5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';

const PROTOCOL_OPTIONS = [
  { value: "any", label: "Any" },
  { value: "tcp", label: "TCP" },
  { value: "udp", label: "UDP" },
];

const LIFETIME_OPTIONS = [
  { value: "permanent", label: "Permanent" },
  { value: "session", label: "Session" },
  { value: "timed", label: "1 Hour" },
];

export function FirewallAppRow({ app, displayName, expanded, onToggleExpand, onSetAction, onAddScopedRule, onDeleteRuleById, bytes = 0, bytesSent = 0, bytesReceived = 0, maxBytes = 0 }: Props) {
  const isApple = app.is_apple_signed;
  const [showAddRule, setShowAddRule] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [newPort, setNewPort] = useState("");
  const [newProtocol, setNewProtocol] = useState("any");
  const [newLifetime, setNewLifetime] = useState("permanent");
  const [newAction, setNewAction] = useState<"allow" | "deny">("deny");

  const scopedRules = app.rules.filter(r => r.domain || r.port || r.protocol);

  const handleAddRule = () => {
    if (!onAddScopedRule) return;
    const opts: { domain?: string; port?: number; protocol?: string; lifetime?: string; durationMins?: number } = {};
    if (newDomain.trim()) opts.domain = newDomain.trim();
    if (newPort.trim()) opts.port = parseInt(newPort, 10);
    if (newProtocol !== "any") opts.protocol = newProtocol;
    opts.lifetime = newLifetime;
    if (newLifetime === "timed") opts.durationMins = 60;
    onAddScopedRule(newAction, opts);
    setShowAddRule(false);
    setNewDomain("");
    setNewPort("");
    setNewProtocol("any");
    setNewLifetime("permanent");
    setNewAction("deny");
  };

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
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginTop: 2 }}>
            {bytesSent > 0 && (
              <Badge variant="subtle" size="sm" icon={ARROW_UP_SVG} style={{ color: "#ec4899", background: "rgba(236, 72, 153, 0.12)" }}>
                {formatBytes(bytesSent)}
              </Badge>
            )}
            {bytesReceived > 0 && (
              <Badge variant="subtle" size="sm" icon={ARROW_DOWN_SVG} style={{ color: "#6366f1", background: "rgba(99, 102, 241, 0.12)" }}>
                {formatBytes(bytesReceived)}
              </Badge>
            )}
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
          {bytes > 0 && (
            <>
              <div className="fw-row__detail-row">
                <Text size="xs" color="tertiary">Upload</Text>
                <Text size="xs" font="mono" style={{ color: "#ec4899" }}>{formatBytes(bytesSent)}</Text>
              </div>
              <div className="fw-row__detail-row">
                <Text size="xs" color="tertiary">Download</Text>
                <Text size="xs" font="mono" style={{ color: "#6366f1" }}>{formatBytes(bytesReceived)}</Text>
              </div>
            </>
          )}
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

          {/* Scoped rules */}
          {scopedRules.length > 0 && (
            <div className="fw-row__rules-section">
              <Text size="xs" weight="semibold" color="secondary" style={{ marginTop: "var(--sp-2)" }}>
                Rules ({scopedRules.length})
              </Text>
              {scopedRules.map((rule) => (
                <div key={rule.id} className="fw-row__rule-item">
                  <div className="fw-row__rule-info">
                    <Text size="xs" font="mono" truncate={1}>
                      {rule.domain || "*"}:{rule.port || "*"} {rule.protocol || "any"}
                    </Text>
                    <Text size="xs" color="tertiary">
                      {rule.action === "allow" ? "Allow" : "Block"} · {formatLifetime(rule.lifetime, rule.expires_at)}
                    </Text>
                  </div>
                  {onDeleteRuleById && (
                    <button
                      className="fw-row__rule-delete"
                      onClick={() => onDeleteRuleById(rule.id)}
                      aria-label="Delete rule"
                    >
                      <Icon icon={trash2} size="xs" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Add rule button / form */}
          {!showAddRule ? (
            <button
              className="fw-row__add-rule-btn"
              onClick={() => setShowAddRule(true)}
            >
              <Icon icon={plus} size="xs" />
              <Text size="xs" color="secondary">Add rule</Text>
            </button>
          ) : (
            <div className="fw-row__add-rule-form">
              <Input
                placeholder="Domain (optional)"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                size="sm"
                variant="filled"
              />
              <Input
                placeholder="Port (optional)"
                value={newPort}
                onChange={(e) => setNewPort(e.target.value.replace(/\D/g, ""))}
                size="sm"
                variant="filled"
              />
              <SegmentedControl
                options={PROTOCOL_OPTIONS}
                value={newProtocol}
                onChange={setNewProtocol}
                size="sm"
              />
              <SegmentedControl
                options={LIFETIME_OPTIONS}
                value={newLifetime}
                onChange={setNewLifetime}
                size="sm"
              />
              <div className="fw-row__add-rule-actions">
                <TriStateToggle
                  value={newAction}
                  onChange={(v) => { if (v === "allow" || v === "deny") setNewAction(v); }}
                  size="sm"
                />
                <Button variant="secondary" size="sm" onClick={handleAddRule}>
                  Save
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowAddRule(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
