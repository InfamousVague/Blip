import { useMemo, useEffect, useRef, useCallback, useState } from "react";
import { Source, Layer } from "react-map-gl/maplibre";
import type { HeatmapLayerSpecification } from "maplibre-gl";
import { invoke } from "@tauri-apps/api/core";
import type { HistoricalEndpoint } from "../types/connection";

interface Props {
  /** Seed data loaded on app mount (avoids an extra fetch on first show) */
  initialEndpoints?: HistoricalEndpoint[];
  visible: boolean;
}

const REFRESH_INTERVAL_MS = 30_000;

// Empty geojson to use when no data is available (avoids conditional Source rendering)
const EMPTY_GEOJSON: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export function HeatmapLayer({ initialEndpoints, visible }: Props) {
  const [endpoints, setEndpoints] = useState<HistoricalEndpoint[]>(initialEndpoints ?? []);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const eps = await invoke<HistoricalEndpoint[]>("get_historical_endpoints");
      setEndpoints(eps);
    } catch {
      // DB may not be ready
    }
  }, []);

  // Periodically refresh from DB while visible so new connections appear
  useEffect(() => {
    if (!visible) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    refresh();
    intervalRef.current = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [visible, refresh]);

  // Accept updated seed data
  useEffect(() => {
    if (initialEndpoints && initialEndpoints.length > 0 && endpoints.length === 0) {
      setEndpoints(initialEndpoints);
    }
  }, [initialEndpoints]); // eslint-disable-line react-hooks/exhaustive-deps

  const geojson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (endpoints.length === 0) return EMPTY_GEOJSON;
    const features: GeoJSON.Feature[] = endpoints.map((ep) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [ep.dest_lon, ep.dest_lat] },
      properties: { weight: Math.min(ep.connection_count, 20) },
    }));
    return { type: "FeatureCollection", features };
  }, [endpoints]);

  // Build paint with dynamic opacity — always render the Source/Layer to avoid
  // MapLibre source add/remove race conditions that cause the heatmap to vanish.
  const layerStyle = useMemo<Omit<HeatmapLayerSpecification, "source">>(() => ({
    id: "network-heatmap",
    type: "heatmap",
    paint: {
      "heatmap-weight": [
        "interpolate", ["linear"], ["get", "weight"],
        0, 0.2, 5, 0.6, 10, 0.8, 20, 1,
      ],
      "heatmap-intensity": [
        "interpolate", ["linear"], ["zoom"],
        0, 2, 4, 3, 9, 5,
      ],
      "heatmap-color": [
        "interpolate", ["linear"], ["heatmap-density"],
        0, "rgba(0,0,0,0)",
        0.1, "rgba(99,102,241,0.15)",
        0.3, "rgba(99,102,241,0.4)",
        0.5, "rgba(139,92,246,0.6)",
        0.7, "rgba(236,72,153,0.7)",
        0.85, "rgba(245,158,11,0.8)",
        1, "rgba(255,255,255,0.9)",
      ],
      "heatmap-radius": [
        "interpolate", ["linear"], ["zoom"],
        0, 30, 4, 50, 8, 70, 12, 90,
      ],
      "heatmap-opacity": visible ? 0.8 : 0,
    },
  }), [visible]);

  return (
    <Source id="heatmap-source" type="geojson" data={geojson}>
      <Layer {...layerStyle} />
    </Source>
  );
}
