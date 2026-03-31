import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Separator } from "../ui/components/Separator";
import { Button } from "../ui/components/Button";
import { Toggle } from "../ui/components/Toggle";
import { SegmentedControl } from "../ui/components/SegmentedControl";
import { Icon } from "@mattmattmattmatt/base/primitives/icon/Icon";
import { settings as settingsIcon } from "@mattmattmattmatt/base/primitives/icon/icons/settings";
import { shield } from "@mattmattmattmatt/base/primitives/icon/icons/shield";
import { info } from "@mattmattmattmatt/base/primitives/icon/icons/info";
import { x } from "@mattmattmattmatt/base/primitives/icon/icons/x";
import { refreshCw } from "@mattmattmattmatt/base/primitives/icon/icons/refresh-cw";
import "@mattmattmattmatt/base/primitives/icon/icon.css";
import { BlocklistManager } from "./BlocklistManager";
import "./Settings.css";

type SettingsTab = "general" | "blocklists" | "about";

const NAV_ITEMS: { value: SettingsTab; label: string; icon: string }[] = [
  { value: "general", label: "General", icon: settingsIcon },
  { value: "blocklists", label: "Blocklists", icon: shield },
  { value: "about", label: "About", icon: info },
];

interface DiagnosticItem {
  name: string;
  status: "ok" | "warning" | "error";
  detail: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
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

export function Settings({ open, onClose, firewallMode, onFirewallModeChange }: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [autoCapture, setAutoCapture] = useState(true);
  const [showInactive, setShowInactive] = useState(true);
  const [debugLogging, setDebugLogging] = useState(false);
  const [neStatus, setNeStatus] = useState<string>("not_installed");
  const [neLoading, setNeLoading] = useState(false);
  const [neError, setNeError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([]);
  const [diagLoading, setDiagLoading] = useState(false);

  // Load persisted preferences on mount
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const ac = await invoke<string | null>("get_preference", { key: "auto_capture" });
        if (ac !== null) setAutoCapture(ac === "true");
        const si = await invoke<string | null>("get_preference", { key: "show_inactive" });
        if (si !== null) setShowInactive(si === "true");
        const dl = await invoke<string | null>("get_preference", { key: "debug_logging" });
        if (dl !== null) setDebugLogging(dl === "true");
      } catch { /* ignore load errors */ }
    })();
  }, [open]);

  // Persist toggle changes
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
    if (open) {
      refreshDiagnostics();
      refreshNeStatus();
    }
  }, [open, refreshDiagnostics, refreshNeStatus]);

  if (!open) return null;

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span className="blip-text-heading">Settings</span>
          <Button variant="ghost" size="sm" icon={x} iconOnly aria-label="Close" onClick={onClose} />
        </div>
        <div className="settings-layout">
          <nav className="settings-nav">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.value}
                className={`settings-nav__item${activeTab === item.value ? " settings-nav__item--active" : ""}`}
                onClick={() => setActiveTab(item.value)}
              >
                <Icon icon={item.icon} size="sm" />
                {item.label}
              </button>
            ))}
          </nav>

          <div className="settings-content">
            {activeTab === "general" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "stretch" }}>
                <span className="blip-text-heading">General</span>
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
                  <div style={{ display: "flex", gap: "var(--sp-2)" }}>
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
                              if (parsed.status === "error" && parsed.error) {
                                setNeError(parsed.error);
                              }
                            } catch { /* not JSON, ignore */ }
                          }
                          await refreshNeStatus();
                          refreshDiagnostics();
                        } catch (e) {
                          setNeError(String(e));
                          console.error("NE toggle failed:", e);
                        }
                        setNeLoading(false);
                      }}
                    >
                      {neLoading ? "Working..." : neStatus === "active" ? "Disable" : "Enable"}
                    </Button>
                  </div>
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

                <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <span className="blip-text-row-title" style={{ fontWeight: 600 }}>System Status</span>
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
              </div>
            )}

            {activeTab === "blocklists" && <BlocklistManager />}

            {activeTab === "about" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "stretch" }}>
                <span className="blip-text-heading">About Blip</span>
                <Separator />
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <span className="blip-text-empty" style={{ color: "var(--blip-text-secondary)" }}>Version 0.1.0</span>
                  <span className="blip-text-empty" style={{ color: "var(--blip-text-secondary)" }}>A real-time network traffic visualizer.</span>
                  <span className="blip-text-row-desc">Built with Tauri, React, MapLibre GL, and deck.gl</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
