import type { StyleSpecification } from "maplibre-gl";

const VECTOR_SOURCE = {
  openmaptiles: {
    type: "vector" as const,
    url: "https://tiles.openfreemap.org/planet",
  },
};

const DEM_SOURCE = {
  "terrain-dem": {
    type: "raster-dem" as const,
    url: "https://demotiles.maplibre.org/terrain-tiles/tiles.json",
    tileSize: 256,
  },
};

const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

/** Single atlas style — elegant dark map with 3D terrain */
export function buildAtlasStyle(): StyleSpecification {
  return {
    version: 8,
    name: "Blip Atlas",
    sources: { ...VECTOR_SOURCE, ...DEM_SOURCE },
    glyphs: GLYPHS,
    terrain: { source: "terrain-dem", exaggeration: 1.5 },
    layers: [
      // Background (land) — lighter blue-grey so it contrasts with dark water
      { id: "background", type: "background", paint: { "background-color": "#181a24" } },

      // Water — coastal/inland (deep dark)
      {
        id: "water", type: "fill", source: "openmaptiles", "source-layer": "water",
        paint: { "fill-color": "#06080e" },
      },

      // Ocean — open water (very slightly lighter than coastal)
      {
        id: "water-ocean", type: "fill", source: "openmaptiles", "source-layer": "water",
        filter: ["==", "class", "ocean"],
        paint: { "fill-color": "#080c14" },
      },

      // Hillshade — 3D terrain shading from DEM
      {
        id: "hillshade", type: "hillshade", source: "terrain-dem",
        paint: {
          "hillshade-exaggeration": 0.35,
          "hillshade-shadow-color": "#080a14",
          "hillshade-highlight-color": "#242838",
          "hillshade-accent-color": "#101420",
        },
      },

      // Landcover (forests, vegetation) — slightly different tone on land
      {
        id: "landcover", type: "fill", source: "openmaptiles", "source-layer": "landcover",
        paint: { "fill-color": "#1c1e28", "fill-opacity": 0.5 },
      },

      // Landuse (urban areas)
      {
        id: "landuse", type: "fill", source: "openmaptiles", "source-layer": "landuse",
        paint: { "fill-color": "#1a1c26", "fill-opacity": 0.4 },
      },

      // Coastline — bright edge where land meets water
      {
        id: "coastline", type: "line", source: "openmaptiles", "source-layer": "water",
        paint: {
          "line-color": "#3a4a70",
          "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.8, 4, 1.2, 8, 2.0],
          "line-opacity": 0.7,
        },
      },

      // Country boundaries
      {
        id: "boundary-country", type: "line", source: "openmaptiles", "source-layer": "boundary",
        filter: ["all", ["==", "admin_level", 2], ["!=", "maritime", 1]],
        paint: { "line-color": "#3a4060", "line-width": 1.0, "line-opacity": 0.5 },
      },

      // State/province boundaries — bumped up
      {
        id: "boundary-state", type: "line", source: "openmaptiles", "source-layer": "boundary",
        filter: ["==", "admin_level", 4],
        paint: { "line-color": "#2a3050", "line-width": 0.7, "line-opacity": 0.4, "line-dasharray": [3, 2] },
      },

      // Roads
      {
        id: "road-highway", type: "line", source: "openmaptiles", "source-layer": "transportation",
        filter: ["==", "class", "motorway"],
        paint: {
          "line-color": "#242840",
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 10, 1.5, 14, 3],
          "line-opacity": 0.45,
        },
        minzoom: 5,
      },
      {
        id: "road-major", type: "line", source: "openmaptiles", "source-layer": "transportation",
        filter: ["in", "class", "trunk", "primary"],
        paint: {
          "line-color": "#1e2238",
          "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.3, 12, 1, 14, 2],
          "line-opacity": 0.35,
        },
        minzoom: 7,
      },
      {
        id: "road-minor", type: "line", source: "openmaptiles", "source-layer": "transportation",
        filter: ["in", "class", "secondary", "tertiary", "minor"],
        paint: {
          "line-color": "#1e2238",
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.2, 14, 1],
          "line-opacity": 0.25,
        },
        minzoom: 10,
      },

      // Buildings
      {
        id: "building", type: "fill", source: "openmaptiles", "source-layer": "building",
        paint: { "fill-color": "#1a1e2a", "fill-opacity": 0.5 },
        minzoom: 13,
      },

      // Labels — country (brighter)
      {
        id: "label-country", type: "symbol", source: "openmaptiles", "source-layer": "place",
        filter: ["==", "class", "country"],
        layout: {
          "text-field": "{name:latin}",
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 2, 10, 5, 14],
          "text-transform": "uppercase" as const,
          "text-letter-spacing": 0.18,
          "text-max-width": 8,
        },
        paint: {
          "text-color": "#6a7aa0",
          "text-halo-color": "rgba(8,10,18,0.95)",
          "text-halo-width": 2,
          "text-opacity": 0.75,
        },
      },

      // Labels — city (brighter)
      {
        id: "label-city", type: "symbol", source: "openmaptiles", "source-layer": "place",
        filter: ["==", "class", "city"],
        layout: {
          "text-field": "{name:latin}",
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 4, 9, 8, 13, 12, 16],
          "text-letter-spacing": 0.05,
          "text-max-width": 8,
        },
        paint: {
          "text-color": "#5a6a90",
          "text-halo-color": "rgba(8,10,18,0.95)",
          "text-halo-width": 1.5,
          "text-opacity": 0.65,
        },
        minzoom: 4,
      },

      // Labels — town
      {
        id: "label-town", type: "symbol", source: "openmaptiles", "source-layer": "place",
        filter: ["==", "class", "town"],
        layout: {
          "text-field": "{name:latin}",
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 7, 8, 12, 12],
          "text-letter-spacing": 0.05,
          "text-max-width": 8,
        },
        paint: {
          "text-color": "#4a5a7a",
          "text-halo-color": "rgba(8,10,18,0.95)",
          "text-halo-width": 1.2,
          "text-opacity": 0.55,
        },
        minzoom: 7,
      },
    ],
  } as StyleSpecification;
}
