/**
 * Offline tile support via local HTTP server + pmtiles protocol.
 *
 * The Rust backend serves planet.pmtiles on a local HTTP port.
 * The pmtiles JS library handles range requests and tile extraction.
 * This works in both the main thread and Web Workers.
 */
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { invoke } from "@tauri-apps/api/core";

const REMOTE_TILE_URL = "https://tiles.openfreemap.org/planet";
const REMOTE_GLYPH_URL = "https://tiles.openfreemap.org/fonts";

let resolvedTileUrl: string | null = null;
let resolvedGlyphUrl: string | null = null;

/**
 * Register protocols and resolve the local tile server.
 * Call once before creating the Map.
 */
export async function registerOfflineProtocols() {
  // Register pmtiles protocol for the JS library
  const protocol = new Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);

  // Glyph protocol with offline fallback
  maplibregl.addProtocol("blip-fonts", async (params) => {
    const path = params.url.replace("blip-fonts://", "");
    const slashIdx = path.indexOf("/");
    const fontstack = decodeURIComponent(path.substring(0, slashIdx));
    const range = path.substring(slashIdx + 1).replace(".pbf", "");

    try {
      const base64Data: string = await invoke("get_offline_glyph", { fontstack, range });
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return { data: bytes.buffer };
    } catch {
      // fallback to remote
    }

    try {
      const url = `${REMOTE_GLYPH_URL}/${encodeURIComponent(fontstack)}/${range}.pbf`;
      const resp = await fetch(url);
      if (resp.ok) return { data: await resp.arrayBuffer() };
    } catch {
      // both failed
    }
    return { data: new ArrayBuffer(0) };
  });

  // Resolve the local tile server port
  try {
    // Wait briefly for the server to start
    await new Promise((r) => setTimeout(r, 500));
    const port: number = await invoke("get_tile_server_port");
    if (port > 0) {
      resolvedTileUrl = `pmtiles://http://127.0.0.1:${port}/planet.pmtiles`;
      resolvedGlyphUrl = "blip-fonts://{fontstack}/{range}.pbf";
      console.log("[tiles] Using local tile server on port", port);
    }
  } catch {
    console.log("[tiles] No local tile server — using remote tiles");
  }
}

/** Get the tile source config for the map style */
export function getTileSource(): Record<string, unknown> {
  if (resolvedTileUrl) {
    return {
      type: "vector",
      url: resolvedTileUrl,
    };
  }
  return {
    type: "vector",
    url: REMOTE_TILE_URL,
  };
}

/** Get the glyph URL for the map style */
export function getGlyphUrl(): string {
  return resolvedGlyphUrl || `${REMOTE_GLYPH_URL}/{fontstack}/{range}.pbf`;
}

/** Get the ocean satellite raster source config (local hybrid tiles or null) */
export function getOceanTileSource(): Record<string, unknown> | null {
  if (!resolvedTileUrl) return null;
  const base = resolvedTileUrl.replace("planet.pmtiles", "ocean.pmtiles");
  console.log("[tiles] Ocean tile source:", base);
  return {
    type: "raster",
    url: base,
    tileSize: 256,
    maxzoom: 7,
  };
}
