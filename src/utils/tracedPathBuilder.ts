import { greatCircleDistance, arcHeight, interpolateArc } from "./arc-geometry";
import { getCachedRoute, buildRoutedPath } from "./cable-routing";
import type { TracedRoute } from "../types/connection";

// Known country centroid coordinates that GeoLite2 returns for ambiguous IPs.
// Hops at these locations are filtered out as they're not real geographic locations.
export const CENTROID_BLACKLIST: [number, number][] = [
  [-97.82, 37.75],   // United States center (Kansas)
  [-2.0, 54.0],      // United Kingdom center
  [2.0, 47.0],       // France center
  [10.0, 51.0],      // Germany center
  [12.5, 42.5],      // Italy center
  [138.0, 36.0],     // Japan center
  [134.0, -25.0],    // Australia center
  [-106.0, 56.0],    // Canada center
  [105.0, 35.0],     // China center
  [78.0, 22.0],      // India center
];
export const CENTROID_RADIUS_KM = 200; // How close to a centroid to be considered ambiguous

/** Build a 3D path from traced route hops.
 *  Each hop-to-hop segment is a smooth arc.
 *  Ocean crossings (>4000km) use submarine cable routing when available. */
export function buildTracedPath(
  source: [number, number],
  target: [number, number],
  traced: TracedRoute,
): { path: [number, number, number][]; usesCable: boolean } {
  // Collect candidate waypoints with valid coordinates
  const candidates: [number, number][] = [];
  for (const hop of traced.hops) {
    if (hop.lat != null && hop.lon != null) {
      candidates.push([hop.lon, hop.lat]);
    }
  }

  // Minimal hop filtering — only remove centroids and exact duplicates.
  // Every valid hop becomes a waypoint the arc passes through.
  const waypoints: [number, number][] = [[source[0], source[1]]];

  for (const pt of candidates) {
    const prev = waypoints[waypoints.length - 1];
    const distFromPrev = greatCircleDistance(prev[1], prev[0], pt[1], pt[0]);
    // Skip exact duplicates (within 30km of previous waypoint)
    if (distFromPrev < 30) continue;
    // Skip known country centroids (GeoIP mislocations)
    const isCentroid = CENTROID_BLACKLIST.some(
      ([cLon, cLat]) => greatCircleDistance(cLat, cLon, pt[1], pt[0]) < CENTROID_RADIUS_KM
    );
    if (isCentroid) continue;

    waypoints.push(pt);
  }

  // Always end the arc at the GeoIP target so it connects to the endpoint dot.
  // If the last traced hop is far from the target, the final segment will be a
  // low flat line (data already arrived, this is just GeoIP disagreement).
  waypoints.push([target[0], target[1]]);

  // Need at least one intermediate hop to be worth rendering as traced
  if (waypoints.length <= 2) return { path: [], usesCable: false };

  // Build path: arc per segment, cable routing for ocean crossings
  const path: [number, number, number][] = [];
  let usesCable = false;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i];
    const to = waypoints[i + 1];
    const dist = greatCircleDistance(from[1], from[0], to[1], to[0]);

    let segPoints: [number, number, number][];

    // Final segment from last traced hop to GeoIP endpoint — keep it flat/low
    // when there's a big discrepancy (GeoIP disagrees with traceroute)
    if (dist > 2000) {
      // Ocean crossing: try cable routing for transcontinental segments
      const cableRoute = getCachedRoute(from, to) || (dist > 5000 ? getCachedRoute(from, to, true) : null);
      if (cableRoute) {
        segPoints = buildRoutedPath(from, to, cableRoute);
        usesCable = true;
      } else {
        const numPoints = Math.max(20, Math.round(dist / 50));
        const h = arcHeight(dist) * 0.15;
        segPoints = interpolateArc(from, to, h, numPoints);
      }
    } else {
      // Normal land arc
      const numPoints = Math.max(20, Math.round(dist / 50));
      const h = arcHeight(dist) * 0.4;
      segPoints = interpolateArc(from, to, h, numPoints);
    }

    // Append, skip first point on subsequent segments to avoid duplicates
    for (let j = i === 0 ? 0 : 1; j < segPoints.length; j++) {
      path.push(segPoints[j]);
    }
  }

  return { path, usesCable };
}
