#!/usr/bin/env node
/**
 * Generate hybrid ocean tiles: satellite imagery for ocean, dark fill for land.
 * Uses Natural Earth land polygons (src/assets/land.json) as the coastline mask.
 *
 * Output: src-tauri/resources/ocean-tiles/{z}/{x}/{y}.png
 * Then run: pmtiles convert <dir> ocean.pmtiles
 *
 * Usage: node scripts/tiles/generate-ocean-tiles.mjs [--max-zoom 6]
 */

import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const LAND_JSON = path.join(ROOT, "src/assets/land-naturalearth.json");
const OUT_DIR = path.join(ROOT, "src-tauri/resources/ocean-tiles");

const TILE_SIZE = 256;
const LAND_COLOR = "#171620";
const MAX_ZOOM = parseInt(process.argv.find((a, i) => process.argv[i - 1] === "--max-zoom") || "7");
const SATELLITE_URL = "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile";
const CONCURRENCY = 16;

// --- Tile math ---

function tileToLonLat(x, y, z) {
  const n = Math.PI - (2 * Math.PI * y) / (1 << z);
  return [
    (x / (1 << z)) * 360 - 180,
    (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))),
  ];
}

function lonLatToPixel(lon, lat, z, tileX, tileY) {
  // Convert lon/lat to pixel position within a specific tile
  const scale = 1 << z;
  const worldX = ((lon + 180) / 360) * scale;
  const worldY =
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * scale;
  return [
    (worldX - tileX) * TILE_SIZE,
    (worldY - tileY) * TILE_SIZE,
  ];
}

// --- Load and simplify land polygons ---

function loadLandPolygons() {
  console.log("Loading land polygons...");
  const geojson = JSON.parse(fs.readFileSync(LAND_JSON, "utf8"));
  const polygons = [];
  for (const feature of geojson.features) {
    const geom = feature.geometry;
    if (geom.type === "Polygon") {
      polygons.push(geom.coordinates);
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates) {
        polygons.push(poly);
      }
    }
  }
  console.log(`Loaded ${polygons.length} land polygons`);
  return polygons;
}

// --- Render land mask as SVG for a specific tile ---

function renderLandMaskSVG(polygons, z, tileX, tileY) {
  const [west, north] = tileToLonLat(tileX, tileY, z);
  const [east, south] = tileToLonLat(tileX + 1, tileY + 1, z);

  let paths = "";
  for (const rings of polygons) {
    // Quick bounding box check — skip polygons completely outside this tile
    let polyMinLon = Infinity, polyMaxLon = -Infinity;
    let polyMinLat = Infinity, polyMaxLat = -Infinity;
    for (const coord of rings[0]) {
      if (coord[0] < polyMinLon) polyMinLon = coord[0];
      if (coord[0] > polyMaxLon) polyMaxLon = coord[0];
      if (coord[1] < polyMinLat) polyMinLat = coord[1];
      if (coord[1] > polyMaxLat) polyMaxLat = coord[1];
    }
    if (polyMaxLon < west || polyMinLon > east || polyMaxLat < south || polyMinLat > north) {
      continue;
    }

    for (const ring of rings) {
      let d = "";
      for (let i = 0; i < ring.length; i++) {
        const [px, py] = lonLatToPixel(ring[i][0], ring[i][1], z, tileX, tileY);
        d += i === 0 ? `M${px.toFixed(1)},${py.toFixed(1)}` : `L${px.toFixed(1)},${py.toFixed(1)}`;
      }
      d += "Z";
      paths += d + " ";
    }
  }

  if (!paths) return null; // No land in this tile

  // Each polygon as a separate path element to avoid fill-rule issues
  // with overlapping multi-polygon parts
  const pathElements = paths.split("Z ")
    .filter(p => p.trim())
    .map(p => `<path d="${p}Z" fill="${LAND_COLOR}" stroke="${LAND_COLOR}" stroke-width="3" stroke-linejoin="round"/>`)
    .join("\n    ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_SIZE}" height="${TILE_SIZE}" viewBox="0 0 ${TILE_SIZE} ${TILE_SIZE}">
    ${pathElements}
  </svg>`;
}

// --- Download satellite tile ---

async function downloadSatelliteTile(z, x, y) {
  const url = `${SATELLITE_URL}/${z}/${y}/${x}`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  return Buffer.from(await resp.arrayBuffer());
}

// --- Process a single tile ---

async function processTile(polygons, z, x, y) {
  const outPath = path.join(OUT_DIR, `${z}`, `${x}`, `${y}.png`);
  if (fs.existsSync(outPath)) return "skip";

  // Download satellite
  const satBuffer = await downloadSatelliteTile(z, x, y);
  if (!satBuffer) return "fail";

  // Slight darkening + desaturation to match Blip's dark theme
  // brightness 0.8 keeps the ocean visible, saturation 0.6 mutes colors
  let satellite = sharp(satBuffer)
    .resize(TILE_SIZE, TILE_SIZE)
    .modulate({ brightness: 0.8, saturation: 0.6 });

  // Render land mask
  const maskSvg = renderLandMaskSVG(polygons, z, x, y);

  let result;
  if (maskSvg) {
    // Composite: satellite underneath, land mask on top
    const maskBuffer = Buffer.from(maskSvg);
    result = await satellite
      .composite([{ input: maskBuffer, blend: "over" }])
      .png({ quality: 80, compressionLevel: 9 })
      .toBuffer();
  } else {
    // Pure ocean tile — just the darkened satellite
    result = await satellite.png({ quality: 80, compressionLevel: 9 }).toBuffer();
  }

  // Write output
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, result);
  return "ok";
}

// --- Main ---

async function main() {
  const polygons = loadLandPolygons();

  console.log(`Generating hybrid ocean tiles (zoom 0-${MAX_ZOOM}, ${TILE_SIZE}px)...`);
  console.log(`Output: ${OUT_DIR}`);
  console.log(`Satellite: ${SATELLITE_URL}`);
  console.log("");

  let total = 0;
  let done = 0;
  let skipped = 0;
  let failed = 0;

  // Count total tiles
  for (let z = 0; z <= MAX_ZOOM; z++) {
    total += (1 << z) * (1 << z);
  }
  console.log(`Total tiles to generate: ${total}`);

  for (let z = 0; z <= MAX_ZOOM; z++) {
    const size = 1 << z;
    const tiles = [];
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        tiles.push({ z, x, y });
      }
    }

    // Process in batches
    for (let i = 0; i < tiles.length; i += CONCURRENCY) {
      const batch = tiles.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map((t) => processTile(polygons, t.z, t.x, t.y))
      );
      for (const r of results) {
        if (r === "skip") skipped++;
        else if (r === "fail") failed++;
        done++;
      }
      process.stdout.write(`\r  z${z}: ${done}/${total} (${skipped} cached, ${failed} failed)`);
    }
  }

  console.log("\n\nDone! Now convert to PMTiles:");
  console.log(`  pmtiles convert ${OUT_DIR} src-tauri/resources/ocean.pmtiles`);
}

main().catch(console.error);
