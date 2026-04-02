import { useEffect, useRef, useState } from "react";
import { useMap } from "react-map-gl/maplibre";
import cableData from "../assets/submarine-cables.json";
import landingData from "../assets/cable-landing-points.json";

const CABLE_SOURCE = "submarine-cables";
const LANDING_SOURCE = "cable-landing-points";
const CABLE_GLOW_LAYER = "cable-routes-glow";
const CABLE_LINE_LAYER = "cable-routes";
const LANDING_LAYER = "cable-landing-points-layer";

// Muted indigo that blends with the dark ocean
const CABLE_COLOR = "#3a3878";
const CABLE_HIGHLIGHT = "#8b9cf5";
const LANDING_COLOR = "#4a4898";

interface Props {
  /** Cable IDs currently carrying traffic (from useArcAnimation) */
  activeCableIds: string[];
  visible?: boolean;
}

function addCableLayers(m: maplibregl.Map) {
  if (m.getSource(CABLE_SOURCE)) return true;
  if (!m.getLayer("coastline")) return false;

  m.addSource(CABLE_SOURCE, {
    type: "geojson",
    data: cableData as GeoJSON.FeatureCollection,
  });

  m.addSource(LANDING_SOURCE, {
    type: "geojson",
    data: landingData as GeoJSON.FeatureCollection,
  });

  // Glow layer (wider, blurred) — only visible for active cables
  m.addLayer(
    {
      id: CABLE_GLOW_LAYER,
      type: "line",
      source: CABLE_SOURCE,
      filter: ["in", "id", ""], // empty filter — nothing glows by default
      paint: {
        "line-color": CABLE_HIGHLIGHT,
        "line-width": 6,
        "line-opacity": 0.3,
        "line-blur": 8,
      },
    },
    "coastline",
  );

  // Crisp cable line — all cables visible at low opacity
  m.addLayer(
    {
      id: CABLE_LINE_LAYER,
      type: "line",
      source: CABLE_SOURCE,
      paint: {
        "line-color": CABLE_COLOR,
        "line-width": 0.8,
        "line-opacity": 0.5,
        "line-dasharray": [4, 3],
      },
    },
    "coastline",
  );

  // Landing points
  m.addLayer(
    {
      id: LANDING_LAYER,
      type: "circle",
      source: LANDING_SOURCE,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 1, 4, 2, 8, 4],
        "circle-color": LANDING_COLOR,
        "circle-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.05, 4, 0.2, 8, 0.5],
        "circle-stroke-width": 0,
      },
    },
    "coastline",
  );

  return true;
}

export function SubmarineCableLayer({ activeCableIds, visible = true }: Props) {
  const { current: mapRef } = useMap();
  const [ready, setReady] = useState(false);
  const prevActiveRef = useRef<string>("");

  // Add sources and layers once the map style is loaded.
  // Also re-add when the style changes (e.g. tile source switches from remote to local).
  useEffect(() => {
    if (!mapRef) return;
    const m = mapRef.getMap();

    const tryAdd = () => {
      if (addCableLayers(m)) {
        setReady(true);
      }
    };

    // Style changes wipe dynamically-added layers — re-add on styledata
    const onStyleData = () => {
      setReady(false);
      // Small delay to let the style fully load
      setTimeout(tryAdd, 200);
    };

    tryAdd();

    m.on("load", tryAdd);
    m.on("idle", tryAdd);
    m.on("styledata", onStyleData);

    return () => {
      m.off("load", tryAdd);
      m.off("idle", tryAdd);
      m.off("styledata", onStyleData);
    };
  }, [mapRef]);

  // Update visibility
  useEffect(() => {
    if (!mapRef || !ready) return;
    const m = mapRef.getMap();
    const vis = visible ? "visible" : "none";
    for (const id of [CABLE_GLOW_LAYER, CABLE_LINE_LAYER, LANDING_LAYER]) {
      if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", vis);
    }
  }, [mapRef, visible, ready]);

  // Highlight only the active cables
  useEffect(() => {
    if (!mapRef || !ready) return;
    const m = mapRef.getMap();

    // Avoid redundant updates
    const activeKey = activeCableIds.sort().join(",");
    if (activeKey === prevActiveRef.current) return;
    prevActiveRef.current = activeKey;

    if (activeCableIds.length > 0) {
      // Show glow only for active cables
      m.setFilter(CABLE_GLOW_LAYER, ["in", "id", ...activeCableIds]);

      // Use data-driven styling: active cables are bright, others stay dim
      m.setPaintProperty(CABLE_LINE_LAYER, "line-color", [
        "case",
        ["in", ["get", "id"], ["literal", activeCableIds]],
        CABLE_HIGHLIGHT,
        CABLE_COLOR,
      ]);
      m.setPaintProperty(CABLE_LINE_LAYER, "line-opacity", [
        "case",
        ["in", ["get", "id"], ["literal", activeCableIds]],
        0.7,
        0.25,
      ]);
      m.setPaintProperty(CABLE_LINE_LAYER, "line-width", [
        "case",
        ["in", ["get", "id"], ["literal", activeCableIds]],
        1.5,
        0.8,
      ]);
    } else {
      // No active cables — everything dim
      m.setFilter(CABLE_GLOW_LAYER, ["in", "id", ""]);
      m.setPaintProperty(CABLE_LINE_LAYER, "line-color", CABLE_COLOR);
      m.setPaintProperty(CABLE_LINE_LAYER, "line-opacity", 0.5);
      m.setPaintProperty(CABLE_LINE_LAYER, "line-width", 0.8);
    }
  }, [mapRef, activeCableIds, ready]);

  return null;
}
