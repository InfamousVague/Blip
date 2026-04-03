import { useState, useEffect } from "react";
import { Button } from "./ui/components/Button";
import { Separator } from "./ui/components/Separator";
import { NumberRoll } from "@mattmattmattmatt/base/primitives/number-roll/NumberRoll";
import { Icon } from "@mattmattmattmatt/base/primitives/icon/Icon";
import { shieldCheck } from "@mattmattmattmatt/base/primitives/icon/icons/shield-check";
import "@mattmattmattmatt/base/primitives/number-roll/number-roll.css";
import "@mattmattmattmatt/base/primitives/icon/icon.css";
import { RadarMinimap } from "./components/map/RadarMinimap";
import { BandwidthHeader, BandwidthChart } from "./components/charts/BandwidthChart";
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
      <div style={{ display: "flex", flexDirection: "row", gap: 16, alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--blip-text-tertiary)" }}>ACTIVE</span>
          <NumberRoll value={activeCount} minDigits={2} fontSize="var(--text-lg-size)" commas />
        </div>
        <div className="menubar-divider" />
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--blip-text-tertiary)" }}>TOTAL</span>
          <NumberRoll value={connections.length} minDigits={2} fontSize="var(--text-lg-size)" commas />
        </div>
        <div className="menubar-divider" />
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--blip-text-tertiary)" }}>EVER</span>
          <NumberRoll value={totalEver} minDigits={3} fontSize="var(--text-lg-size)" commas />
        </div>
      </div>

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
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
          <span style={{ fontSize: 11, fontWeight: 500, fontFamily: "var(--font-sans)", color: "var(--blip-text-primary)" }}>Tracker Protection</span>
          <div style={{ display: "flex", flexDirection: "row", gap: 12, alignItems: "center" }}>
            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--blip-text-tertiary)" }}>
              <NumberRoll value={trackerHits} minDigits={1} fontSize="var(--text-xs-size)" duration={300} commas /> blocked
            </span>
            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--blip-text-tertiary)" }}>
              <NumberRoll value={trackerDomains} minDigits={1} fontSize="var(--text-xs-size)" duration={300} /> domains
            </span>
            {blockedConns > 0 && (
              <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--blip-text-tertiary)" }}>
                {blockedConns} active
              </span>
            )}
          </div>
        </div>
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
