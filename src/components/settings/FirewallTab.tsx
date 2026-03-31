import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { Separator } from "../../ui/components/Separator";
import { Button } from "../../ui/components/Button";
import { SegmentedControl } from "../../ui/components/SegmentedControl";
import { Badge } from "../../ui/components/Badge";

interface Props {
  firewallMode: string;
  onFirewallModeChange: (mode: string) => void;
}

const FIREWALL_ACTIONS = [
  { value: "silent_allow", label: "Always Allow" },
  { value: "alert", label: "Prompt" },
  { value: "silent_deny", label: "Always Deny" },
];

const PROFILES = [
  { id: "strict", name: "Strict", desc: "Block all unknown traffic, whitelist only" },
  { id: "balanced", name: "Balanced", desc: "Prompt for new apps, allow known services" },
  { id: "permissive", name: "Permissive", desc: "Allow most traffic, block known threats only" },
];

export function FirewallTab({ firewallMode, onFirewallModeChange }: Props) {
  const [activeProfile, setActiveProfile] = useState("balanced");
  const [importCount, setImportCount] = useState<number | null>(null);

  useEffect(() => {
    invoke<string | null>("get_preference", { key: "firewall_profile" })
      .then((v) => { if (v) setActiveProfile(v); })
      .catch(() => {});
  }, []);

  const handleProfileChange = (id: string) => {
    setActiveProfile(id);
    invoke("set_preference", { key: "firewall_profile", value: id }).catch(() => {});
  };

  const handleExport = useCallback(async () => {
    try {
      const json = await invoke<string>("export_firewall_rules");
      const path = await save({
        defaultPath: "blip-firewall-rules.json",
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
      const count = await invoke<number>("import_firewall_rules", { json: content });
      setImportCount(count);
      setTimeout(() => setImportCount(null), 3000);
    } catch (e) {
      console.error("Import failed:", e);
    }
  }, []);

  return (
    <>
      <span className="settings-section-title">Firewall</span>
      <Separator />

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
        <span className="settings-group-title">Default Action for Unknown Apps</span>
        <span className="blip-text-row-desc">Choose what happens when an unrecognized app tries to connect.</span>
      </div>
      <SegmentedControl
        options={FIREWALL_ACTIONS}
        value={firewallMode}
        onChange={onFirewallModeChange}
        size="sm"
        style={{ width: "100%" }}
      />

      <Separator />

      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
        <span className="settings-group-title">Rule Profiles</span>
        <Badge color="info" variant="subtle">Coming soon</Badge>
      </div>

      {PROFILES.map((p) => (
        <div
          key={p.id}
          className={`settings-profile-card${activeProfile === p.id ? " settings-profile-card--active" : ""}`}
          onClick={() => handleProfileChange(p.id)}
        >
          <div className="settings-row__label">
            <span className="blip-text-row-title">{p.name}</span>
            <span className="blip-text-row-desc">{p.desc}</span>
          </div>
          <div className={`settings-radio${activeProfile === p.id ? " settings-radio--active" : ""}`} />
        </div>
      ))}

      <Separator />

      <span className="settings-group-title">Import / Export Rules</span>
      <div style={{ display: "flex", gap: "var(--sp-2)" }}>
        <Button variant="secondary" size="sm" onClick={handleExport}>Export Rules</Button>
        <Button variant="secondary" size="sm" onClick={handleImport}>Import Rules</Button>
        {importCount !== null && (
          <span className="blip-text-row-desc" style={{ alignSelf: "center", color: "var(--blip-success)" }}>
            Imported {importCount} rules
          </span>
        )}
      </div>
    </>
  );
}
