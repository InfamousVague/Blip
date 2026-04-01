/**
 * Cable routing: find the best submarine cable for a transcontinental connection
 * and build a multi-segment path through it.
 */
import cableGeoJson from "../assets/submarine-cables.json";
import { greatCircleDistance, arcHeight, interpolateArc } from "./arc-geometry";
import { isTranscontinental } from "./continents";

// --- Types ---

interface Cable {
  id: string;
  name: string;
  /** Each sub-array is one continuous segment of the cable */
  segments: [number, number][][]; // [lon, lat][][]
}

export interface CableRoute {
  cableId: string;
  /** Closest point on cable to source [lon, lat] */
  sourceLanding: [number, number];
  /** Closest point on cable to destination [lon, lat] */
  destLanding: [number, number];
  /** The cable segment between the two points, [lon, lat][] */
  cableSegment: [number, number][];
}

// --- Parse data at module load ---

const cables: Cable[] = (cableGeoJson as any).features.map((f: any) => ({
  id: f.properties.id,
  name: f.properties.name,
  segments: f.geometry.coordinates as [number, number][][],
}));

// --- Spatial helpers ---

/** Fast squared-distance for sorting (avoids trig for rough comparisons) */
function roughDist2(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLon = lon1 - lon2;
  const dLat = lat1 - lat2;
  return dLon * dLon + dLat * dLat;
}

/** Find the closest point index on a polyline to a given point */
function closestIndexOnLine(
  lon: number,
  lat: number,
  coords: [number, number][]
): { index: number; dist2: number } {
  let bestIdx = 0;
  let bestD = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = roughDist2(lon, lat, coords[i][0], coords[i][1]);
    if (d < bestD) {
      bestD = d;
      bestIdx = i;
    }
  }
  return { index: bestIdx, dist2: bestD };
}

// --- Cable route finder ---

// Max distance² from source/dest to cable endpoint (~10° ≈ ~1100km at equator)
const SRC_THRESHOLD_2 = 100; // 10° squared — generous for source (user is inland)
const DST_THRESHOLD_2 = 100; // 10° squared — generous for destination too

// Minimum cable segment length in indices (avoid tiny or degenerate segments)
const MIN_SEGMENT_LEN = 3;

/**
 * Find the best submarine cable route between two points.
 * Directly matches cables to source/destination locations — no landing point intermediary.
 * Returns null if no suitable cable is found.
 */
export function findCableRoute(
  source: [number, number], // [lon, lat]
  target: [number, number]
): CableRoute | null {
  let bestRoute: CableRoute | null = null;
  let bestScore = Infinity;

  for (const cable of cables) {
    for (const segment of cable.segments) {
      if (segment.length < MIN_SEGMENT_LEN) continue;

      // Find closest point on this cable to source and destination
      const srcMatch = closestIndexOnLine(source[0], source[1], segment);
      if (srcMatch.dist2 > SRC_THRESHOLD_2) continue;

      const dstMatch = closestIndexOnLine(target[0], target[1], segment);
      if (dstMatch.dist2 > DST_THRESHOLD_2) continue;

      // Ensure source and destination hit different parts of the cable
      const idxGap = Math.abs(srcMatch.index - dstMatch.index);
      if (idxGap < MIN_SEGMENT_LEN) continue;

      // Score: prefer cables where the entry/exit points are closest to source/dest
      // Weight by cable segment length to prefer longer (more realistic) routes
      const score = srcMatch.dist2 + dstMatch.dist2;

      if (score < bestScore) {
        bestScore = score;

        // Extract the cable segment between the two match points
        const startIdx = Math.min(srcMatch.index, dstMatch.index);
        const endIdx = Math.max(srcMatch.index, dstMatch.index);
        let sliced = segment.slice(startIdx, endIdx + 1);

        // Ensure direction: source-end first
        if (srcMatch.index > dstMatch.index) {
          sliced = sliced.slice().reverse();
        }

        bestRoute = {
          cableId: cable.id,
          sourceLanding: sliced[0],
          destLanding: sliced[sliced.length - 1],
          cableSegment: sliced,
        };
      }
    }
  }

  return bestRoute;
}

