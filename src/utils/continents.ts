/** Simple bounding-box continent lookup for transcontinental detection. */

type Continent = "NA" | "SA" | "EU" | "AF" | "AS" | "OC";

// Rough bounding boxes: [minLon, minLat, maxLon, maxLat]
const CONTINENT_BOXES: [Continent, number, number, number, number][] = [
  ["NA", -170, 15, -50, 72],
  ["SA", -82, -56, -34, 15],
  ["EU", -25, 35, 45, 72],
  ["AF", -18, -35, 52, 37],
  ["AS", 45, -10, 180, 72],
  ["OC", 110, -50, 180, 0],
];

export function getContinent(lat: number, lon: number): Continent | null {
  for (const [c, minLon, minLat, maxLon, maxLat] of CONTINENT_BOXES) {
    if (lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat) return c;
  }
  return null;
}

/** Returns true if two points are on different continents (or one is unknown). */
export function isTranscontinental(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): boolean {
  const c1 = getContinent(lat1, lon1);
  const c2 = getContinent(lat2, lon2);
  if (!c1 || !c2) return true; // unknown → assume transcontinental
  return c1 !== c2;
}
