import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { Separator } from "../../ui/components/Separator";
import { Button } from "../../ui/components/Button";
import { Toggle } from "../../ui/components/Toggle";
import { SegmentedControl } from "../../ui/components/SegmentedControl";
import type { NetworkProfile, FirewallMode } from "../../types/firewall";

interface Props {
  firewallMode: string;
  onFirewallModeChange: (mode: string) => void;
}

const FIREWALL_MODES = [
  { value: "ask", label: "Ask" },
  { value: "allow_all", label: "Allow All" },
  { value: "deny_all", label: "Deny All" },
];

// Map legacy mode values to new ones
function normalizeMode(mode: string): string {
  if (mode === "silent_allow") return "allow_all";
  if (mode === "alert") return "ask";
  if (mode === "silent_deny") return "deny_all";
  return mode;
}

export function FirewallTab({ firewallMode, onFirewallModeChange }: Props) {
  const [killSwitch, setKillSwitch] = useState(false);
  const [profiles, setProfiles] = useState<NetworkProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState("default");
  const [systemWhitelist, setSystemWhitelist] = useState<string[]>([]);
  const [showWhitelist, setShowWhitelist] = useState(false);
  const [importCount, setImportCount] = useState<number | null>(null);
  const [showNewProfile, setShowNewProfile] = useState(false);
  const newProfileNameRef = useRef<HTMLInputElement>(null);
  const newProfileSsidRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    invoke<NetworkProfile[]>("get_network_profiles").then(setProfiles).catch(() => {});
    invoke<string[]>("get_system_whitelist").then(setSystemWhitelist).catch(() => {});
    invoke<string | null>("get_preference", { key: "kill_switch_active" })
      .then((v) => setKillSwitch(v === "true"))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const active = profiles.find((p) => p.is_active);
    if (active) setActiveProfileId(active.id);
  }, [profiles]);

  const handleKillSwitch = useCallback(async (active: boolean) => {
    setKillSwitch(active);
    try {
      await invoke("toggle_kill_switch", { active });
    } catch (e) {
      console.error("Kill switch failed:", e);
      setKillSwitch(!active);
    }
  }, []);

  const handleSwitchProfile = useCallback(async (id: string) => {
    try {
      await invoke("switch_network_profile", { id });
      setActiveProfileId(id);
      setProfiles((prev) =>
        prev.map((p) => ({ ...p, is_active: p.id === id }))
      );
    } catch (e) {
      console.error("Switch profile failed:", e);
    }
  }, []);

  const handleExport = useCallback(async () => {
    try {
      const json = await invoke<string>("export_firewall_config");
      const path = await save({
        defaultPath: "blip-firewall-config.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (path) await writeTextFile(path, json);
    } catch (e) {
      console.error("Export failed:", e);
    }
  }, []);

  const handleImport = useCallback(async () => {
    try {
      const path = await open({
        filters: [{ name: "JSON", extensions: ["json"] }],
        multiple: false,
      });
      if (!path) return;
      const content = await readTextFile(path as string);
      const count = await invoke<number>("import_firewall_config", { json: content });
      setImportCount(count);
      setTimeout(() => setImportCount(null), 3000);
    } catch (e) {
      console.error("Import failed:", e);
    }
  }, []);

  const normalizedMode = normalizeMode(firewallMode);

  return (
    <>
      <span className="settings-section-title">Firewall</span>
      <Separator />

      {/* Kill Switch */}
      <div className="settings-row">
        <div className="settings-row__label">
          <span className="blip-text-row-title" style={{ color: killSwitch ? "var(--blip-error)" : undefined }}>
            Kill Switch
          </span>
          <span className="blip-text-row-desc">
            {killSwitch
              ? "ALL network traffic is blocked. Toggle off to restore."
              : "Instantly block all network traffic. Use in emergencies."}
          </span>
        </div>
        <Toggle checked={killSwitch} onChange={handleKillSwitch} />
      </div>

      {killSwitch && (
        <div style={{
          padding: "8px 12px",
          borderRadius: 8,
          background: "rgba(239, 68, 68, 0.12)",
          border: "1px solid rgba(239, 68, 68, 0.3)",
          fontSize: 12,
          color: "var(--blip-error)",
          fontWeight: 500,
        }}>
          Kill switch is active — all internet traffic is blocked.
        </div>
      )}

      <Separator />

      {/* Default Mode */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
        <span className="settings-group-title">Default Mode</span>
        <span className="blip-text-row-desc">How to handle apps without a specific rule.</span>
      </div>
      <SegmentedControl
        options={FIREWALL_MODES}
        value={normalizedMode}
        onChange={onFirewallModeChange}
        size="sm"
        style={{ width: "100%" }}
      />

      <Separator />

      {/* Network Profiles */}
      <span className="settings-group-title">Network Profiles</span>
      <span className="blip-text-row-desc" style={{ marginTop: -4 }}>
        Different rule sets for different networks. Auto-switches by WiFi SSID.
      </span>

      {profiles.map((p) => (
        <div
          key={p.id}
          className={`settings-profile-card${activeProfileId === p.id ? " settings-profile-card--active" : ""}`}
          onClick={() => handleSwitchProfile(p.id)}
        >
          <div className="settings-row__label">
            <span className="blip-text-row-title">{p.name}</span>
            <span className="blip-text-row-desc">
              {p.description || (p.auto_switch_ssid ? `Auto-switch on: ${p.auto_switch_ssid}` : "Manual activation")}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className={`settings-radio${activeProfileId === p.id ? " settings-radio--active" : ""}`} />
            {p.id !== "default" && (
              <Button variant="ghost" size="sm" onClick={async (e) => {
                e.stopPropagation();
                try {
                  await invoke("delete_network_profile", { id: p.id });
                  setProfiles((prev) => prev.filter((pp) => pp.id !== p.id));
                } catch {}
              }}>Delete</Button>
            )}
          </div>
        </div>
      ))}

      {!showNewProfile ? (
        <Button variant="secondary" size="sm" onClick={() => setShowNewProfile(true)}>
          + New Profile
        </Button>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 0" }}>
          <input
            ref={newProfileNameRef}
            placeholder="Profile name (e.g., Coffee Shop)"
            style={{
              padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.04)", color: "var(--blip-text-primary)",
              fontFamily: "var(--font-sans)", fontSize: 13, outline: "none",
            }}
          />
          <input
            ref={newProfileSsidRef}
            placeholder="Auto-switch WiFi SSID (optional)"
            style={{
              padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.04)", color: "var(--blip-text-primary)",
              fontFamily: "var(--font-sans)", fontSize: 13, outline: "none",
            }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <Button variant="primary" size="sm" onClick={async () => {
              const name = newProfileNameRef.current?.value?.trim();
              if (!name) return;
              const ssid = newProfileSsidRef.current?.value?.trim() || undefined;
              try {
                const profile = await invoke<NetworkProfile>("create_network_profile", {
                  name, description: null, autoSwitchSsid: ssid || null, autoSwitchVpn: false,
                });
                setProfiles((prev) => [...prev, profile]);
                setShowNewProfile(false);
              } catch (e) {
                console.error("Create profile failed:", e);
              }
            }}>Create</Button>
            <Button variant="ghost" size="sm" onClick={() => setShowNewProfile(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <Separator />

      {/* System Whitelist */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="settings-group-title">System Whitelist</span>
        <Button variant="secondary" size="sm" onClick={() => setShowWhitelist(!showWhitelist)}>
          {showWhitelist ? "Hide" : "Show"} ({systemWhitelist.length})
        </Button>
      </div>
      <span className="blip-text-row-desc" style={{ marginTop: -4 }}>
        Apple system processes that always bypass firewall rules.
      </span>

      {showWhitelist && (
        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          padding: "8px 10px",
          borderRadius: 8,
          background: "rgba(255, 255, 255, 0.02)",
          maxHeight: 200,
          overflowY: "auto",
        }}>
          {systemWhitelist.map((bid) => (
            <span key={bid} style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--blip-text-tertiary)" }}>
              {bid}
            </span>
          ))}
        </div>
      )}

      <Separator />

      {/* Import / Export */}
      <span className="settings-group-title">Import / Export</span>
      <div style={{ display: "flex", gap: "var(--sp-2)" }}>
        <Button variant="secondary" size="sm" onClick={handleExport}>Export Config</Button>
        <Button variant="secondary" size="sm" onClick={handleImport}>Import Config</Button>
        {importCount !== null && (
          <span className="blip-text-row-desc" style={{ alignSelf: "center", color: "var(--blip-success)" }}>
            Imported {importCount} rules
          </span>
        )}
      </div>
    </>
  );
}
