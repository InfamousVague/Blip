import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { WifiNetwork, ChannelRecommendation } from "../types/wifi";

const SCAN_INTERVAL = 10000; // 10 seconds

/** Request location permission — required on macOS for WiFi SSID access. */
async function ensureLocationPermission() {
  try {
    // Try the Tauri geolocation plugin first — this triggers the native macOS prompt
    const { checkPermissions, requestPermissions } = await import("@tauri-apps/plugin-geolocation");
    const status = await checkPermissions();
    if (status.location !== "granted") {
      await requestPermissions(["location"]);
    }
  } catch {
    // Plugin not available — try browser geolocation as fallback
    try {
      await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 5000,
        });
      });
    } catch {
      // Permission denied or unavailable
    }
  }
}

export function useWifiScan(active: boolean, scanOnMount = true) {
  const [networks, setNetworks] = useState<WifiNetwork[]>([]);
  const [recommendation, setRecommendation] = useState<ChannelRecommendation | null>(null);
  const [scanning, setScanning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationRequested = useRef(false);

  const scan = useCallback(async () => {
    if (document.hidden) return;
    setScanning(true);
    try {
      const results = await invoke<WifiNetwork[]>("scan_wifi");
      setNetworks(results);
      const rec = await invoke<ChannelRecommendation>("get_wifi_recommendation");
      setRecommendation(rec);
    } catch {
      // silently fail — WiFi scanning may not be available
    }
    setScanning(false);
  }, []);

  // Initial scan on mount (background, regardless of active tab)
  useEffect(() => {
    if (!scanOnMount) return;
    if (!locationRequested.current) {
      locationRequested.current = true;
      ensureLocationPermission().then(scan);
    } else {
      scan();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Periodic scanning when WiFi tab is active
  useEffect(() => {
    if (!active) return;
    scan();
    intervalRef.current = setInterval(scan, SCAN_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [active, scan]);

  const currentNetwork = networks.find((n) => n.is_current) || null;

  return { networks, recommendation, currentNetwork, scanning, rescan: scan };
}
