import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "../../ui/components/Button";
import { SegmentedControl } from "../../ui/components/SegmentedControl";
import type { NetworkProfile, FirewallMode } from "../../types/firewall";

interface PresetProfile {
  id: string;
  label: string;
  mode: FirewallMode;
  desc: string;
}

const PRESET_PROFILES: PresetProfile[] = [
  { id: "strict", label: "Strict", mode: "deny_all", desc: "Block unknown apps. You approve every connection." },
  { id: "balanced", label: "Balanced", mode: "ask", desc: "Prompt on new apps. Smart defaults for known services." },
  { id: "open", label: "Open", mode: "allow_all", desc: "Allow everything. Monitor and log all connections." },
];

interface Props {
  profiles: NetworkProfile[];
  activeProfileId: string;
  firewallMode: string;
  onSwitchProfile: (id: string) => void;
  onFirewallModeChange: (mode: string) => void;
  onProfilesChange: React.Dispatch<React.SetStateAction<NetworkProfile[]>>;
}

export function FirewallProfiles({ profiles, activeProfileId, firewallMode, onSwitchProfile, onFirewallModeChange, onProfilesChange }: Props) {
  const [showNetworkProfiles, setShowNetworkProfiles] = useState(false);

  const activePreset = PRESET_PROFILES.find((p) => p.mode === firewallMode) || PRESET_PROFILES[1];

  return (
    <>
      {/* Preset profiles */}
      <span className="settings-group-title">Firewall Profile</span>
      <span className="blip-text-row-desc" style={{ marginTop: -4 }}>
        Controls how Blip handles unknown applications.
      </span>

      <SegmentedControl
        options={PRESET_PROFILES.map((p) => ({ value: p.mode, label: p.label }))}
        value={activePreset.mode}
        onChange={(v) => onFirewallModeChange(v)}
        size="md"
        style={{ width: "100%" }}
      />

      <span className="blip-text-row-desc" style={{ fontSize: 12, opacity: 0.7 }}>
        {activePreset.desc}
      </span>

      {/* Custom profile teaser */}
      <div
        style={{
          padding: "10px 14px",
          borderRadius: 8,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.05)",
          opacity: 0.5,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="settings-row__label">
            <span className="blip-text-row-title">Custom Profiles</span>
            <span className="blip-text-row-desc">Create your own profiles with custom rule sets.</span>
          </div>
          <span style={{
            fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 600,
            color: "var(--blip-text-tertiary)", background: "rgba(255,255,255,0.06)",
            padding: "2px 8px", borderRadius: 6, textTransform: "uppercase", letterSpacing: 0.3,
          }}>
            Coming Soon
          </span>
        </div>
      </div>

      {/* Network profiles (existing per-network switching) */}
      <div style={{ marginTop: 8 }}>
        <button
          onClick={() => setShowNetworkProfiles(!showNetworkProfiles)}
          style={{
            background: "none", border: "none", cursor: "pointer", padding: 0,
            fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 500,
            color: "var(--blip-text-tertiary)",
          }}
        >
          {showNetworkProfiles ? "Hide" : "Show"} Network Profiles ({profiles.length})
        </button>
      </div>

      {showNetworkProfiles && (
        <>
          <span className="blip-text-row-desc" style={{ marginTop: -4 }}>
            Auto-switch rule sets by WiFi network.
          </span>
          {profiles.map((p) => (
            <div
              key={p.id}
              className={`settings-profile-card${activeProfileId === p.id ? " settings-profile-card--active" : ""}`}
              onClick={() => onSwitchProfile(p.id)}
            >
              <div className="settings-row__label">
                <span className="blip-text-row-title">{p.name}</span>
                <span className="blip-text-row-desc">
                  {p.description || (p.auto_switch_ssid ? `Auto-switch: ${p.auto_switch_ssid}` : "Manual")}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div className={`settings-radio${activeProfileId === p.id ? " settings-radio--active" : ""}`} />
                {p.id !== "default" && (
                  <Button variant="ghost" size="sm" onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      await invoke("delete_network_profile", { id: p.id });
                      onProfilesChange((prev) => prev.filter((pp) => pp.id !== p.id));
                    } catch {}
                  }}>Delete</Button>
                )}
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}
