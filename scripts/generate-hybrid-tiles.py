#!/usr/bin/env python3
"""
Generate pre-composited hybrid tiles: satellite imagery on water, dark bg on land.
Uses OpenFreeMap vector tiles for water polygon detection and ESRI for satellite imagery.
At runtime, MapLibre overlays vector roads/labels on top of these raster tiles.
"""

import os
import sys
import time
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
import mapbox_vector_tile
from PIL import Image, ImageDraw

# Config
VECTOR_URL = "https://tiles.openfreemap.org/planet/tiles/{z}/{x}/{y}.pbf"
SAT_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src-tauri", "resources", "hybrid-tiles")
TILE_SIZE = 256
BG_COLOR = (10, 10, 14)  # dark theme bg
GREEN = (0, 255, 0)
MIN_ZOOM = 0
MAX_ZOOM = 8
MAX_WORKERS = 16
JPEG_QUALITY = 80

session = requests.Session()
session.headers["User-Agent"] = "Blip/1.0 tile-generator"


def fetch_water_polygons(z, x, y):
    """Fetch vector tile, extract water polygons as pixel coordinates."""
    url = VECTOR_URL.format(z=z, x=x, y=y)
    try:
        resp = session.get(url, timeout=15)
        if resp.status_code != 200 or len(resp.content) == 0:
            return []
        data = mapbox_vector_tile.decode(resp.content)
    except Exception:
        return []

    water = data.get("water", {})
    feats = water.get("features", [])
    if not feats:
        return []

    extent = 4096
    scale = TILE_SIZE / extent
    polygons = []

    for feat in feats:
        geom = feat.get("geometry", {})
        gtype = geom.get("type", "")
        coords = geom.get("coordinates", [])

        rings = []
        if gtype == "Polygon":
            rings = coords
        elif gtype == "MultiPolygon":
            for poly in coords:
                rings.extend(poly)

        for ring in rings:
            # MVT y-axis is flipped (0=top in MVT, but Pillow also has 0=top)
            # Actually MVT y increases upward, Pillow y increases downward → flip
            pts = [(int(p[0] * scale), TILE_SIZE - int(p[1] * scale)) for p in ring]
            if len(pts) >= 3:
                polygons.append(pts)

    return polygons


def fetch_satellite_tile(z, x, y):
    """Fetch a satellite tile as PIL Image."""
    url = SAT_URL.format(z=z, x=x, y=y)
    try:
        resp = session.get(url, timeout=15)
        if resp.status_code == 200 and len(resp.content) > 100:
            return Image.open(BytesIO(resp.content)).convert("RGB").resize((TILE_SIZE, TILE_SIZE))
    except Exception:
        pass
    return None


def generate_tile(z, x, y):
    """Generate a single hybrid tile."""
    out_path = os.path.join(OUTPUT_DIR, str(z), str(x), f"{y}.jpg")
    if os.path.exists(out_path):
        return "skip"

    # Get water polygons
    polygons = fetch_water_polygons(z, x, y)

    # If no water, save solid dark tile
    if not polygons:
        img = Image.new("RGB", (TILE_SIZE, TILE_SIZE), BG_COLOR)
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        img.save(out_path, "JPEG", quality=JPEG_QUALITY)
        return "land"

    # Render green water on dark bg
    mask_img = Image.new("RGB", (TILE_SIZE, TILE_SIZE), BG_COLOR)
    draw = ImageDraw.Draw(mask_img)
    for pts in polygons:
        draw.polygon(pts, fill=GREEN)

    # Fetch satellite tile
    sat_img = fetch_satellite_tile(z, x, y)
    if not sat_img:
        # No satellite, save dark tile
        img = Image.new("RGB", (TILE_SIZE, TILE_SIZE), BG_COLOR)
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        img.save(out_path, "JPEG", quality=JPEG_QUALITY)
        return "no_sat"

    # Chromakey composite: green → satellite, rest → keep
    mask_px = mask_img.load()
    sat_px = sat_img.load()
    result = Image.new("RGB", (TILE_SIZE, TILE_SIZE))
    result_px = result.load()

    for py in range(TILE_SIZE):
        for px in range(TILE_SIZE):
            r, g, b = mask_px[px, py]
            if g > 200 and r < 50 and b < 50:
                result_px[px, py] = sat_px[px, py]
            else:
                result_px[px, py] = (r, g, b)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    result.save(out_path, "JPEG", quality=JPEG_QUALITY)
    return "ok"


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    total = sum(2 ** (2 * z) for z in range(MIN_ZOOM, MAX_ZOOM + 1))
    print(f"Generating hybrid tiles z{MIN_ZOOM}-z{MAX_ZOOM}: {total:,} tiles")
    print(f"Output: {OUTPUT_DIR}")
    print()

    done = 0
    stats = {"ok": 0, "land": 0, "skip": 0, "no_sat": 0, "error": 0}
    start_time = time.time()

    for z in range(MIN_ZOOM, MAX_ZOOM + 1):
        n = 2 ** z
        zoom_tiles = n * n
        zoom_start = time.time()
        print(f"Zoom {z}: {zoom_tiles:,} tiles ({n}x{n})")

        tasks = []
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            for x in range(n):
                for y in range(n):
                    tasks.append(executor.submit(generate_tile, z, x, y))

            for future in as_completed(tasks):
                try:
                    result = future.result()
                    stats[result] = stats.get(result, 0) + 1
                except Exception:
                    stats["error"] += 1
                done += 1

                if done % 1000 == 0 or done == total:
                    elapsed = time.time() - start_time
                    rate = done / elapsed if elapsed > 0 else 0
                    eta = (total - done) / rate if rate > 0 else 0
                    print(f"  [{done:,}/{total:,}] {rate:.0f} tiles/s, ETA: {eta / 60:.0f}m | ok={stats['ok']} land={stats['land']} skip={stats['skip']}")

        zoom_elapsed = time.time() - zoom_start
        print(f"  Zoom {z} done in {zoom_elapsed:.1f}s")

    total_elapsed = time.time() - start_time
    total_size = sum(
        os.path.getsize(os.path.join(dp, f))
        for dp, _, filenames in os.walk(OUTPUT_DIR)
        for f in filenames
    )
    print(f"\nDone in {total_elapsed / 60:.1f}m")
    print(f"Total size: {total_size / 1024 / 1024:.0f} MB")
    print(f"Stats: {stats}")


if __name__ == "__main__":
    main()
