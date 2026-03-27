import { useMemo } from "react";
import { Source, Layer } from "react-map-gl/maplibre";
import type { HeatmapLayerSpecification } from "maplibre-gl";
import type { EndpointData } from "../hooks/useArcAnimation";
import type { HistoricalEndpoint } from "../types/connection";

interface Props {
  endpoints: EndpointData[];
  historicalEndpoints?: HistoricalEndpoint[];
  visible: boolean;
}

const layerStyle: Omit<HeatmapLayerSpecification, "source"> = {
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
    "heatmap-opacity": 0.8,
  },
};

export function HeatmapLayer({ endpoints, historicalEndpoints, visible }: Props) {
  const geojson = useMemo<GeoJSON.FeatureCollection>(() => {
    const features: GeoJSON.Feature[] = [];

    // Historical endpoints (from DB — all time)
    if (historicalEndpoints) {
      for (const ep of historicalEndpoints) {
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [ep.dest_lon, ep.dest_lat] },
          properties: { weight: Math.min(ep.connection_count, 20) },
        });
      }
    }

    // Live endpoints (current session — may overlap with historical, that's fine for heatmap)
    for (const ep of endpoints) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: ep.position },
        properties: { weight: Math.min(ep.connectionCount * 2, 20) }, // boost live data
      });
    }

    return { type: "FeatureCollection", features };
  }, [endpoints, historicalEndpoints]);

  if (!visible || geojson.features.length === 0) return null;

  return (
    <Source id="heatmap-source" type="geojson" data={geojson}>
      <Layer {...layerStyle} />
    </Source>
  );
}
