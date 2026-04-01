const DEG2RAD = Math.PI / 180;
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

/** Map great-circle distance to arc height factor */
export function arcHeight(distKm: number): number {
  // ~100km → 0.3, ~1000km → 0.7, ~5000km → 1.1, ~15000km → 1.4
  const t = Math.min(distKm / 20000, 1);
  return 0.2 + 1.3 * Math.sqrt(t);
}

/**
 * Interpolate points along a great-circle arc with altitude.
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

/**
 * Single point on an arc at parameter t (0-1).
 * Uses linear interpolation for the lat/lon path (straight line on flat Mercator),
 * then adds a quadratic Z-altitude envelope that peaks at t=0.5.
 */
export function pointOnArc(
  source: [number, number], // [lon, lat]
  target: [number, number],
  height: number,
  t: number
): [number, number, number] {
  // Linear interpolation — straight line on flat map
  const lon = source[0] + (target[0] - source[0]) * t;
  const lat = source[1] + (target[1] - source[1]) * t;

  // Quadratic elevation — peaks at t=0.5
  const bow = 4 * t * (1 - t);
  const altitudeMeters = bow * height * 1_000_000;

  return [lon, lat, altitudeMeters];
}

/** Initial bearing from point 1 to point 2, in radians (0 = north, clockwise). */
export function calculateBearing(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const φ1 = lat1 * DEG2RAD;
  const φ2 = lat2 * DEG2RAD;
  const Δλ = (lon2 - lon1) * DEG2RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return Math.atan2(y, x);
}

/** Ease out cubic for smooth draw-on */
export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}
