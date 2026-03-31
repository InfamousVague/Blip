import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Separator } from "../../ui/components/Separator";
import { Toggle } from "../../ui/components/Toggle";

function usePref(key: string, defaultVal: string) {
  const [value, setValue] = useState(defaultVal);
  useEffect(() => {
    invoke<string | null>("get_preference", { key }).then((v) => {
      if (v !== null) setValue(v);
    }).catch(() => {});
  }, [key]);
  const set = (v: string) => {
    setValue(v);
    invoke("set_preference", { key, value: v }).catch(() => {});
  };
  return [value, set] as const;
}

function useBoolPref(key: string, defaultVal: boolean) {
  const [raw, setRaw] = usePref(key, String(defaultVal));
  return [raw === "true", (v: boolean) => setRaw(String(v))] as const;
}

export function AlertsTab() {
  const [dlEnabled, setDlEnabled] = useBoolPref("alert_download_enabled", true);
  const [dlThreshold, setDlThreshold] = usePref("alert_threshold_download_mbps", "100");
  const [ulEnabled, setUlEnabled] = useBoolPref("alert_upload_enabled", true);
  const [ulThreshold, setUlThreshold] = usePref("alert_threshold_upload_mbps", "50");
  const [fwAlerts, setFwAlerts] = useBoolPref("alert_firewall", true);
  const [trackerAlerts, setTrackerAlerts] = useBoolPref("alert_trackers", true);
  const [newAppAlerts, setNewAppAlerts] = useBoolPref("alert_new_app", false);
  const [quietHours, setQuietHours] = useBoolPref("alert_quiet_hours", false);

  return (
    <>
      <span className="settings-section-title">Alerts</span>
      <Separator />

      <span className="settings-group-title">Bandwidth Thresholds</span>

      <div className="settings-row">
        <div className="settings-row__label">
          <span className="blip-text-row-title">Download alert</span>
          <span className="blip-text-row-desc">Notify when download exceeds threshold</span>
        </div>
        <Toggle checked={dlEnabled} onChange={setDlEnabled} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
        <input
          type="number"
          className="settings-input"
          value={dlThreshold}
          onChange={(e) => setDlThreshold(e.target.value)}
          disabled={!dlEnabled}
          min={1}
        />
        <span className="blip-text-row-desc" style={{ flexShrink: 0 }}>Mbps</span>
      </div>

      <div className="settings-row">
        <div className="settings-row__label">
          <span className="blip-text-row-title">Upload alert</span>
          <span className="blip-text-row-desc">Notify when upload exceeds threshold</span>
        </div>
        <Toggle checked={ulEnabled} onChange={setUlEnabled} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
        <input
          type="number"
          className="settings-input"
          value={ulThreshold}
          onChange={(e) => setUlThreshold(e.target.value)}
          disabled={!ulEnabled}
          min={1}
        />
        <span className="blip-text-row-desc" style={{ flexShrink: 0 }}>Mbps</span>
      </div>

      <Separator />

      <span className="settings-group-title">Alert Types</span>

      <div className="settings-row">
        <div className="settings-row__label">
          <span className="blip-text-row-title">Firewall alerts</span>
          <span className="blip-text-row-desc">Show toast when a connection is blocked</span>
        </div>
        <Toggle checked={fwAlerts} onChange={setFwAlerts} />
      </div>

      <div className="settings-row">
        <div className="settings-row__label">
          <span className="blip-text-row-title">Tracker alerts</span>
          <span className="blip-text-row-desc">Notify when tracker domains are detected</span>
        </div>
        <Toggle checked={trackerAlerts} onChange={setTrackerAlerts} />
      </div>

      <div className="settings-row">
        <div className="settings-row__label">
          <span className="blip-text-row-title">New app alerts</span>
          <span className="blip-text-row-desc">Notify when an unknown app connects</span>
        </div>
        <Toggle checked={newAppAlerts} onChange={setNewAppAlerts} />
      </div>

      <Separator />

      <span className="settings-group-title">Quiet Hours</span>

      <div className="settings-row">
        <div className="settings-row__label">
          <span className="blip-text-row-title">Enable quiet hours</span>
          <span className="blip-text-row-desc">Suppress non-critical alerts during set hours</span>
        </div>
        <Toggle checked={quietHours} onChange={setQuietHours} />
      </div>
    </>
  );
}
