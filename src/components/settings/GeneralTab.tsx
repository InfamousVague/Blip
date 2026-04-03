import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Separator } from "../../ui/components/Separator";
import { Button } from "../../ui/components/Button";
import { Toggle } from "../../ui/components/Toggle";
import { SegmentedControl } from "../../ui/components/SegmentedControl";
import { refreshCw } from "@mattmattmattmatt/base/primitives/icon/icons/refresh-cw";

interface DiagnosticItem {
  name: string;
  status: "ok" | "warning" | "error";
  detail: string;
}

interface Props {
  firewallMode: string;
  onFirewallModeChange: (mode: string) => void;
}

const FIREWALL_MODES = [
  { value: "silent_allow", label: "Silent Allow" },
  { value: "alert", label: "Alert" },
  { value: "silent_deny", label: "Silent Deny" },
];

const FIREWALL_MODE_DESCRIPTIONS: Record<string, string> = {
  silent_allow: "New apps are allowed automatically. Review connections later.",
  alert: "Prompt when an unknown app connects for the first time.",
  silent_deny: "Block all connections from unknown apps by default.",
};

export function GeneralTab({ firewallMode, onFirewallModeChange }: Props) {
  const [showInactive, setShowInactive] = useState(true);
  const [neStatus, setNeStatus] = useState<string>("not_installed");
  const [neLoading, setNeLoading] = useState(false);
  const [neError, setNeError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([]);
  const [diagLoading, setDiagLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const si = await invoke<string | null>("get_preference", { key: "show_inactive" });
        if (si !== null) setShowInactive(si === "true");
      } catch { /* ignore */ }
    })();
  }, []);

  const handleShowInactive = (v: boolean) => {
    setShowInactive(v);
    invoke("set_preference", { key: "show_inactive", value: String(v) }).catch(() => {});
  };

  const refreshDiagnostics = useCallback(async () => {
    setDiagLoading(true);
    try {
      const items = await invoke<DiagnosticItem[]>("get_diagnostics");
      setDiagnostics(items);
    } catch (e) {
      console.error("Failed to get diagnostics:", e);
    }
    setDiagLoading(false);
  }, []);

  const refreshNeStatus = useCallback(async () => {
    try {
      const result = await invoke<string>("get_network_extension_status");
      const parsed = JSON.parse(result);
      setNeStatus(parsed.status || "unavailable");
    } catch {
      setNeStatus("unavailable");
    }
  }, []);

  useEffect(() => {
    refreshDiagnostics();
    refreshNeStatus();
  }, [refreshDiagnostics, refreshNeStatus]);

  return (
    <>
      <span className="settings-section-title">General</span>
      <Separator />

      <div className="settings-row">
        <div className="settings-row__label">
          <span className="blip-text-row-title">Show inactive connections</span>
          <span className="blip-text-row-desc">Display fading arcs for recently closed connections in the sidebar</span>
        </div>
        <Toggle checked={showInactive} onChange={handleShowInactive} />
      </div>

      <div className="settings-row">
        <div className="settings-row__label">
          <span className="blip-text-row-title">
            Network Extension
            <span
              className="diagnostics-dot"
              style={{
                display: "inline-block",
                background: neStatus === "active" ? "var(--blip-success)"
                  : neStatus === "pending_approval" ? "var(--blip-warning)"
                  : "var(--blip-text-tertiary)",
                marginLeft: "var(--sp-2)",
                verticalAlign: "middle",
              }}
            />
          </span>
          <span className="blip-text-row-desc">
            {neStatus === "active"
              ? "Active \u2014 capturing all connections in real-time"
              : neStatus === "pending_approval"
              ? "Pending \u2014 approve in System Settings \u2192 Privacy & Security"
              : "Enable to capture all connections system-wide without elevated access"}
          </span>
          {neError && (
            <span className="blip-text-row-desc" style={{ color: "var(--blip-error)", marginTop: "var(--sp-1)" }}>
              {neError}
            </span>
          )}
        </div>
        <Button
          variant={neStatus === "active" ? "ghost" : "secondary"}
          size="sm"
          disabled={neLoading}
          onClick={async () => {
            setNeLoading(true);
            setNeError(null);
            try {
              if (neStatus === "active") {
                await invoke("deactivate_network_extension");
              } else {
                const result = await invoke<string>("activate_network_extension");
                try {
                  const parsed = JSON.parse(result);
                  if (parsed.status === "error" && parsed.error) setNeError(parsed.error);
                } catch { /* not JSON */ }
              }
              await refreshNeStatus();
              refreshDiagnostics();
            } catch (e) {
              setNeError(String(e));
            }
            setNeLoading(false);
          }}
        >
          {neLoading ? "Working..." : neStatus === "active" ? "Disable" : "Enable"}
        </Button>
      </div>


      <Separator />

      <div className="settings-row" style={{ flexDirection: "column", alignItems: "stretch", gap: "var(--sp-2)" }}>
        <div className="settings-row__label">
          <span className="blip-text-row-title">Firewall Mode</span>
          <span className="blip-text-row-desc">
            {FIREWALL_MODE_DESCRIPTIONS[firewallMode] || FIREWALL_MODE_DESCRIPTIONS.silent_allow}
          </span>
        </div>
        <SegmentedControl
          options={FIREWALL_MODES}
          value={firewallMode}
          onChange={onFirewallModeChange}
          size="sm"
          style={{ width: "100%" }}
        />
      </div>

      <Separator />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="settings-group-title">System Status</span>
        <Button
          variant="ghost"
          size="sm"
          icon={refreshCw}
          iconOnly
          aria-label="Refresh diagnostics"
          onClick={refreshDiagnostics}
          disabled={diagLoading}
        />
      </div>

      <div className="diagnostics-grid">
        {diagnostics.map((item) => (
          <div key={item.name} className="diagnostics-item">
            <div className="diagnostics-item__header">
              <span
                className="diagnostics-dot"
                style={{
                  background:
                    item.status === "ok" ? "var(--blip-success)"
                    : item.status === "warning" ? "var(--blip-warning)"
                    : "var(--blip-error)",
                }}
              />
              <span className="blip-text-label" style={{ fontWeight: 500, color: "var(--blip-text-primary)" }}>{item.name}</span>
            </div>
            <span className="blip-text-row-desc">{item.detail}</span>
          </div>
        ))}
        {diagnostics.length === 0 && !diagLoading && (
          <span className="blip-text-row-desc">No diagnostics available</span>
        )}
        {diagLoading && (
          <span className="blip-text-row-desc">Checking systems...</span>
        )}
      </div>

      <Separator />

      {/* NE Live Status */}
      <NEStatusPanel />
    </>
  );
}

