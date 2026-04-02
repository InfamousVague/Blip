import type { StyleSpecification } from "maplibre-gl";
import { getTileSource, getGlyphUrl, getOceanTileSource } from "./utils/offline-tiles";

const DEM_SOURCE = {
  "terrain-dem": {
    type: "raster-dem" as const,
    url: "https://demotiles.maplibre.org/terrain-tiles/tiles.json",
    tileSize: 256,
  },
};

/** Blip Atlas — elegant dark map with 3D terrain.
 *  Tile source is resolved dynamically: local PMTiles server if available, remote OpenFreeMap otherwise.
 */
export function buildAtlasStyle(): StyleSpecification {
  return {
    version: 8,
    name: "Blip Atlas",
    sources: {
      openmaptiles: getTileSource() as any,
      ...DEM_SOURCE,
      ...(getOceanTileSource() ? { "ocean-hybrid": getOceanTileSource() } : {}),
    } as any,
    glyphs: getGlyphUrl(),
    terrain: { source: "terrain-dem", exaggeration: 1.5 },
    layers: ([
      // Background (land) — grey with a hint of purple
      { id: "background", type: "background", paint: { "background-color": "#171620" } },

      // Hybrid ocean tiles — satellite imagery with land pre-masked to dark
      // Only available when local tile server is running (offline PMTiles)
      ...(getOceanTileSource() ? [{
        id: "ocean-hybrid", type: "raster", source: "ocean-hybrid",
        paint: {
          "raster-opacity": 1,
          "raster-brightness-min": 0,
          "raster-brightness-max": 1,
          "raster-saturation": 0.2,
        },
      }] : []),

      // Water — dark fill (covers ocean when no hybrid tiles, covers inland water always)
      {
        id: "water", type: "fill", source: "openmaptiles", "source-layer": "water",
        paint: { "fill-color": "#08070c", "fill-opacity": getOceanTileSource() ? 0 : 1 },
      },

      // Ocean override — transparent when hybrid tiles available, dark otherwise
      {
        id: "ocean", type: "fill", source: "openmaptiles", "source-layer": "water",
        filter: ["==", "class", "ocean"],
        paint: { "fill-color": "#0a090e", "fill-opacity": getOceanTileSource() ? 0 : 1 },
      },

      // Hillshade for depth
      {
        id: "hillshade", type: "hillshade", source: "terrain-dem",
        paint: {
          "hillshade-shadow-color": "#0a0914",
          "hillshade-highlight-color": "#1a1826",
          "hillshade-accent-color": "#13111a",
          "hillshade-exaggeration": 0.35,
        },
      },

      // Landcover (forests, vegetation) — very subtle
      {
        id: "landcover", type: "fill", source: "openmaptiles", "source-layer": "landcover",
        paint: { "fill-color": "#1c1a26", "fill-opacity": 0.5 },
      },

      // Landuse (urban, residential) — barely visible
      {
        id: "landuse", type: "fill", source: "openmaptiles", "source-layer": "landuse",
        paint: { "fill-color": "#1a1824", "fill-opacity": 0.4 },
      },

      // Coastline — thin subtle line, only at higher zooms
      {
        id: "coastline", type: "line", source: "openmaptiles", "source-layer": "water",
        minzoom: 3,
        paint: {
          "line-color": "#1e1c30",
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.1, 8, 0.3, 12, 0.6],
          "line-opacity": 0.3,
        },
      },

      // Country boundaries
      {
        id: "boundary-country", type: "line", source: "openmaptiles", "source-layer": "boundary",
        filter: ["==", "admin_level", 2],
        paint: {
          "line-color": "#3a3858",
          "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.4, 5, 1, 10, 1.5],
        },
      },

      // State/province boundaries (dashed)
      {
        id: "boundary-state", type: "line", source: "openmaptiles", "source-layer": "boundary",
        filter: ["==", "admin_level", 4],
        minzoom: 3,
        paint: {
          "line-color": "#403868",
          "line-width": 0.5,
          "line-dasharray": [3, 2],
        },
      },

      // Roads — highway
      {
        id: "road-highway", type: "line", source: "openmaptiles", "source-layer": "transportation",
        filter: ["==", "class", "motorway"],
        minzoom: 5,
        paint: {
          "line-color": "#2d2a3d",
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.3, 10, 1.5, 14, 3],
        },
      },

      // Roads — major
      {
        id: "road-major", type: "line", source: "openmaptiles", "source-layer": "transportation",
        filter: ["in", "class", "primary", "secondary", "trunk"],
        minzoom: 7,
        paint: {
          "line-color": "#262339",
          "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.2, 12, 1, 14, 2],
        },
      },

      // Roads — minor
      {
        id: "road-minor", type: "line", source: "openmaptiles", "source-layer": "transportation",
        filter: ["in", "class", "tertiary", "minor", "service"],
        minzoom: 10,
        paint: {
          "line-color": "#211e32",
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.1, 14, 1],
        },
      },

      // Buildings
      {
        id: "building", type: "fill", source: "openmaptiles", "source-layer": "building",
        minzoom: 13,
        paint: { "fill-color": "#1a1826", "fill-opacity": 0.5 },
      },

      // Country labels
      {
        id: "label-country", type: "symbol", source: "openmaptiles", "source-layer": "place",
        filter: ["==", "class", "country"],
        layout: {
          "text-field": "{name:latin}",
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 1, 10, 5, 14],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.15,
          "text-max-width": 8,
        },
        paint: {
          "text-color": "#5a5878",
          "text-halo-color": "#0c0a12",
          "text-halo-width": 1.5,
        },
      },

      // City labels
      {
        id: "label-city", type: "symbol", source: "openmaptiles", "source-layer": "place",
        filter: ["==", "class", "city"],
        minzoom: 3,
        layout: {
          "text-field": "{name:latin}",
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 3, 9, 8, 13],
          "text-max-width": 8,
        },
        paint: {
          "text-color": "#6a6888",
          "text-halo-color": "#0c0a12",
          "text-halo-width": 1.2,
        },
      },

      // Town labels
      {
        id: "label-town", type: "symbol", source: "openmaptiles", "source-layer": "place",
        filter: ["==", "class", "town"],
        minzoom: 6,
        layout: {
          "text-field": "{name:latin}",
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 6, 8, 10, 11],
          "text-max-width": 7,
        },
        paint: {
          "text-color": "#585670",
          "text-halo-color": "#0c0a12",
          "text-halo-width": 1,
        },
      },
    ]) as StyleSpecification["layers"],
  };
}
