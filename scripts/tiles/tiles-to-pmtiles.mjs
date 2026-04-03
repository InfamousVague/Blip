#!/usr/bin/env node
/**
 * Convert a directory of tiles ({z}/{x}/{y}.png) to a PMTiles archive.
 * Uses the pmtiles npm package directly.
 */

import fs from "fs";
import path from "path";
import { PMTiles } from "pmtiles";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const INPUT_DIR = process.argv[2] || path.join(ROOT, "src-tauri/resources/ocean-tiles");
const OUTPUT_MBTILES = path.join(ROOT, "src-tauri/resources/ocean.mbtiles");
const OUTPUT_PMTILES = path.join(ROOT, "src-tauri/resources/ocean.pmtiles");

// Create MBTiles database first (pmtiles CLI can convert this)
console.log("Creating MBTiles from tile directory...");

// Remove existing
if (fs.existsSync(OUTPUT_MBTILES)) fs.unlinkSync(OUTPUT_MBTILES);

const db = new Database(OUTPUT_MBTILES);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE metadata (name TEXT, value TEXT);
  CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
  CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);
`);

// MBTiles metadata
const meta = [
  ["name", "Blip Ocean"],
  ["format", "png"],
  ["type", "baselayer"],
  ["description", "Hybrid ocean tiles: satellite imagery for ocean, dark fill for land"],
  ["minzoom", "0"],
  ["maxzoom", "5"],
  ["bounds", "-180,-85,180,85"],
];
const insertMeta = db.prepare("INSERT INTO metadata (name, value) VALUES (?, ?)");
for (const [k, v] of meta) insertMeta.run(k, v);

// Insert tiles — MBTiles uses TMS y-flip: tms_y = (2^z - 1) - y
const insertTile = db.prepare("INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)");
let count = 0;

const insertMany = db.transaction((tiles) => {
  for (const { z, x, y, data } of tiles) {
    const tmsY = (1 << z) - 1 - y;
    insertTile.run(z, x, tmsY, data);
    count++;
  }
});

// Collect tiles per zoom
for (let z = 0; z <= 10; z++) {
  const zDir = path.join(INPUT_DIR, String(z));
  if (!fs.existsSync(zDir)) continue;

  const batch = [];
  for (const xDir of fs.readdirSync(zDir)) {
    const xPath = path.join(zDir, xDir);
    if (!fs.statSync(xPath).isDirectory()) continue;
    const x = parseInt(xDir);

    for (const yFile of fs.readdirSync(xPath)) {
      const y = parseInt(yFile);
      if (isNaN(y)) continue;
      const data = fs.readFileSync(path.join(xPath, yFile));
      batch.push({ z, x, y, data });
    }
  }
  if (batch.length > 0) {
    insertMany(batch);
    console.log(`  z${z}: ${batch.length} tiles`);
  }
}

db.close();
console.log(`MBTiles created: ${count} tiles → ${OUTPUT_MBTILES}`);
console.log(`Size: ${(fs.statSync(OUTPUT_MBTILES).size / 1048576).toFixed(1)} MB`);

// Now convert MBTiles to PMTiles
console.log("\nConverting to PMTiles...");
