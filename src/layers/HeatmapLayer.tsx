import { useEffect, useRef, useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { HistoricalEndpoint, ResolvedConnection } from "../types/connection";
import type { HeatmapPoint } from "./ArcLayer";

interface Props {
  /** Seed data loaded on app mount (avoids an extra fetch on first show) */
  initialEndpoints?: HistoricalEndpoint[];
  /** Live connections for real-time heatmap data (merged with historical) */
  liveConnections?: ResolvedConnection[];
  visible: boolean;
}

const DB_REFRESH_MS = 30_000;
const LIVE_SNAPSHOT_MS = 5_000; // Only rebuild from live data every 5s

/**
 * Data-only hook for heatmap points.
 * Merges historical DB endpoints with live connections on a throttled interval
 * to avoid expensive Deck.gl HeatmapLayer rebuilds on every poll cycle.
 */
export function useHeatmapData({ initialEndpoints, liveConnections, visible }: Props): HeatmapPoint[] {
  const [points, setPoints] = useState<HeatmapPoint[]>([]);
  const dbEndpointsRef = useRef<HistoricalEndpoint[]>(initialEndpoints ?? []);
  const liveRef = useRef<ResolvedConnection[]>([]);
  const dbIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const snapshotIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep live ref current without triggering re-renders
  liveRef.current = liveConnections ?? [];

  const refreshDb = useCallback(async () => {
    try {
      const eps = await invoke<HistoricalEndpoint[]>("get_historical_endpoints");
      dbEndpointsRef.current = eps;
    } catch {
      // DB may not be ready
    }
  }, []);

  // Build the merged point set (called on a throttled interval, not every render)
  const buildPoints = useCallback(() => {
    const pointMap = new Map<string, { lon: number; lat: number; weight: number }>();

    // Historical endpoints from DB
    for (const ep of dbEndpointsRef.current) {
      if (ep.dest_lat === 0 && ep.dest_lon === 0) continue;
      const key = `${ep.dest_lat.toFixed(2)},${ep.dest_lon.toFixed(2)}`;
      const existing = pointMap.get(key);
      if (existing) {
        existing.weight += ep.connection_count;
      } else {
        pointMap.set(key, { lon: ep.dest_lon, lat: ep.dest_lat, weight: ep.connection_count });
      }
    }

    // Live connections (may not be in DB yet)
    for (const c of liveRef.current) {
      if (c.dest_lat === 0 && c.dest_lon === 0) continue;
      const key = `${c.dest_lat.toFixed(2)},${c.dest_lon.toFixed(2)}`;
      if (!pointMap.has(key)) {
        pointMap.set(key, { lon: c.dest_lon, lat: c.dest_lat, weight: 1 });
      }
    }

    const result: HeatmapPoint[] = [];
    for (const { lon, lat, weight } of pointMap.values()) {
      result.push({ position: [lon, lat], weight: Math.min(weight, 20) });
    }
    setPoints(result);
  }, []);

  // Accept seed data on first load
  useEffect(() => {
    if (initialEndpoints && initialEndpoints.length > 0 && dbEndpointsRef.current.length === 0) {
      dbEndpointsRef.current = initialEndpoints;
    }
  }, [initialEndpoints]);

  // Start/stop intervals based on visibility
  useEffect(() => {
    if (!visible) {
      if (dbIntervalRef.current) clearInterval(dbIntervalRef.current);
      if (snapshotIntervalRef.current) clearInterval(snapshotIntervalRef.current);
      dbIntervalRef.current = null;
      snapshotIntervalRef.current = null;
      setPoints([]);
      return;
    }

    // Initial build + DB fetch
    refreshDb().then(buildPoints);

    // Periodic DB refresh (slow — every 30s)
    dbIntervalRef.current = setInterval(() => {
      refreshDb().then(buildPoints);
    }, DB_REFRESH_MS);

    // Periodic live snapshot (moderate — every 5s)
    snapshotIntervalRef.current = setInterval(buildPoints, LIVE_SNAPSHOT_MS);

    return () => {
      if (dbIntervalRef.current) clearInterval(dbIntervalRef.current);
      if (snapshotIntervalRef.current) clearInterval(snapshotIntervalRef.current);
    };
  }, [visible, refreshDb, buildPoints]);

  return points;
}
