import type { StyleSpecification } from "maplibre-gl";
import { gray } from "@mattmattmattmatt/base/tokens";

// ---- Shared vector layers (labels, roads, boundaries) ----
const vectorSource = {
  openmaptiles: {
    type: "vector" as const,
    url: "https://tiles.openfreemap.org/planet",
  },
};

const glyphs = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

const labelLayers = [
  {
    id: "label-country",
    type: "symbol" as const,
    source: "openmaptiles",
    "source-layer": "place",
    filter: ["==", "class", "country"],
    layout: {
      "text-field": "{name:latin}",
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 2, 10, 5, 14],
      "text-transform": "uppercase" as const,
      "text-letter-spacing": 0.15,
      "text-max-width": 8,
    },
    paint: {
      "text-color": gray[8],
      "text-halo-color": "rgba(0,0,0,0.8)",
      "text-halo-width": 1.5,
      "text-opacity": 0.85,
    },
  },
  {
    id: "label-city",
    type: "symbol" as const,
    source: "openmaptiles",
    "source-layer": "place",
    filter: ["==", "class", "city"],
    layout: {
      "text-field": "{name:latin}",
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 4, 9, 8, 13, 12, 16],
      "text-max-width": 8,
    },
    paint: {
      "text-color": gray[7],
      "text-halo-color": "rgba(0,0,0,0.8)",
      "text-halo-width": 1.2,
      "text-opacity": 0.8,
    },
    minzoom: 4,
  },
  {
    id: "label-town",
    type: "symbol" as const,
    source: "openmaptiles",
    "source-layer": "place",
    filter: ["==", "class", "town"],
    layout: {
      "text-field": "{name:latin}",
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 7, 8, 12, 12],
      "text-max-width": 8,
    },
    paint: {
      "text-color": gray[6],
      "text-halo-color": "rgba(0,0,0,0.8)",
      "text-halo-width": 1,
      "text-opacity": 0.7,
    },
    minzoom: 7,
  },
];

// ---- Dark style (default) ----
export const darkStyle: StyleSpecification = {
  version: 8,
  name: "Blip Dark",
  sources: vectorSource,
  glyphs,
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#0A0A0C" },
    },
    {
      id: "water",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "water",
      paint: { "fill-color": "#0E0E12" },
    },
    {
      id: "water-ocean",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "water",
      filter: ["==", "class", "ocean"],
      paint: { "fill-color": "#0C0C10" },
    },
    {
      id: "landcover",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landcover",
      paint: { "fill-color": gray[5], "fill-opacity": 0.6 },
    },
    {
      id: "landuse",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landuse",
      paint: { "fill-color": gray[4], "fill-opacity": 0.5 },
    },
    {
      id: "boundary-country",
      type: "line",
      source: "openmaptiles",
      "source-layer": "boundary",
      filter: ["all", ["==", "admin_level", 2], ["!=", "maritime", 1]],
      paint: { "line-color": gray[6], "line-width": 0.8, "line-opacity": 0.5 },
    },
    {
      id: "boundary-state",
      type: "line",
      source: "openmaptiles",
      "source-layer": "boundary",
      filter: ["==", "admin_level", 4],
      paint: { "line-color": gray[5], "line-width": 0.6, "line-opacity": 0.4, "line-dasharray": [3, 2] },
    },
    {
      id: "road-highway",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: ["==", "class", "motorway"],
      paint: {
        "line-color": gray[5],
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 10, 1.5, 14, 3],
        "line-opacity": 0.6,
      },
      minzoom: 5,
    },
    {
      id: "road-major",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: ["in", "class", "trunk", "primary"],
      paint: {
        "line-color": gray[4],
        "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.3, 12, 1, 14, 2],
        "line-opacity": 0.5,
      },
      minzoom: 7,
    },
    {
      id: "road-minor",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: ["in", "class", "secondary", "tertiary", "minor"],
      paint: {
        "line-color": gray[4],
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.2, 14, 1],
        "line-opacity": 0.4,
      },
      minzoom: 10,
    },
    {
      id: "building",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "building",
      paint: { "fill-color": gray[4], "fill-opacity": 0.5 },
      minzoom: 13,
    },
    ...(labelLayers as any[]),
  ],
};


// Default export
export default darkStyle;
