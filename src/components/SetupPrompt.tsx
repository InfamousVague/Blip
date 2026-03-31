import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "../ui/components/Button";
import { Icon } from "@mattmattmattmatt/base/primitives/icon/Icon";
import { Checkbox } from "@mattmattmattmatt/base/primitives/checkbox/Checkbox";
import { shieldCheck } from "@mattmattmattmatt/base/primitives/icon/icons/shield-check";
import { activity } from "@mattmattmattmatt/base/primitives/icon/icons/activity";
import { zap } from "@mattmattmattmatt/base/primitives/icon/icons/zap";
import "@mattmattmattmatt/base/primitives/icon/icon.css";
import "@mattmattmattmatt/base/primitives/checkbox/checkbox.css";
import "./SetupPrompt.css";

const FEATURES = [
  {
    icon: shieldCheck,
    title: "Block trackers & ads at the network level",
    description: "Detect and block tracking domains before they load",
  },
  {
    icon: activity,
    title: "See every connection in real-time",
    description: "System-wide monitoring of all apps and services",
  },
  {
    icon: zap,
    title: "Identify who your data goes to",
    description: "Map connections to companies, countries, and data centers",
  },
];

interface Props {
  onComplete: (neEnabled: boolean) => void;
}

export function SetupPrompt({ onComplete }: Props) {
  const [loading, setLoading] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [neAlreadyActive, setNeAlreadyActive] = useState(false);

  useEffect(() => {
    // Check if NE is already active
    invoke<string>("get_network_extension_status")
      .then((result) => {
        try {
          const parsed = JSON.parse(result);
          if (parsed.status === "active") {
            setNeAlreadyActive(true);
          }
        } catch {}
      })
      .catch(() => {});
  }, []);

  const handleEnable = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<string>("activate_network_extension");
      try {
        const parsed = JSON.parse(result);
        if (parsed.status === "error" && parsed.error) {
          setError(parsed.error);
          setLoading(false);
          return;
        }
      } catch {}
      localStorage.setItem("blip-setup-dismissed", "permanent");
      onComplete(true);
    } catch (e) {
      setError("Failed to activate. You can try again in Settings.");
      console.error("NE activation error:", e);
    }
    setLoading(false);
  };

  const handleLater = () => {
    if (dontShowAgain) {
      localStorage.setItem("blip-setup-dismissed", "permanent");
    } else {
      localStorage.setItem("blip-setup-dismissed", Date.now().toString());
    }
    onComplete(false);
  };

  // If NE is already active, auto-dismiss
  if (neAlreadyActive) {
    return null;
  }

  return (
    <div className="setup-backdrop">
      <div className="setup-panel">
        <div style={{ display: "flex", flexDirection: "column", gap: 24, alignItems: "stretch" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
            <span style={{ fontSize: 22, fontWeight: 600, fontFamily: "var(--font-sans)", color: "var(--blip-text-primary)" }}>Enable Network Monitor</span>
            <span style={{ fontSize: 13, fontFamily: "var(--font-sans)", color: "var(--blip-text-secondary)", textAlign: "center", paddingBottom: "var(--sp-2)" }}>
              Blip uses a system extension to monitor all network traffic.
              macOS will ask you to approve it in System Settings.
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "stretch", paddingBottom: "var(--sp-2)" }}>
            {FEATURES.map((feat) => (
              <div key={feat.title} className="setup-feature">
                <div className="setup-feature__icon">
                  <Icon icon={feat.icon} size="lg" color="primary" />
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 13, fontWeight: 500, fontFamily: "var(--font-sans)", color: "var(--blip-text-primary)" }}>{feat.title}</span>
                  <span style={{ fontSize: 11, fontFamily: "var(--font-sans)", color: "var(--blip-text-tertiary)" }}>{feat.description}</span>
                </div>
              </div>
            ))}
          </div>

          {error && (
            <span style={{ fontSize: 11, fontFamily: "var(--font-sans)", color: "var(--blip-text-secondary)", textAlign: "center" }}>
              {error}
            </span>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "stretch" }}>
            <Button
              variant="primary"
              size="md"
              onClick={handleEnable}
              disabled={loading}
            >
              {loading ? "Activating..." : "Enable Network Monitor"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLater}
            >
              Maybe Later
            </Button>
          </div>

          <div style={{ display: "flex", flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" }}>
            <Checkbox
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              size="sm"
            />
            <span style={{ fontSize: 11, fontFamily: "var(--font-sans)", color: "var(--blip-text-tertiary)" }}>Don't show this again</span>
          </div>
        </div>
      </div>
    </div>
  );
}
