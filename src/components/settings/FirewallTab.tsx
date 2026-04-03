import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Separator } from "../../ui/components/Separator";
import { Toggle } from "../../ui/components/Toggle";

import type { NetworkProfile } from "../../types/firewall";
import { FirewallProfiles } from "./FirewallProfiles";
import { SystemWhitelist } from "./SystemWhitelist";
import { FirewallImportExport } from "./FirewallImportExport";

interface Props {
  firewallMode: string;
  onFirewallModeChange: (mode: string) => void;
}

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

      {/* Firewall Profile + Network Profiles */}
      <FirewallProfiles
        profiles={profiles}
        activeProfileId={activeProfileId}
        firewallMode={normalizedMode}
        onSwitchProfile={handleSwitchProfile}
        onFirewallModeChange={onFirewallModeChange}
        onProfilesChange={setProfiles}
      />

      <Separator />

      {/* System Whitelist */}
      <SystemWhitelist
        whitelist={systemWhitelist}
        show={showWhitelist}
        onToggle={() => setShowWhitelist(!showWhitelist)}
      />

      <Separator />

      {/* Import / Export */}
      <FirewallImportExport
        importCount={importCount}
        onImportCountChange={setImportCount}
      />
    </>
  );
}
