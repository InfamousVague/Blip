import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Separator } from "../../ui/components/Separator";
import { Toggle } from "../../ui/components/Toggle";
import { Button } from "../../ui/components/Button";

function useBoolPref(key: string, defaultVal: boolean) {
  const [value, setValue] = useState(defaultVal);
  useEffect(() => {
    invoke<string | null>("get_preference", { key }).then((v) => {
      if (v !== null) setValue(v === "true");
    }).catch(() => {});
  }, [key]);
  const set = (v: boolean) => {
    setValue(v);
    invoke("set_preference", { key, value: String(v) }).catch(() => {});
  };
  return [value, set] as const;
}

const RETENTION_OPTIONS = [
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "0", label: "Forever" },
];

export function NetworkTab() {
  const [vpnIndicator, setVpnIndicator] = useBoolPref("vpn_status_indicator", true);
  const [vpnAutoDetect, setVpnAutoDetect] = useBoolPref("vpn_auto_detect", true);
  const [resolveHostnames, setResolveHostnames] = useBoolPref("dns_resolve_hostnames", true);
  const [cacheDns, setCacheDns] = useBoolPref("dns_cache_results", true);
  const [retentionDays, setRetentionDays] = useState("30");

  useEffect(() => {
    invoke<string | null>("get_preference", { key: "data_retention_days" })
      .then((v) => { if (v) setRetentionDays(v); })
      .catch(() => {});
  }, []);

  const handleRetentionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    setRetentionDays(v);
    invoke("set_preference", { key: "data_retention_days", value: v }).catch(() => {});
  };

  const handleResetSettings = async () => {
    if (!confirm("Reset all settings to defaults? This cannot be undone.")) return;
    try {
      await invoke("reset_preferences");
      window.location.reload();
    } catch {
      // Fallback: clear known keys individually
      const keys = [
        "auto_capture", "show_inactive", "debug_logging", "firewall_profile",
        "alert_download_enabled", "alert_upload_enabled", "alert_threshold_download_mbps",
        "alert_threshold_upload_mbps", "alert_firewall", "alert_trackers", "alert_new_app",
        "alert_quiet_hours", "vpn_status_indicator", "vpn_auto_detect",
        "dns_resolve_hostnames", "dns_cache_results", "data_retention_days",
      ];
      for (const key of keys) {
        await invoke("set_preference", { key, value: "" }).catch(() => {});
      }
      window.location.reload();
    }
  };

  const handleClearHistory = async () => {
    if (!confirm("Clear all connection history? This cannot be undone.")) return;
    try {
      await invoke("clear_history");
    } catch (e) {
      console.error("Clear history failed:", e);
    }
  };

  return (
    <>
      <span className="settings-section-title">Network</span>
      <Separator />

      <span className="settings-group-title">VPN Detection</span>

      <div className="settings-row">
        <div className="settings-row__label">
          <span className="blip-text-row-title">VPN status indicator</span>
          <span className="blip-text-row-desc">Show VPN connection status in the topbar</span>
        </div>
        <Toggle checked={vpnIndicator} onChange={setVpnIndicator} />
      </div>

      <div className="settings-row">
        <div className="settings-row__label">
          <span className="blip-text-row-title">Auto-detect VPN</span>
          <span className="blip-text-row-desc">Automatically detect active VPN connections</span>
        </div>
        <Toggle checked={vpnAutoDetect} onChange={setVpnAutoDetect} />
      </div>

      <Separator />

      <span className="settings-group-title">DNS Settings</span>

      <div className="settings-row">
        <div className="settings-row__label">
          <span className="blip-text-row-title">Resolve hostnames</span>
          <span className="blip-text-row-desc">Look up domain names for IP addresses</span>
        </div>
        <Toggle checked={resolveHostnames} onChange={setResolveHostnames} />
      </div>

      <div className="settings-row">
        <div className="settings-row__label">
          <span className="blip-text-row-title">Cache DNS results</span>
          <span className="blip-text-row-desc">Store DNS lookups to reduce latency</span>
        </div>
        <Toggle checked={cacheDns} onChange={setCacheDns} />
      </div>

      <Separator />

      <span className="settings-group-title">Data & Storage</span>

      <div className="settings-row">
        <div className="settings-row__label">
          <span className="blip-text-row-title">Data retention</span>
          <span className="blip-text-row-desc">How long to keep connection history</span>
        </div>
        <select
          className="settings-input"
          style={{ width: "auto", cursor: "pointer" }}
          value={retentionDays}
          onChange={handleRetentionChange}
        >
          {RETENTION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="diagnostics-item" style={{ gap: 2 }}>
        <span className="blip-text-row-title" style={{ fontSize: 12, fontWeight: 500, color: "var(--blip-text-secondary)" }}>
          Database size: \u2014
        </span>
        <span className="blip-text-row-desc">Last cleanup: \u2014</span>
      </div>

      <Separator />

      <span className="settings-danger-title">Danger Zone</span>

      <div style={{ display: "flex", gap: "var(--sp-2)" }}>
        <Button variant="secondary" size="sm" onClick={handleClearHistory}>
          <span style={{ color: "var(--blip-error)" }}>Clear History</span>
        </Button>
        <Button variant="secondary" size="sm" onClick={handleResetSettings}>
          <span style={{ color: "var(--blip-error)" }}>Reset All Settings</span>
        </Button>
      </div>
    </>
  );
}
