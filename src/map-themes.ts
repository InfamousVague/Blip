import type { StyleSpecification } from "maplibre-gl";

export type MapMode = "vector" | "satellite";

export interface MapTheme {
  name: string;
  bg: string;
  water: string;
  ocean: string;
  landcover: string;
  landcoverOpacity: number;
  landuse: string;
  landuseOpacity: number;
  boundary: string;
  boundaryState: string;
  road: string;
  roadMinor: string;
  building: string;
  labelCountry: string;
  labelCity: string;
  labelTown: string;
  haloColor: string;
}

const vectorSource = {
  openmaptiles: {
    type: "vector" as const,
    url: "https://tiles.openfreemap.org/planet",
  },
};


const glyphs = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

// Shared label layers (used by all modes)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function labelLayers(theme: MapTheme, haloWidth = 1): any[] {
  return [
    {
      id: "label-country", type: "symbol" as const, source: "openmaptiles", "source-layer": "place",
      filter: ["==", "class", "country"],
      layout: { "text-field": "{name:latin}", "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 2, 10, 5, 14], "text-transform": "uppercase" as const, "text-letter-spacing": 0.15, "text-max-width": 8 },
      paint: { "text-color": theme.labelCountry, "text-halo-color": theme.haloColor, "text-halo-width": 1.5 + haloWidth, "text-opacity": 0.6 },
    },
    {
      id: "label-city", type: "symbol" as const, source: "openmaptiles", "source-layer": "place",
      filter: ["==", "class", "city"],
      layout: { "text-field": "{name:latin}", "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 4, 9, 8, 13, 12, 16], "text-max-width": 8 },
      paint: { "text-color": theme.labelCity, "text-halo-color": theme.haloColor, "text-halo-width": 1.2 + haloWidth, "text-opacity": 0.5 },
      minzoom: 4,
    },
    {
      id: "label-town", type: "symbol" as const, source: "openmaptiles", "source-layer": "place",
      filter: ["==", "class", "town"],
      layout: { "text-field": "{name:latin}", "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 7, 8, 12, 12], "text-max-width": 8 },
      paint: { "text-color": theme.labelTown, "text-halo-color": theme.haloColor, "text-halo-width": 1 + haloWidth, "text-opacity": 0.4 },
      minzoom: 7,
    },
  ];
}

// Shared road + boundary layers
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function overlayLayers(theme: MapTheme): any[] {
  return [
    // Coastline — bright outline where land meets water
    { id: "coastline", type: "line" as const, source: "openmaptiles", "source-layer": "water", paint: { "line-color": theme.boundary, "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.5, 4, 1.0, 8, 1.5], "line-opacity": 0.5 } },
    // Country and state boundaries
    { id: "boundary-country", type: "line" as const, source: "openmaptiles", "source-layer": "boundary", filter: ["all", ["==", "admin_level", 2], ["!=", "maritime", 1]], paint: { "line-color": theme.boundary, "line-width": 0.8, "line-opacity": 0.4 } },
    { id: "boundary-state", type: "line" as const, source: "openmaptiles", "source-layer": "boundary", filter: ["==", "admin_level", 4], paint: { "line-color": theme.boundaryState, "line-width": 0.6, "line-opacity": 0.3, "line-dasharray": [3, 2] } },
    // Roads
    { id: "road-highway", type: "line" as const, source: "openmaptiles", "source-layer": "transportation", filter: ["==", "class", "motorway"], paint: { "line-color": theme.road, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 10, 1.5, 14, 3], "line-opacity": 0.5 }, minzoom: 5 },
    { id: "road-major", type: "line" as const, source: "openmaptiles", "source-layer": "transportation", filter: ["in", "class", "trunk", "primary"], paint: { "line-color": theme.roadMinor, "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.3, 12, 1, 14, 2], "line-opacity": 0.4 }, minzoom: 7 },
    { id: "road-minor", type: "line" as const, source: "openmaptiles", "source-layer": "transportation", filter: ["in", "class", "secondary", "tertiary", "minor"], paint: { "line-color": theme.roadMinor, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.2, 14, 1], "line-opacity": 0.3 }, minzoom: 10 },
  ];
}

/** Vector-only style (current default) */
export function buildMapStyle(theme: MapTheme, projection: "mercator" | "globe" = "mercator"): StyleSpecification {
  return {
    version: 8,
    name: `Blip ${theme.name}`,
    projection: { type: projection } as any,
    sources: vectorSource,
    glyphs,
    layers: [
      { id: "background", type: "background", paint: { "background-color": theme.bg } },
      { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water", paint: { "fill-color": theme.water } },
      { id: "water-ocean", type: "fill", source: "openmaptiles", "source-layer": "water", filter: ["==", "class", "ocean"], paint: { "fill-color": theme.ocean } },
      { id: "landcover", type: "fill", source: "openmaptiles", "source-layer": "landcover", paint: { "fill-color": theme.landcover, "fill-opacity": theme.landcoverOpacity } },
      { id: "landuse", type: "fill", source: "openmaptiles", "source-layer": "landuse", paint: { "fill-color": theme.landuse, "fill-opacity": theme.landuseOpacity } },
      ...overlayLayers(theme),
      { id: "building", type: "fill", source: "openmaptiles", "source-layer": "building", paint: { "fill-color": theme.building, "fill-opacity": 0.5 }, minzoom: 13 },
      ...labelLayers(theme),
    ],
  };
}


// ---- 10 Themes based on popular VS Code themes ----

export const themes: MapTheme[] = [
  {
    name: "Default Dark",
    bg: "#111114", water: "#060608", ocean: "#04040a",
    landcover: "#1a1a1e", landcoverOpacity: 0.6, landuse: "#161618", landuseOpacity: 0.5,
    boundary: "#333", boundaryState: "#2a2a2a", road: "#2a2a2a", roadMinor: "#222",
    building: "#1a1a1e", labelCountry: "#666", labelCity: "#555", labelTown: "#444",
    haloColor: "rgba(0,0,0,0.9)",
  },
  {
    name: "One Dark Pro",
    bg: "#282c34", water: "#14181e", ocean: "#10141a",
    landcover: "#2c313a", landcoverOpacity: 0.6, landuse: "#2a2f38", landuseOpacity: 0.5,
    boundary: "#4b5263", boundaryState: "#3e4452", road: "#3e4452", roadMinor: "#353b48",
    building: "#2c313a", labelCountry: "#abb2bf", labelCity: "#8a919d", labelTown: "#636d83",
    haloColor: "rgba(40,44,52,0.9)",
  },
  {
    name: "Dracula",
    bg: "#282a36", water: "#141520", ocean: "#10111a",
    landcover: "#2d2f3d", landcoverOpacity: 0.6, landuse: "#2a2c3a", landuseOpacity: 0.5,
    boundary: "#6272a4", boundaryState: "#4d5b86", road: "#4d5b86", roadMinor: "#3d4a6e",
    building: "#2d2f3d", labelCountry: "#bd93f9", labelCity: "#8be9fd", labelTown: "#6272a4",
    haloColor: "rgba(40,42,54,0.9)",
  },
  {
    name: "Monokai",
    bg: "#272822", water: "#1e1f1a", ocean: "#1a1b16",
    landcover: "#2d2e28", landcoverOpacity: 0.6, landuse: "#2a2b24", landuseOpacity: 0.5,
    boundary: "#75715e", boundaryState: "#5c5847", road: "#5c5847", roadMinor: "#49463a",
    building: "#2d2e28", labelCountry: "#f8f8f2", labelCity: "#a6e22e", labelTown: "#75715e",
    haloColor: "rgba(39,40,34,0.9)",
  },
  {
    name: "Nord",
    bg: "#2e3440", water: "#242933", ocean: "#20242d",
    landcover: "#333947", landcoverOpacity: 0.6, landuse: "#303644", landuseOpacity: 0.5,
    boundary: "#4c566a", boundaryState: "#434c5e", road: "#434c5e", roadMinor: "#3b4252",
    building: "#333947", labelCountry: "#88c0d0", labelCity: "#81a1c1", labelTown: "#5e81ac",
    haloColor: "rgba(46,52,64,0.9)",
  },
  {
    name: "Solarized Dark",
    bg: "#002b36", water: "#001f27", ocean: "#001a22",
    landcover: "#073642", landcoverOpacity: 0.6, landuse: "#04303c", landuseOpacity: 0.5,
    boundary: "#586e75", boundaryState: "#465a62", road: "#465a62", roadMinor: "#3a4e55",
    building: "#073642", labelCountry: "#93a1a1", labelCity: "#839496", labelTown: "#657b83",
    haloColor: "rgba(0,43,54,0.9)",
  },
  {
    name: "GitHub Dark",
    bg: "#0d1117", water: "#090c10", ocean: "#07090d",
    landcover: "#161b22", landcoverOpacity: 0.6, landuse: "#13171e", landuseOpacity: 0.5,
    boundary: "#30363d", boundaryState: "#272c33", road: "#272c33", roadMinor: "#21262d",
    building: "#161b22", labelCountry: "#c9d1d9", labelCity: "#8b949e", labelTown: "#6e7681",
    haloColor: "rgba(13,17,23,0.9)",
  },
  {
    name: "Tokyo Night",
    bg: "#1a1b26", water: "#13141e", ocean: "#10111a",
    landcover: "#1e1f2e", landcoverOpacity: 0.6, landuse: "#1c1d2b", landuseOpacity: 0.5,
    boundary: "#3b3d57", boundaryState: "#2f3147", road: "#2f3147", roadMinor: "#26283c",
    building: "#1e1f2e", labelCountry: "#7aa2f7", labelCity: "#bb9af7", labelTown: "#565f89",
    haloColor: "rgba(26,27,38,0.9)",
  },
  {
    name: "Catppuccin Mocha",
    bg: "#1e1e2e", water: "#171726", ocean: "#14141f",
    landcover: "#232334", landcoverOpacity: 0.6, landuse: "#202030", landuseOpacity: 0.5,
    boundary: "#45475a", boundaryState: "#3a3c4e", road: "#3a3c4e", roadMinor: "#313244",
    building: "#232334", labelCountry: "#cdd6f4", labelCity: "#89b4fa", labelTown: "#6c7086",
    haloColor: "rgba(30,30,46,0.9)",
  },
  {
    name: "Gruvbox Dark",
    bg: "#282828", water: "#1d1d1d", ocean: "#1a1a1a",
    landcover: "#2e2e2e", landcoverOpacity: 0.6, landuse: "#2b2b2b", landuseOpacity: 0.5,
    boundary: "#665c54", boundaryState: "#504945", road: "#504945", roadMinor: "#3c3836",
    building: "#2e2e2e", labelCountry: "#ebdbb2", labelCity: "#fabd2f", labelTown: "#928374",
    haloColor: "rgba(40,40,40,0.9)",
  },
  // ---- Monochrome variants ----
  {
    name: "Midnight",
    bg: "#080808", water: "#020204", ocean: "#010103",
    landcover: "#0e0e0e", landcoverOpacity: 0.7, landuse: "#0a0a0a", landuseOpacity: 0.6,
    boundary: "#222", boundaryState: "#1a1a1a", road: "#1a1a1a", roadMinor: "#141414",
    building: "#0e0e0e", labelCountry: "#555", labelCity: "#444", labelTown: "#333",
    haloColor: "rgba(0,0,0,0.9)",
  },
  {
    name: "Smoke",
    bg: "#141414", water: "#0f0f0f", ocean: "#0c0c0c",
    landcover: "#1e1e1e", landcoverOpacity: 0.7, landuse: "#1a1a1a", landuseOpacity: 0.6,
    boundary: "#3a3a3a", boundaryState: "#303030", road: "#303030", roadMinor: "#282828",
    building: "#1e1e1e", labelCountry: "#888", labelCity: "#777", labelTown: "#555",
    haloColor: "rgba(20,20,20,0.9)",
  },
  {
    name: "Slate",
    bg: "#121418", water: "#0d0f14", ocean: "#0a0c10",
    landcover: "#1a1c22", landcoverOpacity: 0.7, landuse: "#16181e", landuseOpacity: 0.6,
    boundary: "#2e3240", boundaryState: "#262a36", road: "#262a36", roadMinor: "#20242e",
    building: "#1a1c22", labelCountry: "#7080a0", labelCity: "#5a6a88", labelTown: "#445070",
    haloColor: "rgba(18,20,24,0.9)",
  },
  {
    name: "Navy",
    bg: "#0a0e1a", water: "#060a14", ocean: "#04080f",
    landcover: "#101626", landcoverOpacity: 0.7, landuse: "#0e1220", landuseOpacity: 0.6,
    boundary: "#1e2a44", boundaryState: "#18223a", road: "#18223a", roadMinor: "#141e32",
    building: "#101626", labelCountry: "#4466aa", labelCity: "#3a5890", labelTown: "#2e4878",
    haloColor: "rgba(10,14,26,0.9)",
  },
  {
    name: "Forest",
    bg: "#0a120a", water: "#060e06", ocean: "#040a04",
    landcover: "#101e10", landcoverOpacity: 0.7, landuse: "#0e1a0e", landuseOpacity: 0.6,
    boundary: "#1e3a1e", boundaryState: "#183018", road: "#183018", roadMinor: "#142814",
    building: "#101e10", labelCountry: "#448844", labelCity: "#3a7a3a", labelTown: "#2e6a2e",
    haloColor: "rgba(10,18,10,0.9)",
  },
  {
    name: "Wine",
    bg: "#140a0e", water: "#0e0608", ocean: "#0a0406",
    landcover: "#1e1014", landcoverOpacity: 0.7, landuse: "#1a0e12", landuseOpacity: 0.6,
    boundary: "#3a1e28", boundaryState: "#301822", road: "#301822", roadMinor: "#28141c",
    building: "#1e1014", labelCountry: "#aa4466", labelCity: "#903a58", labelTown: "#782e4a",
    haloColor: "rgba(20,10,14,0.9)",
  },
  {
    name: "Ember",
    bg: "#14100a", water: "#0e0a06", ocean: "#0a0804",
    landcover: "#1e1610", landcoverOpacity: 0.7, landuse: "#1a140e", landuseOpacity: 0.6,
    boundary: "#3a2a1e", boundaryState: "#302218", road: "#302218", roadMinor: "#281c14",
    building: "#1e1610", labelCountry: "#cc8844", labelCity: "#aa7038", labelTown: "#88582e",
    haloColor: "rgba(20,16,10,0.9)",
  },
  {
    name: "Arctic",
    bg: "#0e1418", water: "#0a1014", ocean: "#080c10",
    landcover: "#141e24", landcoverOpacity: 0.7, landuse: "#121a20", landuseOpacity: 0.6,
    boundary: "#2a3a44", boundaryState: "#22323c", road: "#22323c", roadMinor: "#1c2a34",
    building: "#141e24", labelCountry: "#66aacc", labelCity: "#5090b0", labelTown: "#407898",
    haloColor: "rgba(14,20,24,0.9)",
  },
  {
    name: "High Contrast",
    bg: "#000000", water: "#000810", ocean: "#000610",
    landcover: "#1a1a1a", landcoverOpacity: 0.8, landuse: "#151515", landuseOpacity: 0.7,
    boundary: "#555", boundaryState: "#444", road: "#444", roadMinor: "#333",
    building: "#1a1a1a", labelCountry: "#fff", labelCity: "#ddd", labelTown: "#aaa",
    haloColor: "rgba(0,0,0,0.95)",
  },
  {
    name: "Soft Light",
    bg: "#1a1a20", water: "#0e0e12", ocean: "#0a0a0e",
    landcover: "#242428", landcoverOpacity: 0.5, landuse: "#202024", landuseOpacity: 0.4,
    boundary: "#3e3e44", boundaryState: "#34343a", road: "#34343a", roadMinor: "#2c2c32",
    building: "#242428", labelCountry: "#9898a4", labelCity: "#808090", labelTown: "#68687a",
    haloColor: "rgba(26,26,32,0.9)",
  },
];

export function getThemeStyle(index: number, projection: "mercator" | "globe" = "mercator"): StyleSpecification {
  return buildMapStyle(themes[index % themes.length], projection);
}
