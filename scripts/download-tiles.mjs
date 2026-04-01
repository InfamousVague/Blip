#!/usr/bin/env node
/**
 * Download OpenFreeMap vector tiles at z0-z8 and save as MBTiles (SQLite).
 * Then convert to PMTiles using the pmtiles CLI.
 *
 * Usage: node scripts/download-tiles.mjs
 */

import { existsSync, mkdirSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import Database from "better-sqlite3";

// OpenFreeMap tile URL — fetch the TileJSON to get the current path
const TILEJSON_URL = "https://tiles.openfreemap.org/planet";
const MAX_ZOOM = 6;
const CONCURRENCY = 50;
const OUTPUT_MBTILES = "src-tauri/resources/planet.mbtiles";
const OUTPUT_PMTILES = "src-tauri/resources/planet.pmtiles";

async function getTileUrl() {
  const resp = await fetch(TILEJSON_URL);
  const json = await resp.json();
  // tiles array contains the URL template
  return json.tiles[0]; // e.g. "https://tiles.openfreemap.org/planet/20260325_001001_pt/{z}/{x}/{y}.pbf"
}

function countTiles(maxZoom) {
  let total = 0;
  for (let z = 0; z <= maxZoom; z++) {
    total += Math.pow(4, z);
  }
  return total;
}

function* generateTileCoords(maxZoom) {
  for (let z = 0; z <= maxZoom; z++) {
    const max = 1 << z;
    for (let x = 0; x < max; x++) {
      for (let y = 0; y < max; y++) {
        yield { z, x, y };
      }
    }
  }
}

// TMS y-flip: MBTiles uses TMS, where y is flipped
function tmsY(z, y) {
  return (1 << z) - 1 - y;
}

async function downloadTile(urlTemplate, z, x, y) {
  const url = urlTemplate
    .replace("{z}", z)
    .replace("{x}", x)
    .replace("{y}", y);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(url);
      if (resp.status === 404 || resp.status === 204) return null; // empty tile
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return Buffer.from(await resp.arrayBuffer());
    } catch (err) {
      if (attempt === 2) {
        console.error(`Failed z${z}/${x}/${y}: ${err.message}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

async function main() {
  console.log("Fetching tile URL template...");
  const urlTemplate = await getTileUrl();
  console.log(`Tile URL: ${urlTemplate}`);

  const totalTiles = countTiles(MAX_ZOOM);
  console.log(`Downloading ${totalTiles.toLocaleString()} tiles (z0-z${MAX_ZOOM})...`);

  // Create MBTiles SQLite database
  if (existsSync(OUTPUT_MBTILES)) unlinkSync(OUTPUT_MBTILES);

  // Use better-sqlite3 — check if available, otherwise use a simpler approach
  let db;
  try {
    const BetterSqlite3 = (await import("better-sqlite3")).default;
    db = new BetterSqlite3(OUTPUT_MBTILES);
  } catch {
    console.error("better-sqlite3 not found. Installing...");
    execSync("npm install --save-dev better-sqlite3", { stdio: "inherit" });
    const BetterSqlite3 = (await import("better-sqlite3")).default;
    db = new BetterSqlite3(OUTPUT_MBTILES);
  }

  db.exec(`
    CREATE TABLE metadata (name TEXT, value TEXT);
    CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
    CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);
  `);

  // Insert metadata
  const insertMeta = db.prepare("INSERT INTO metadata VALUES (?, ?)");
  insertMeta.run("name", "OpenFreeMap Planet");
  insertMeta.run("format", "pbf");
  insertMeta.run("type", "baselayer");
  insertMeta.run("minzoom", "0");
  insertMeta.run("maxzoom", String(MAX_ZOOM));

  const insertTile = db.prepare(
    "INSERT OR REPLACE INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)"
  );

  let downloaded = 0;
  let errors = 0;
  let bytes = 0;
  const startTime = Date.now();

  // Process in batches
  const coords = [...generateTileCoords(MAX_ZOOM)];
  const insertMany = db.transaction((batch) => {
    for (const { z, x, y, data } of batch) {
      insertTile.run(z, x, tmsY(z, y), data);
    }
  });

  for (let i = 0; i < coords.length; i += CONCURRENCY) {
    const batch = coords.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async ({ z, x, y }) => {
        const data = await downloadTile(urlTemplate, z, x, y);
        return { z, x, y, data };
      })
    );

    const validResults = results.filter((r) => r.data !== null);
    insertMany(validResults);

    downloaded += batch.length;
    errors += batch.length - validResults.length;
    bytes += validResults.reduce((sum, r) => sum + r.data.length, 0);

    const elapsed = (Date.now() - startTime) / 1000;
    const rate = downloaded / elapsed;
    const eta = Math.round((totalTiles - downloaded) / rate);
    const mb = (bytes / 1024 / 1024).toFixed(1);

    process.stdout.write(
      `\r  ${downloaded.toLocaleString()}/${totalTiles.toLocaleString()} tiles | ${mb} MB | ${Math.round(rate)} tiles/s | ETA ${eta}s | ${errors} errors`
    );
  }

  db.close();
  console.log(`\n\nMBTiles created: ${OUTPUT_MBTILES} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);

  // Convert to PMTiles
  console.log("Converting to PMTiles...");
  if (existsSync(OUTPUT_PMTILES)) unlinkSync(OUTPUT_PMTILES);
  execSync(`pmtiles convert ${OUTPUT_MBTILES} ${OUTPUT_PMTILES}`, {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  // Clean up MBTiles
  unlinkSync(OUTPUT_MBTILES);
  console.log(`\nDone! Output: ${OUTPUT_PMTILES}`);
}

main().catch(console.error);
