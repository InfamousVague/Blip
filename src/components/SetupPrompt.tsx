import { useState } from "react";
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
    title: "See all system connections",
    description: "Monitor traffic from all apps, not just yours",
  },
  {
    icon: activity,
    title: "Real-time byte tracking",
    description: "See exactly how much data each connection transfers",
  },
  {
    icon: zap,
    title: "Better connection detection",
    description: "Catch short-lived connections that are currently missed",
  },
];

interface Props {
  onComplete: (elevated: boolean) => void;
}

export function SetupPrompt({ onComplete }: Props) {
  const [loading, setLoading] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEnable = async () => {
    setLoading(true);
    setError(null);
    try {
      const granted = await invoke<boolean>("request_elevation");
      if (granted) {
        localStorage.setItem("blip-setup-dismissed", "permanent");
        onComplete(true);
      } else {
        setError("Permission was denied. You can enable this later in Settings.");
      }
    } catch (e) {
      setError("Failed to request permissions. You can try again in Settings.");
      console.error("Elevation error:", e);
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

  return (
    <div className="setup-backdrop">
      <div className="setup-panel">
        <Stack direction="vertical" gap="6" align="stretch">
          <Stack direction="vertical" gap="3" align="center">
            <Text size="xl" weight="semibold">Enhance Network Monitoring</Text>
            <Text size="sm" color="secondary" style={{ textAlign: "center", paddingBottom: "var(--sp-2)" }}>
              Blip works better with administrator access. This enables deeper
              visibility into your network traffic.
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
              {loading ? "Requesting access..." : "Enable Enhanced Monitoring"}
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