// --- Path building ---

/** Low altitude for submarine cable segments — just above sea level */
const CABLE_ALTITUDE = 20_000; // 20km — just above the surface, below the arcs

/**
 * Build a routed 3D path: source → cable entry → cable → cable exit → destination
 */
export function buildRoutedPath(
  source: [number, number],   // [lon, lat] user location
  target: [number, number],   // [lon, lat] endpoint
  route: CableRoute
): [number, number, number][] {
  const path: [number, number, number][] = [];

  // --- Leg 1: source → cable entry (short arc) ---
  const srcLanding = route.sourceLanding;
  const srcDist = greatCircleDistance(source[1], source[0], srcLanding[1], srcLanding[0]);
  const srcHeight = arcHeight(srcDist) * 0.5; // lower arc for short leg
  const leg1 = interpolateArc(source, srcLanding, srcHeight, 10);
  for (const p of leg1) path.push(p);

  // --- Leg 2: cable segment (at low altitude) ---
  for (const coord of route.cableSegment) {
    path.push([coord[0], coord[1], CABLE_ALTITUDE]);
  }

  // --- Leg 3: cable exit → destination (short arc) ---
  const dstLanding = route.destLanding;
  const dstDist = greatCircleDistance(dstLanding[1], dstLanding[0], target[1], target[0]);
  const dstHeight = arcHeight(dstDist) * 0.5;
  const leg3 = interpolateArc(dstLanding, target, dstHeight, 10);
  for (const p of leg3) path.push(p);

  return path;
}

/**
 * Sample a position at parameter t (0-1) along a pre-computed path.
 * Linearly interpolates between path segments based on cumulative distance.
 */
export function pointAlongPath(
  path: [number, number, number][],
  t: number
): [number, number, number] {
  if (path.length === 0) return [0, 0, 0];
  if (path.length === 1 || t <= 0) return path[0];
  if (t >= 1) return path[path.length - 1];

  // Compute cumulative distances
  let totalLen = 0;
  const segLens: number[] = [];
  for (let i = 1; i < path.length; i++) {
    const dx = path[i][0] - path[i - 1][0];
    const dy = path[i][1] - path[i - 1][1];
    const len = Math.sqrt(dx * dx + dy * dy);
    segLens.push(len);
    totalLen += len;
  }

  if (totalLen === 0) return path[0];

  // Find the segment at parameter t
  const targetDist = t * totalLen;
  let accum = 0;
  for (let i = 0; i < segLens.length; i++) {
    if (accum + segLens[i] >= targetDist) {
      const frac = (targetDist - accum) / segLens[i];
      const a = path[i];
      const b = path[i + 1];
      return [
        a[0] + (b[0] - a[0]) * frac,
        a[1] + (b[1] - a[1]) * frac,
        a[2] + (b[2] - a[2]) * frac,
      ];
    }
    accum += segLens[i];
  }

  return path[path.length - 1];
}

// --- Route cache ---

const routeCache = new Map<string, CableRoute | null>();

/**
 * Get a cached cable route for a connection. Computes on first call per source/target pair.
 */
export function getCachedRoute(
  source: [number, number],
  target: [number, number]
): CableRoute | null {
  // Check if transcontinental first
  if (!isTranscontinental(source[1], source[0], target[1], target[0])) {
    return null;
  }

  const key = `${source[0].toFixed(1)},${source[1].toFixed(1)}-${target[0].toFixed(1)},${target[1].toFixed(1)}`;
  if (routeCache.has(key)) return routeCache.get(key)!;

  const route = findCableRoute(source, target);
  routeCache.set(key, route);
  return route;
}
