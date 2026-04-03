import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SelfIpInfo } from "../types/connection";

export type Location = { longitude: number; latitude: number; source: string; ip?: string };

let cachedLocation: Location | null = null;

export async function getLocation(forceRefresh = false): Promise<Location> {
  if (cachedLocation && !forceRefresh) return cachedLocation;

  // Try native bridge first (non-blocking, single attempt)
  try {
    const loc = await invoke<{ latitude: number; longitude: number }>("get_user_location");
    if (loc.latitude && loc.longitude) {
      cachedLocation = { ...loc, source: "native" };
      return cachedLocation;
    }
  } catch {
    // Native location not available yet
  }

  // Try browser geolocation
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error("No geolocation")); return; }
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 3000 });
    });
    cachedLocation = { longitude: pos.coords.longitude, latitude: pos.coords.latitude, source: "browser" };
    return cachedLocation;
  } catch {
    // Browser geolocation failed
  }

  // Fallback: center of US (the map still works, just not centered on user)
  return { longitude: -98.5, latitude: 39.8, source: "fallback" };
}

export function useUserLocation() {
  const [location, setLocation] = useState<Location | null>(null);
  const [selfInfo, setSelfInfo] = useState<SelfIpInfo | null>(null);
  const [elevationBanner, setElevationBanner] = useState(false);

  useEffect(() => {
    getLocation()
      .then((loc) => {
        setLocation(loc);
      })
      .catch((err) => console.warn("Location unavailable:", err));

    // Fetch self IP info (ISP, ASN, network type)
    invoke<SelfIpInfo>("get_self_info")
      .then((info) => setSelfInfo(info))
      .catch((err) => console.warn("Failed to load self info:", err));

    // Check if elevation was previously enabled
    invoke<string | null>("get_preference", { key: "elevation_enabled" })
      .then((pref) => {
        if (pref === "true") {
          invoke<boolean>("check_elevation").then((active) => {
            if (!active) {
              setElevationBanner(true);
            }
          });
        }
      })
      .catch(() => {});
  }, []);

  const refreshLocation = () => {
    return getLocation(true).then((loc) => {
      setLocation(loc);
      return loc;
    });
  };

  return { location, setLocation, selfInfo, elevationBanner, setElevationBanner, refreshLocation };
}
