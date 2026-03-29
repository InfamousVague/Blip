import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Stack } from "@mattmattmattmatt/base/primitives/stack/Stack";
import { Text } from "@mattmattmattmatt/base/primitives/text/Text";
import { Button } from "@mattmattmattmatt/base/primitives/button/Button";
import { Icon } from "@mattmattmattmatt/base/primitives/icon/Icon";
import { Checkbox } from "@mattmattmattmatt/base/primitives/checkbox/Checkbox";
import { shieldCheck } from "@mattmattmattmatt/base/primitives/icon/icons/shield-check";
import { activity } from "@mattmattmattmatt/base/primitives/icon/icons/activity";
import { zap } from "@mattmattmattmatt/base/primitives/icon/icons/zap";
import "@mattmattmattmatt/base/primitives/stack/stack.css";
import "@mattmattmattmatt/base/primitives/text/text.css";
import "@mattmattmattmatt/base/primitives/button/button.css";
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
        <Stack direction="vertical" gap="6" align="stretch">
          <Stack direction="vertical" gap="3" align="center">
            <Text size="xl" weight="semibold">Enable Network Monitor</Text>
            <Text size="sm" color="secondary" style={{ textAlign: "center", paddingBottom: "var(--sp-2)" }}>
              Blip uses a system extension to monitor all network traffic.
              macOS will ask you to approve it in System Settings.
            </Text>
          </Stack>

          <Stack direction="vertical" gap="3" align="stretch" style={{ paddingBottom: "var(--sp-2)" }}>
            {FEATURES.map((feat) => (
              <div key={feat.title} className="setup-feature">
                <div className="setup-feature__icon">
                  <Icon icon={feat.icon} size="lg" color="primary" />
                </div>
                <Stack direction="vertical" gap={"0" as any}>
                  <Text size="sm" weight="medium">{feat.title}</Text>
                  <Text size="xs" color="tertiary">{feat.description}</Text>
                </Stack>
              </div>
            ))}
          </Stack>

          {error && (
            <Text size="xs" color="secondary" style={{ textAlign: "center" }}>
              {error}
            </Text>
          )}

          <Stack direction="vertical" gap="3" align="stretch">
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
          </Stack>

          <Stack direction="horizontal" gap="2" align="center" justify="center">
            <Checkbox
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              size="sm"
            />
            <Text size="xs" color="tertiary">Don't show this again</Text>
          </Stack>
        </Stack>
      </div>
    </div>
  );
}
