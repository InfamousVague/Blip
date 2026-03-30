/**
 * Satellite raster tile fetcher with LRU WebGL texture cache.
 */

const TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const MAX_CACHE = 256;

interface CacheEntry {
  texture: WebGLTexture;
  lastUsed: number;
}

export class SatelliteTileCache {
  private gl: WebGLRenderingContext;
  private cache = new Map<string, CacheEntry>();
  private pending = new Map<string, HTMLImageElement>();
  private onTileLoaded: () => void;

  constructor(gl: WebGLRenderingContext, onTileLoaded: () => void) {
    this.gl = gl;
    this.onTileLoaded = onTileLoaded;
  }

  /** Returns cached texture or null (starts fetch if not cached). */
  getTile(z: number, x: number, y: number): WebGLTexture | null {
    const key = `${z}/${x}/${y}`;
    const entry = this.cache.get(key);
    if (entry) {
      entry.lastUsed = performance.now();
      return entry.texture;
    }
    if (!this.pending.has(key)) {
      this.fetchTile(z, x, y, key);
    }
    return null;
  }

  private fetchTile(z: number, x: number, y: number, key: string) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    this.pending.set(key, img);

    img.onload = () => {
      this.pending.delete(key);
      if (this.cache.size >= MAX_CACHE) this.evict();
      const texture = this.uploadTexture(img);
      this.cache.set(key, { texture, lastUsed: performance.now() });
      this.onTileLoaded();
    };

    img.onerror = () => {
      this.pending.delete(key);
    };

    img.src = TILE_URL.replace("{z}", String(z)).replace("{y}", String(y)).replace("{x}", String(x));
  }

  private uploadTexture(img: HTMLImageElement): WebGLTexture {
    const { gl } = this;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  private evict() {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of this.cache) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      const entry = this.cache.get(oldestKey)!;
      this.gl.deleteTexture(entry.texture);
      this.cache.delete(oldestKey);
    }
  }

  dispose() {
    for (const entry of this.cache.values()) {
      this.gl.deleteTexture(entry.texture);
    }
    this.cache.clear();
    // Cancel pending loads by clearing src
    for (const img of this.pending.values()) {
      img.src = "";
    }
    this.pending.clear();
  }
}

/** Compute visible tile coordinates for the current viewport. */
export function getVisibleTiles(map: maplibregl.Map): { z: number; x: number; y: number }[] {
  const z = Math.min(Math.floor(map.getZoom()), 18);
  if (z < 0) return [];
  const n = 1 << z;
  const bounds = map.getBounds();

  const lng2x = (lng: number) => Math.floor(((lng + 180) / 360) * n);
  const lat2y = (lat: number) => {
    const latRad = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  };

  const xMin = lng2x(bounds.getWest());
  const xMax = lng2x(bounds.getEast());
  const yMin = lat2y(bounds.getNorth()); // North = smaller y
  const yMax = lat2y(bounds.getSouth());

  const tiles: { z: number; x: number; y: number }[] = [];
  for (let y = Math.max(0, yMin); y <= Math.min(n - 1, yMax); y++) {
    for (let x = xMin; x <= xMax; x++) {
      tiles.push({ z, x: ((x % n) + n) % n, y });
    }
  }
  return tiles;
}

/** Convert tile z/x/y to Mercator top-left (x, y) and size. */
export function tileMercatorBounds(z: number, x: number, y: number): { tl: [number, number]; size: number } {
  const n = 1 << z;
  const size = 1 / n;
  return {
    tl: [x * size, y * size],
    size,
  };
}
