const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const EARTH_RADIUS_KM = 6371;

/** Haversine great-circle distance in km */
export function greatCircleDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Map great-circle distance to arc height (0-1 range for deck.gl) */
export function arcHeight(distKm: number): number {
  // Nearly flat arcs — just enough curve to see they're arcs
  // ~100km → 0.002, ~1000km → 0.004, ~5000km → 0.006, ~15000km → 0.008
  const t = Math.min(distKm / 20000, 1);
  return 0.002 + 0.008 * Math.sqrt(t);
}

/**
 * Interpolate points along a quadratic bezier arc in geographic space.
 * Used for the draw-on animation (partial arc rendering).
 */
export function interpolateArc(
  source: [number, number], // [lon, lat]
  target: [number, number],
  height: number,
  numPoints: number
): [number, number, number][] {
  const points: [number, number, number][] = [];
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const p = pointOnArc(source, target, height, t);
    points.push(p);
  }
  return points;
}

/** Single point on a great-circle arc at parameter t (0-1), matching deck.gl's ArcLayer */
export function pointOnArc(
  source: [number, number], // [lon, lat]
  target: [number, number],
  height: number,
  t: number
): [number, number, number] {
  // Great-circle interpolation (slerp) to match deck.gl's greatCircle mode
  const lat1 = source[1] * DEG2RAD;
  const lon1 = source[0] * DEG2RAD;
  const lat2 = target[1] * DEG2RAD;
  const lon2 = target[0] * DEG2RAD;

  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2
  ));

  let lat: number, lon: number;
  if (d < 1e-6) {
    // Points are nearly identical — linear interpolation
    lon = source[0] + (target[0] - source[0]) * t;
    lat = source[1] + (target[1] - source[1]) * t;
  } else {
    const a = Math.sin((1 - t) * d) / Math.sin(d);
    const b = Math.sin(t * d) / Math.sin(d);
    const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
    const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
    const z = a * Math.sin(lat1) + b * Math.sin(lat2);
    lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * RAD2DEG;
    lon = Math.atan2(y, x) * RAD2DEG;
  }

  // Quadratic elevation — peaks at t=0.5
  const elevation = 4 * height * t * (1 - t);
  const altitudeMeters = elevation * 1_000_000;

  return [lon, lat, altitudeMeters];
}

/** Ease out cubic for smooth draw-on */
export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}
