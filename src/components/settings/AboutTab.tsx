import { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Separator } from "../../ui/components/Separator";
import { Button } from "../../ui/components/Button";

const CHANGELOG = [
  { version: "0.3.1", desc: "Liquid glass UI, settings persistence" },
  { version: "0.3.0", desc: "Firewall mode, blocklist manager, DNS log" },
  { version: "0.2.0", desc: "Network extension, real-time arc visualization" },
  { version: "0.1.0", desc: "Initial release \u2014 nettop capture, world map" },
];

const TECH = ["Tauri 2", "React", "Rust", "MapLibre GL", "deck.gl"];

export function AboutTab() {
  const [version, setVersion] = useState("...");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion("unknown"));
  }, []);

  const openLink = (url: string) => {
    window.open(url, "_blank");
  };

  return (
    <>
      <span className="settings-section-title">About Blip</span>
      <Separator />

      <div className="settings-row">
        <div className="settings-row__label">
          <span className="blip-text-row-title" style={{ fontSize: 14, fontWeight: 600 }}>
            Version {version}
          </span>
          <span className="blip-text-row-desc" style={{ fontSize: 12, color: "var(--blip-text-secondary)" }}>
            A real-time network traffic visualizer for macOS
          </span>
        </div>
        <Button variant="secondary" size="sm" onClick={() => {}}>Check for Updates</Button>
      </div>

      <Separator />

      <span className="settings-group-title">Built With</span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {TECH.map((t) => (
          <span key={t} className="settings-chip">{t}</span>
        ))}
      </div>

      <Separator />

      <span className="settings-group-title">Changelog</span>
      {CHANGELOG.map((entry) => (
        <div key={entry.version} style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span className="settings-changelog-version">{entry.version}</span>
          <span className="blip-text-row-desc" style={{ fontSize: 12, color: "var(--blip-text-secondary)" }}>
            {entry.desc}
          </span>
        </div>
      ))}

      <Separator />

      <span className="settings-group-title">Links</span>
      <div style={{ display: "flex", gap: 12 }}>
        <button className="settings-link" onClick={() => openLink("https://github.com/mattmattmattmatt/blip")}>GitHub</button>
        <button className="settings-link" onClick={() => openLink("https://github.com/mattmattmattmatt/blip/issues")}>Report Bug</button>
        <button className="settings-link" onClick={() => openLink("https://github.com/mattmattmattmatt/blip/blob/main/LICENSE")}>License</button>
      </div>

      <Separator />

      <span className="blip-text-row-desc" style={{ opacity: 0.5 }}>Made with &#9829; by Matt</span>
    </>
  );
}
