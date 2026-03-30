/**
 * Extracts water polygons from OpenMapTiles vector source and builds
 * a triangle-fan vertex buffer for stencil rendering.
 *
 * Uses the stencil-invert technique: each polygon ring is rendered as a
 * triangle fan from its first vertex. The INVERT stencil op correctly
 * fills concave polygons and handles holes (inner rings cancel outer).
 */

import { MercatorCoordinate } from "maplibre-gl";

export interface WaterMesh {
  /** Interleaved (x, y) mercator coordinates, 2 floats per vertex */
  vertices: Float32Array;
  /** Total number of vertices (vertices.length / 2) */
  vertexCount: number;
}

/**
 * Build a triangle-fan mesh from all water polygons currently loaded
 * in the map's vector source.
 */
export function buildWaterMesh(map: maplibregl.Map): WaterMesh {
  let features: maplibregl.GeoJSONFeature[];
  try {
    features = map.querySourceFeatures("openmaptiles", {
      sourceLayer: "water",
    });
  } catch {
    return { vertices: new Float32Array(0), vertexCount: 0 };
  }

  if (features.length === 0) {
    return { vertices: new Float32Array(0), vertexCount: 0 };
  }

  // Deduplicate by feature id (querySourceFeatures returns dupes from tile buffers)
  const seen = new Set<string | number>();
  const uniqueFeatures: maplibregl.GeoJSONFeature[] = [];
  for (const f of features) {
    const id = f.id ?? hashCoord(f);
    if (seen.has(id)) continue;
    seen.add(id);
    uniqueFeatures.push(f);
  }

  // Estimate vertex count for pre-allocation
  let totalTriangles = 0;
  for (const f of uniqueFeatures) {
    const geom = f.geometry;
    if (geom.type === "Polygon") {
      for (const ring of geom.coordinates) {
        if (ring.length >= 3) totalTriangles += ring.length - 2;
      }
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates) {
        for (const ring of poly) {
          if (ring.length >= 3) totalTriangles += ring.length - 2;
        }
      }
    }
  }

  // 3 vertices per triangle, 2 floats per vertex
  const buf = new Float32Array(totalTriangles * 3 * 2);
  let offset = 0;

  const writeFan = (ring: number[][]) => {
    if (ring.length < 3) return;
    const v0 = toMercator(ring[0]);
    for (let i = 1; i < ring.length - 1; i++) {
      const v1 = toMercator(ring[i]);
      const v2 = toMercator(ring[i + 1]);
      buf[offset++] = v0[0]; buf[offset++] = v0[1];
      buf[offset++] = v1[0]; buf[offset++] = v1[1];
      buf[offset++] = v2[0]; buf[offset++] = v2[1];
    }
  };

  for (const f of uniqueFeatures) {
    const geom = f.geometry;
    if (geom.type === "Polygon") {
      for (const ring of geom.coordinates) writeFan(ring);
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates) {
        for (const ring of poly) writeFan(ring);
      }
    }
  }

  const actualLen = offset;
  return {
    vertices: buf.subarray(0, actualLen),
    vertexCount: actualLen / 2,
  };
}

function toMercator(coord: number[]): [number, number] {
  const mc = MercatorCoordinate.fromLngLat({ lng: coord[0], lat: coord[1] });
  return [mc.x, mc.y];
}

function hashCoord(f: maplibregl.GeoJSONFeature): string {
  const geom = f.geometry;
  if (geom.type === "Polygon" && geom.coordinates[0]?.length > 0) {
    const c = geom.coordinates[0][0];
    return `${c[0].toFixed(6)},${c[1].toFixed(6)},${geom.coordinates[0].length}`;
  }
  if (geom.type === "MultiPolygon" && geom.coordinates[0]?.[0]?.length > 0) {
    const c = geom.coordinates[0][0][0];
    return `${c[0].toFixed(6)},${c[1].toFixed(6)},${geom.coordinates[0][0].length}`;
  }
  return Math.random().toString();
}
