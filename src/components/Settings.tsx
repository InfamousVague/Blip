import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Stack } from "@mattmattmattmatt/base/primitives/stack/Stack";
import { Text } from "@mattmattmattmatt/base/primitives/text/Text";
import { Toggle } from "@mattmattmattmatt/base/primitives/toggle/Toggle";
import { Separator } from "@mattmattmattmatt/base/primitives/separator/Separator";
import { Icon } from "@mattmattmattmatt/base/primitives/icon/Icon";
import { Button } from "@mattmattmattmatt/base/primitives/button/Button";
import { settings as settingsIcon } from "@mattmattmattmatt/base/primitives/icon/icons/settings";
import { shield } from "@mattmattmattmatt/base/primitives/icon/icons/shield";
import { palette } from "@mattmattmattmatt/base/primitives/icon/icons/palette";
import { info } from "@mattmattmattmatt/base/primitives/icon/icons/info";
import { x } from "@mattmattmattmatt/base/primitives/icon/icons/x";
import { refreshCw } from "@mattmattmattmatt/base/primitives/icon/icons/refresh-cw";
import { SegmentedControl } from "@mattmattmattmatt/base/primitives/segmented-control/SegmentedControl";
import "@mattmattmattmatt/base/primitives/button/button.css";
import "@mattmattmattmatt/base/primitives/stack/stack.css";
import "@mattmattmattmatt/base/primitives/text/text.css";
import "@mattmattmattmatt/base/primitives/toggle/toggle.css";
import "@mattmattmattmatt/base/primitives/separator/separator.css";
import "@mattmattmattmatt/base/primitives/icon/icon.css";
import "@mattmattmattmatt/base/primitives/segmented-control/segmented-control.css";
import { BlocklistManager } from "./BlocklistManager";
import { themes } from "../map-themes";
import "./Settings.css";

type SettingsTab = "general" | "blocklists" | "appearance" | "about";

