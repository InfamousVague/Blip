/**
 * Offline tile protocol handlers for MapLibre.
 * Registers custom protocols that try loading tiles from bundled PMTiles
 * via Tauri commands, falling back to remote URLs when unavailable.
 */
import maplibregl from "maplibre-gl";
import { invoke } from "@tauri-apps/api/core";

const REMOTE_VECTOR_URL = "https://tiles.openfreemap.org/planet";
const REMOTE_GLYPH_URL = "https://tiles.openfreemap.org/fonts";

let vectorTileTemplate: string | null = null;

/** Fetch the current tile URL template from OpenFreeMap's TileJSON */
async function getRemoteTileUrl(): Promise<string | null> {
  if (vectorTileTemplate) return vectorTileTemplate;
  try {
    const resp = await fetch(REMOTE_VECTOR_URL);
    const json = await resp.json();
    vectorTileTemplate = json.tiles?.[0] ?? null;
    return vectorTileTemplate;
  } catch {
    return null;
  }
}

/**
 * Register custom MapLibre protocols for offline tile support.
 * Call this once before creating the Map.
 */
export function registerOfflineProtocols() {
  // Vector tile protocol: tries local PMTiles first, falls back to remote
  maplibregl.addProtocol("blip-tiles", async (params) => {
    // URL format: blip-tiles://source/z/x/y (e.g. blip-tiles://planet/4/8/5)
    const parts = params.url.replace("blip-tiles://", "").split("/");
    const source = parts[0];
    const z = parseInt(parts[1]);
    const x = parseInt(parts[2]);
    const y = parseInt(parts[3]);

    // Try local PMTiles first
    try {
      const base64Data: string = await invoke("get_offline_tile", { source, z, x, y });
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return { data: bytes.buffer };
    } catch {
      // Local tile not found — fall back to remote
    }

    // Try remote
    try {
      const template = await getRemoteTileUrl();
      if (template) {
        const url = template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
        const resp = await fetch(url);
        if (resp.ok) {
          const data = await resp.arrayBuffer();
          return { data };
        }
      }
    } catch {
      // Remote also failed
    }

    // Both failed — return empty
    return { data: new ArrayBuffer(0) };
  });

  // Glyph protocol: tries local bundled fonts first, falls back to remote
  maplibregl.addProtocol("blip-fonts", async (params) => {
    // URL format: blip-fonts://fontstack/range.pbf
    const path = params.url.replace("blip-fonts://", "");
    const slashIdx = path.indexOf("/");
    const fontstack = decodeURIComponent(path.substring(0, slashIdx));
    const range = path.substring(slashIdx + 1).replace(".pbf", "");

    // Try local bundled glyphs
    try {
      const base64Data: string = await invoke("get_offline_glyph", { fontstack, range });
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return { data: bytes.buffer };
    } catch {
      // Local glyph not found
    }

    // Fall back to remote
    try {
      const url = `${REMOTE_GLYPH_URL}/${encodeURIComponent(fontstack)}/${range}.pbf`;
      const resp = await fetch(url);
      if (resp.ok) {
        return { data: await resp.arrayBuffer() };
      }
    } catch {
      // Remote also failed
    }

    return { data: new ArrayBuffer(0) };
  });
}
