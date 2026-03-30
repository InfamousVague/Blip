import { useState, useEffect } from "react";
import { Stack } from "@mattmattmattmatt/base/primitives/stack/Stack";
import { Text } from "@mattmattmattmatt/base/primitives/text/Text";
import { Button } from "@mattmattmattmatt/base/primitives/button/Button";
import { NumberRoll } from "@mattmattmattmatt/base/primitives/number-roll/NumberRoll";
import { Separator } from "@mattmattmattmatt/base/primitives/separator/Separator";
import { Icon } from "@mattmattmattmatt/base/primitives/icon/Icon";
import { shieldCheck } from "@mattmattmattmatt/base/primitives/icon/icons/shield-check";
import "@mattmattmattmatt/base/primitives/stack/stack.css";
import "@mattmattmattmatt/base/primitives/text/text.css";
import "@mattmattmattmatt/base/primitives/button/button.css";
import "@mattmattmattmatt/base/primitives/number-roll/number-roll.css";
import "@mattmattmattmatt/base/primitives/separator/separator.css";
import "@mattmattmattmatt/base/primitives/icon/icon.css";
import { RadarMinimap } from "./components/RadarMinimap";
import { BandwidthHeader, BandwidthChart } from "./components/BandwidthChart";
import { useNetworkCapture } from "./hooks/useNetworkEvents";
import { useBandwidth } from "./hooks/useBandwidth";
import { useArcAnimation } from "./hooks/useArcAnimation";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./MenuBarApp.css";

type Location = { longitude: number; latitude: number };

interface TrackerStats {
  total_tracker_hits: number;
  total_bytes_blocked: number;
  top_domains: unknown[];
}

export function MenuBarApp() {
  const [location, setLocation] = useState<Location | null>(null);
  const [trackerHits, setTrackerHits] = useState(0);
  const [trackerDomains, setTrackerDomains] = useState(0);
  const { connections, totalEver, capturing, startCapture } = useNetworkCapture("network");
  const bandwidth = useBandwidth(capturing);

  const userPos: [number, number] | null = location
    ? [location.longitude, location.latitude]
    : null;

  const { endpoints } = useArcAnimation(connections, userPos, 0, []);

  // Fetch user location on mount
  useEffect(() => {
    invoke<{ latitude: number; longitude: number }>("get_user_location")
      .then((loc) => {
        if (loc.latitude && loc.longitude) setLocation(loc);
      })
      .catch(() => {});
  }, []);

  // Auto-start capture if not already running
  useEffect(() => {
    if (!capturing) {
      startCapture().catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll tracker stats
  useEffect(() => {
    const fetchTrackers = () => {
      invoke<TrackerStats>("get_tracker_stats")
        .then((stats) => {
          setTrackerHits(stats.total_tracker_hits);
          setTrackerDomains(stats.top_domains.length);
        })
        .catch(() => {});
    };
    fetchTrackers();
    const interval = setInterval(fetchTrackers, 5000);
    return () => clearInterval(interval);
  }, []);

  // Hide the popup when it loses focus
  // Delay slightly so the tray click → show sequence completes before blur can fire
  useEffect(() => {
    let active = false;
    const enableTimer = setTimeout(() => { active = true; }, 800);

    const handleBlur = () => {
      if (!active) return;
      // Short delay: if a tray click re-shows us within 300ms, don't hide
      setTimeout(() => {
        getCurrentWindow().isFocused().then((focused) => {
          if (!focused) {
            getCurrentWindow().hide().catch(() => {});
          }
        }).catch(() => {});
      }, 200);
    };

    window.addEventListener("blur", handleBlur);
    return () => {
      clearTimeout(enableTimer);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  const activeCount = connections.filter((c) => c.active).length;
  const blockedConns = connections.filter((c) => c.is_tracker).length;

  const handleOpenApp = () => {
    invoke("show_main_window").catch(() => {});
  };

  return (
    <div className="menubar-app">
      {/* Radar */}
      <div className="menubar-radar">
        <RadarMinimap endpoints={endpoints} userLocation={userPos} />
      </div>

      {/* Connection count */}
      <Stack direction="horizontal" gap="4" align="center" justify="center">
        <Stack direction="vertical" gap="1" align="center">
          <Text size="xs" color="tertiary" font="mono">ACTIVE</Text>
          <NumberRoll value={activeCount} minDigits={2} fontSize="var(--text-lg-size)" commas />
        </Stack>
        <div className="menubar-divider" />
        <Stack direction="vertical" gap="1" align="center">
          <Text size="xs" color="tertiary" font="mono">TOTAL</Text>
          <NumberRoll value={connections.length} minDigits={2} fontSize="var(--text-lg-size)" commas />
        </Stack>
        <div className="menubar-divider" />
        <Stack direction="vertical" gap="1" align="center">
          <Text size="xs" color="tertiary" font="mono">EVER</Text>
          <NumberRoll value={totalEver} minDigits={3} fontSize="var(--text-lg-size)" commas />
        </Stack>
      </Stack>

      <Separator />

      {/* Bandwidth stats */}
      <BandwidthHeader
        samples={bandwidth.samples}
        totalIn={bandwidth.totalIn}
        totalOut={bandwidth.totalOut}
      />

      {/* Bandwidth chart */}
      <BandwidthChart
        samples={bandwidth.samples}
        totalIn={bandwidth.totalIn}
        totalOut={bandwidth.totalOut}
      />

      <Separator />

      {/* Tracker blocking stats */}
      <div className="menubar-tracker-row">
        <Icon icon={shieldCheck} size="sm" />
        <Stack direction="vertical" gap="1" style={{ flex: 1 }}>
          <Text size="xs" weight="medium">Tracker Protection</Text>
          <Stack direction="horizontal" gap="3" align="center">
            <Text size="xs" color="tertiary" font="mono">
              <NumberRoll value={trackerHits} minDigits={1} fontSize="var(--text-xs-size)" duration={300} commas /> blocked
            </Text>
            <Text size="xs" color="tertiary" font="mono">
              <NumberRoll value={trackerDomains} minDigits={1} fontSize="var(--text-xs-size)" duration={300} /> domains
            </Text>
            {blockedConns > 0 && (
              <Text size="xs" color="tertiary" font="mono">
                {blockedConns} active
              </Text>
            )}
          </Stack>
        </Stack>
      </div>

      {/* Open App button */}
      <Button
        variant="secondary"
        size="md"
        onClick={handleOpenApp}
        className="menubar-open-btn"
      >
        Open Blip
      </Button>
    </div>
  );
}
