import { useState } from "react";
import { Badge } from "../ui/components/Badge";
import { Button } from "../ui/components/Button";
import { DetailRow } from "../ui/components/DetailRow";
import { TriStateToggle } from "../ui/components/TriStateToggle";
import { SegmentedControl } from "../ui/components/SegmentedControl";
import { Icon } from "@mattmattmattmatt/base/primitives/icon/Icon";
import { plus } from "@mattmattmattmatt/base/primitives/icon/icons/plus";
import { trash2 } from "@mattmattmattmatt/base/primitives/icon/icons/trash-2";
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

export function FirewallAppRow({ app, displayName, expanded, onToggleExpand, onSetAction, onAddScopedRule, onDeleteRuleById, bytes = 0, bytesSent = 0, bytesReceived = 0 }: Props) {
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
          <span className="blip-text-row-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {displayName}
          </span>
          <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 2 }}>
            <Badge variant="subtle" size="sm" icon={ARROW_UP_SVG} style={{ color: "#ec4899", background: "rgba(236, 72, 153, 0.12)" }}>
              {bytesSent > 0 ? formatBytes(bytesSent) : "\u2014"}
            </Badge>
            <Badge variant="subtle" size="sm" icon={ARROW_DOWN_SVG} style={{ color: "#6366f1", background: "rgba(99, 102, 241, 0.12)" }}>
              {bytesReceived > 0 ? formatBytes(bytesReceived) : "\u2014"}
            </Badge>
          </div>
        </div>
        <div className="fw-row__toggle" onClick={(e) => e.stopPropagation()}>
          <TriStateToggle value={app.action} onChange={onSetAction} size="sm" />
        </div>
      </div>

      {expanded && (
        <div className="fw-row__detail">
          <DetailRow label="Bundle ID" value={app.app_id} mono />
          <DetailRow label="Connections" value={app.total_connections} mono />
          <DetailRow label="Data usage" value={bytes > 0 ? formatBytes(bytes) : "\u2014"} mono />
          {bytes > 0 && (
            <>
              <DetailRow label="Upload" value={formatBytes(bytesSent)} mono color="#ec4899" />
              <DetailRow label="Download" value={formatBytes(bytesReceived)} mono color="#6366f1" />
            </>
          )}
          <DetailRow label="First seen" value={new Date(app.first_seen_ms).toLocaleDateString()} mono />
          <DetailRow label="Last seen" value={`${timeAgo(app.last_seen_ms)} ago`} mono />
          {app.is_apple_signed && (
            <DetailRow label="Signed by" value="Apple" mono />
          )}

          {/* Scoped rules */}
          {scopedRules.length > 0 && (
            <div className="fw-row__rules-section">
              <span className="blip-text-label" style={{ fontWeight: 600, color: "var(--blip-text-secondary)", marginTop: "var(--sp-2)" }}>
                Rules ({scopedRules.length})
              </span>
              {scopedRules.map((rule) => (
                <div key={rule.id} className="fw-row__rule-item">
                  <div className="fw-row__rule-info">
                    <span className="blip-text-label" style={{ fontFamily: "var(--font-mono)", color: "var(--blip-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {rule.domain || "*"}:{rule.port || "*"} {rule.protocol || "any"}
                    </span>
                    <span className="blip-text-label">
                      {rule.action === "allow" ? "Allow" : "Block"} · {formatLifetime(rule.lifetime, rule.expires_at)}
                    </span>
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
              <span className="blip-text-label" style={{ color: "var(--blip-text-secondary)" }}>Add rule</span>
            </button>
          ) : (
            <div className="fw-row__add-rule-form">
              <input
                placeholder="Domain (optional)"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                className="fw-row__input"
              />
              <input
                placeholder="Port (optional)"
                value={newPort}
                onChange={(e) => setNewPort(e.target.value.replace(/\D/g, ""))}
                className="fw-row__input"
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
