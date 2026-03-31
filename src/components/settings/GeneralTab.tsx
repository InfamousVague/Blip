import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Separator } from "../../ui/components/Separator";
import { Button } from "../../ui/components/Button";
import { Toggle } from "../../ui/components/Toggle";
import { SegmentedControl } from "../../ui/components/SegmentedControl";
import { Icon } from "@mattmattmattmatt/base/primitives/icon/Icon";
import { refreshCw } from "@mattmattmattmatt/base/primitives/icon/icons/refresh-cw";
import "@mattmattmattmatt/base/primitives/icon/icon.css";

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
  const [autoCapture, setAutoCapture] = useState(true);
  const [showInactive, setShowInactive] = useState(true);
  const [debugLogging, setDebugLogging] = useState(false);
  const [neStatus, setNeStatus] = useState<string>("not_installed");
  const [neLoading, setNeLoading] = useState(false);
  const [neError, setNeError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([]);
  const [diagLoading, setDiagLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const ac = await invoke<string | null>("get_preference", { key: "auto_capture" });
        if (ac !== null) setAutoCapture(ac === "true");
        const si = await invoke<string | null>("get_preference", { key: "show_inactive" });
        if (si !== null) setShowInactive(si === "true");
        const dl = await invoke<string | null>("get_preference", { key: "debug_logging" });
        if (dl !== null) setDebugLogging(dl === "true");
      } catch { /* ignore */ }
    })();
  }, []);

  const handleAutoCapture = (v: boolean) => {
    setAutoCapture(v);
    invoke("set_preference", { key: "auto_capture", value: String(v) }).catch(() => {});
  };
  const handleShowInactive = (v: boolean) => {
    setShowInactive(v);
    invoke("set_preference", { key: "show_inactive", value: String(v) }).catch(() => {});
  };
  const handleDebugLogging = (v: boolean) => {
    setDebugLogging(v);
    invoke("set_preference", { key: "debug_logging", value: String(v) }).catch(() => {});
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
          <span className="blip-text-row-title">Auto-start capture</span>
          <span className="blip-text-row-desc">Begin monitoring network traffic when Blip launches</span>
        </div>
        <Toggle checked={autoCapture} onChange={handleAutoCapture} />
      </div>

      <div className="settings-row">
        <div className="settings-row__label">
          <span className="blip-text-row-title">Show inactive connections</span>
          <span className="blip-text-row-desc">Display fading arcs for recently closed connections</span>
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

      <div className="settings-row">
        <div className="settings-row__label">
          <span className="blip-text-row-title">Debug logging</span>
          <span className="blip-text-row-desc">Write detailed logs to /tmp/blip-debug.log</span>
        </div>
        <Toggle checked={debugLogging} onChange={handleDebugLogging} />
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
    </>
  );
}