const NAV_ITEMS: { value: SettingsTab; label: string; icon: string }[] = [
  { value: "general", label: "General", icon: settingsIcon },
  { value: "blocklists", label: "Blocklists", icon: shield },
  { value: "appearance", label: "Appearance", icon: palette },
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
  themeIndex: number;
  onThemeChange: (index: number) => void;
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

export function Settings({ open, onClose, themeIndex, onThemeChange, firewallMode, onFirewallModeChange }: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [autoCapture, setAutoCapture] = useState(true);
  const [showInactive, setShowInactive] = useState(true);
  const [debugLogging, setDebugLogging] = useState(false);
  const [neStatus, setNeStatus] = useState<string>("not_installed");
  const [neLoading, setNeLoading] = useState(false);
  const [neError, setNeError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([]);
  const [diagLoading, setDiagLoading] = useState(false);

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
          <Text size="lg" weight="semibold">Settings</Text>
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
              <Stack direction="vertical" gap="4" align="stretch">
                <Text size="lg" weight="semibold">General</Text>
                <Separator />

                <div className="settings-row">
                  <div className="settings-row__label">
                    <Text size="sm" weight="medium">Auto-start capture</Text>
                    <Text size="xs" color="tertiary">Begin monitoring network traffic when Blip launches</Text>
                  </div>
                  <Toggle checked={autoCapture} onChange={(e) => setAutoCapture(e.target.checked)} />
                </div>

                <div className="settings-row">
                  <div className="settings-row__label">
                    <Text size="sm" weight="medium">Show inactive connections</Text>
                    <Text size="xs" color="tertiary">Display fading arcs for recently closed connections</Text>
                  </div>
                  <Toggle checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                </div>

                <div className="settings-row">
                  <div className="settings-row__label">
                    <Text size="sm" weight="medium">
                      Network Extension
                      <span style={{
                        display: "inline-block",
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: neStatus === "active" ? "var(--color-success)"
                          : neStatus === "pending_approval" ? "var(--color-warning)"
                          : "var(--color-text-tertiary)",
                        marginLeft: "var(--sp-2)",
                        verticalAlign: "middle",
                      }} />
                    </Text>
                    <Text size="xs" color="tertiary">
                      {neStatus === "active"
                        ? "Active — capturing all connections in real-time"
                        : neStatus === "pending_approval"
                        ? "Pending — approve in System Settings → Privacy & Security"
                        : "Enable to capture all connections system-wide without elevated access"}
                    </Text>
                    {neError && (
                      <Text size="xs" style={{ color: "var(--color-danger)", marginTop: "var(--sp-1)" }}>
                        {neError}
                      </Text>
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
                    <Text size="sm" weight="medium">Debug logging</Text>
                    <Text size="xs" color="tertiary">Write detailed logs to /tmp/blip-debug.log</Text>
                  </div>
                  <Toggle checked={debugLogging} onChange={(e) => setDebugLogging(e.target.checked)} />
                </div>

                <Separator />

                <div className="settings-row" style={{ flexDirection: "column", alignItems: "stretch", gap: "var(--sp-2)" }}>
                  <div className="settings-row__label">
                    <Text size="sm" weight="medium">Firewall Mode</Text>
                    <Text size="xs" color="tertiary">
                      {FIREWALL_MODE_DESCRIPTIONS[firewallMode] || FIREWALL_MODE_DESCRIPTIONS.silent_allow}
                    </Text>
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

                <Stack direction="horizontal" align="center" justify="between">
                  <Text size="sm" weight="semibold">System Status</Text>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={refreshCw}
                    iconOnly
                    aria-label="Refresh diagnostics"
                    onClick={refreshDiagnostics}
                    disabled={diagLoading}
                  />
                </Stack>

                <div className="diagnostics-grid">
                  {diagnostics.map((item) => (
                    <div key={item.name} className="diagnostics-item">
                      <div className="diagnostics-item__header">
                        <span
                          className="diagnostics-dot"
                          style={{
                            background:
                              item.status === "ok" ? "var(--color-success)"
                              : item.status === "warning" ? "var(--color-warning)"
                              : "var(--color-error)",
                          }}
                        />
                        <Text size="xs" weight="medium">{item.name}</Text>
                      </div>
                      <Text size="xs" color="tertiary">{item.detail}</Text>
                    </div>
                  ))}
                  {diagnostics.length === 0 && !diagLoading && (
                    <Text size="xs" color="tertiary">No diagnostics available</Text>
                  )}
                  {diagLoading && (
                    <Text size="xs" color="tertiary">Checking systems...</Text>
                  )}
                </div>
              </Stack>
            )}

            {activeTab === "blocklists" && <BlocklistManager />}

            {activeTab === "appearance" && (
              <Stack direction="vertical" gap="4" align="stretch">
                <Text size="lg" weight="semibold">Appearance</Text>
                <Separator />
                <Text size="sm" weight="medium">Map Theme</Text>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--sp-2)" }}>
                  {themes.map((t, i) => (
                    <button
                      key={t.name}
                      onClick={() => onThemeChange(i)}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "var(--sp-1)",
                        padding: "var(--sp-2)",
                        background: i === themeIndex ? "rgba(255,255,255,0.08)" : "transparent",
                        border: i === themeIndex ? "1px solid rgba(255,255,255,0.2)" : "1px solid transparent",
                        borderRadius: "var(--radius-md)",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div style={{
                        width: "100%",
                        height: 32,
                        borderRadius: "var(--radius-sm)",
                        background: t.bg,
                        border: "1px solid " + t.boundary,
                        position: "relative",
                        overflow: "hidden",
                      }}>
                        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "40%", background: t.water }} />
                        <div style={{ position: "absolute", top: 4, left: 4, width: 4, height: 4, borderRadius: "50%", background: t.labelCountry }} />
                      </div>
                      <Text size="xs" color={i === themeIndex ? "primary" : "tertiary"}>{t.name}</Text>
                    </button>
                  ))}
                </div>
              </Stack>
            )}

            {activeTab === "about" && (
              <Stack direction="vertical" gap="4" align="stretch">
                <Text size="lg" weight="semibold">About Blip</Text>
                <Separator />
                <Stack direction="vertical" gap="2">
                  <Text size="sm" color="secondary">Version 0.1.0</Text>
                  <Text size="sm" color="secondary">A real-time network traffic visualizer.</Text>
                  <Text size="xs" color="tertiary">Built with Tauri, React, MapLibre GL, and deck.gl</Text>
                </Stack>
              </Stack>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