// --- NE Status Panel ---

interface NELiveStatus {
  connected: boolean;
  ne_version: string;
  ne_build: string;
  mode: string;
  flow_count: number;
  blocked_count: number;
  uptime_ms: number;
  rule_count: number;
  dns_blocked_count: number;
  dns_cache_size: number;
  last_heartbeat_ms: number;
  errors: { category: string; message: string; severity: string; timestamp_ms: number }[];
}

function formatUptime(ms: number): string {
  if (ms === 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function NEStatusPanel() {
  const [status, setStatus] = useState<NELiveStatus | null>(null);
  const [expectedVersion, setExpectedVersion] = useState<string>("");
  const [showErrors, setShowErrors] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await invoke<NELiveStatus>("get_ne_live_status");
      setStatus(s);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    invoke<string>("get_expected_ne_version").then(setExpectedVersion).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const isStale = status ? Date.now() - status.last_heartbeat_ms > 30_000 : true;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="settings-group-title">Network Extension</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            className="diagnostics-dot"
            style={{
              background: !status || !status.connected || isStale
                ? "var(--blip-error)"
                : "var(--blip-success)",
            }}
          />
          <span className="blip-text-row-desc">
            {!status ? "Unknown" : !status.connected ? "Disconnected" : isStale ? "No heartbeat" : "Connected"}
          </span>
        </div>
      </div>

      {status && status.connected && (
        <div className="diagnostics-grid">
          <div className="diagnostics-item">
            <span className="blip-text-label" style={{ fontWeight: 500, color: "var(--blip-text-primary)" }}>Version</span>
            <span className="blip-text-row-desc" style={
              expectedVersion && status.ne_version !== expectedVersion && status.ne_version !== "?"
                ? { color: "var(--blip-warning)" }
                : undefined
            }>
              v{status.ne_version} (build {status.ne_build})
              {expectedVersion && status.ne_version !== expectedVersion && status.ne_version !== "?" && (
                <> — expected v{expectedVersion}</>
              )}
            </span>
          </div>
          <div className="diagnostics-item">
            <span className="blip-text-label" style={{ fontWeight: 500, color: "var(--blip-text-primary)" }}>Uptime</span>
            <span className="blip-text-row-desc">{formatUptime(status.uptime_ms)}</span>
          </div>
          <div className="diagnostics-item">
            <span className="blip-text-label" style={{ fontWeight: 500, color: "var(--blip-text-primary)" }}>Flows</span>
            <span className="blip-text-row-desc">{status.flow_count.toLocaleString()} total</span>
          </div>
          <div className="diagnostics-item">
            <span className="blip-text-label" style={{ fontWeight: 500, color: "var(--blip-text-primary)" }}>Blocked</span>
            <span className="blip-text-row-desc">{status.blocked_count.toLocaleString()} connections</span>
          </div>
          <div className="diagnostics-item">
            <span className="blip-text-label" style={{ fontWeight: 500, color: "var(--blip-text-primary)" }}>Rules</span>
            <span className="blip-text-row-desc">{status.rule_count} compiled</span>
          </div>
          <div className="diagnostics-item">
            <span className="blip-text-label" style={{ fontWeight: 500, color: "var(--blip-text-primary)" }}>Mode</span>
            <span className="blip-text-row-desc">{status.mode}</span>
          </div>
          <div className="diagnostics-item">
            <span className="blip-text-label" style={{ fontWeight: 500, color: "var(--blip-text-primary)" }}>DNS Cache</span>
            <span className="blip-text-row-desc">{status.dns_cache_size.toLocaleString()} entries</span>
          </div>
          <div className="diagnostics-item">
            <span className="blip-text-label" style={{ fontWeight: 500, color: "var(--blip-text-primary)" }}>DNS Blocked</span>
            <span className="blip-text-row-desc">{status.dns_blocked_count.toLocaleString()} IPs</span>
          </div>
        </div>
      )}

      {status && status.errors.length > 0 && (
        <>
          <button
            onClick={() => setShowErrors(!showErrors)}
            style={{
              background: "none", border: "none", cursor: "pointer", padding: 0,
              fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 500,
              color: "var(--blip-error)", opacity: 0.8,
            }}
          >
            {showErrors ? "Hide" : "Show"} errors ({status.errors.length})
          </button>
          {showErrors && status.errors.slice(-10).reverse().map((err, i) => (
            <div key={i} style={{
              padding: "4px 8px", borderRadius: 6, fontSize: 11,
              background: "rgba(239, 68, 68, 0.08)",
              color: "var(--blip-text-secondary)",
              fontFamily: "var(--font-mono)",
            }}>
              [{err.category}] {err.message}
            </div>
          ))}
        </>
      )}
    </>
  );
}
