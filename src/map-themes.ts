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

/** Blip Atlas — elegant dark map with 3D terrain */
export function buildAtlasStyle(): StyleSpecification {
  return {
    version: 8,
    name: "Blip Atlas",
    sources: { ...VECTOR_SOURCE, ...DEM_SOURCE },
    glyphs: GLYPHS,
    terrain: { source: "terrain-dem", exaggeration: 1.5 },
    layers: [
      // Background (land) — grey with a hint of purple
      { id: "background", type: "background", paint: { "background-color": "#171620" } },

      // Water — coastal/inland (very dark, subdued)
      {
        id: "water", type: "fill", source: "openmaptiles", "source-layer": "water",
        paint: { "fill-color": "#08070c" },
      },

      // Ocean (near-black, minimal contrast with water)
      {
        id: "water-ocean", type: "fill", source: "openmaptiles", "source-layer": "water",
        filter: ["==", "class", "ocean"],
        paint: { "fill-color": "#0a090e" },
      },

      // Hillshade — 3D terrain shading from DEM
      {
        id: "hillshade", type: "hillshade", source: "terrain-dem",
        paint: {
          "hillshade-exaggeration": 0.35,
          "hillshade-shadow-color": "#08070e",
          "hillshade-highlight-color": "#232030",
          "hillshade-accent-color": "#10101a",
        },
      },

      // Landcover (forests, vegetation)
      {
        id: "landcover", type: "fill", source: "openmaptiles", "source-layer": "landcover",
        paint: { "fill-color": "#1c1a26", "fill-opacity": 0.5 },
      },

      // Landuse (urban areas)
      {
        id: "landuse", type: "fill", source: "openmaptiles", "source-layer": "landuse",
        paint: { "fill-color": "#1a1824", "fill-opacity": 0.4 },
      },

      // Coastline — subdued
      {
        id: "coastline", type: "line", source: "openmaptiles", "source-layer": "water",
        paint: {
          "line-color": "#2a2840",
          "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.8, 4, 1.2, 8, 2.0],
          "line-opacity": 0.3,
        },
      },

      // Country boundaries
      {
        id: "boundary-country", type: "line", source: "openmaptiles", "source-layer": "boundary",
        filter: ["all", ["==", "admin_level", 2], ["!=", "maritime", 1]],
        paint: { "line-color": "#3a3858", "line-width": 1.0, "line-opacity": 0.5 },
      },

      // State/province boundaries — more visible
      {
        id: "boundary-state", type: "line", source: "openmaptiles", "source-layer": "boundary",
        filter: ["==", "admin_level", 4],
        paint: { "line-color": "#403868", "line-width": 0.9, "line-opacity": 0.55, "line-dasharray": [3, 2] },
      },

      // Roads
      {
        id: "road-highway", type: "line", source: "openmaptiles", "source-layer": "transportation",
        filter: ["==", "class", "motorway"],
        paint: {
          "line-color": "#222038",
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 10, 1.5, 14, 3],
          "line-opacity": 0.45,
        },
        minzoom: 5,
      },
      {
        id: "road-major", type: "line", source: "openmaptiles", "source-layer": "transportation",
        filter: ["in", "class", "trunk", "primary"],
        paint: {
          "line-color": "#1c1a30",
          "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.3, 12, 1, 14, 2],
          "line-opacity": 0.35,
        },
        minzoom: 7,
      },
      {
        id: "road-minor", type: "line", source: "openmaptiles", "source-layer": "transportation",
        filter: ["in", "class", "secondary", "tertiary", "minor"],
        paint: {
          "line-color": "#1c1a30",
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.2, 14, 1],
          "line-opacity": 0.25,
        },
        minzoom: 10,
      },

      // Buildings
      {
        id: "building", type: "fill", source: "openmaptiles", "source-layer": "building",
        paint: { "fill-color": "#1a1826", "fill-opacity": 0.5 },
        minzoom: 13,
      },

      // Labels — country
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
          "text-color": "#6a6e90",
          "text-halo-color": "rgba(10,8,16,0.95)",
          "text-halo-width": 2,
          "text-opacity": 0.75,
        },
      },

      // Labels — city
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
          "text-color": "#585880",
          "text-halo-color": "rgba(10,8,16,0.95)",
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
          "text-color": "#484868",
          "text-halo-color": "rgba(10,8,16,0.95)",
          "text-halo-width": 1.2,
          "text-opacity": 0.55,
        },
        minzoom: 7,
      },
    ],
  } as StyleSpecification;
}
