#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "docs/generated");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "analysis.json");

const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "website/dist",
  "src-tauri/target",
  "native/blip-core/target",
]);

const KEY_PATHS = [
  "src",
  "src-tauri",
  "native",
  "website",
  "scripts",
  "public",
];

const ENTRYPOINTS = [
  "src/main.tsx",
  "src/App.tsx",
  "src/menubar.tsx",
  "src/MenuBarApp.tsx",
  "src-tauri/src/main.rs",
  "native/Blip/main.swift",
  "native/BlipNE/main.swift",
  "website/src/main.tsx",
];

function isExcluded(absPath) {
  const rel = path.relative(ROOT, absPath).replaceAll("\\", "/");
  if (rel.startsWith("..")) return true;
  if (rel === "") return false;
  for (const ex of EXCLUDED_DIRS) {
    if (rel === ex || rel.startsWith(`${ex}/`)) return true;
  }
  return false;
}

function walk(dir, out = []) {
  if (isExcluded(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, out);
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

function lineCount(absPath) {
  const text = fs.readFileSync(absPath, "utf8");
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

function topDirectory(relPath) {
  const normalized = relPath.replaceAll("\\", "/");
  const first = normalized.split("/")[0];
  return first || "(root)";
}

function safeStat(absPath) {
  try {
    return fs.statSync(absPath);
  } catch {
    return null;
  }
}

function listSubsystems() {
  const systems = [];
  for (const p of KEY_PATHS) {
    const abs = path.join(ROOT, p);
    const s = safeStat(abs);
    if (s?.isDirectory()) {
      systems.push(p);
    }
  }
  return systems;
}

function findTestLikeFiles(relFiles) {
  return relFiles
    .filter((f) => /(^|\/)(test|tests|spec|__tests__)|(-test\.|\.test\.|\.spec\.)/i.test(f))
    .sort();
}

function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const allFiles = walk(ROOT).sort();
  const relFiles = allFiles.map((f) => path.relative(ROOT, f).replaceAll("\\", "/"));

  const byExtension = {};
  const byTopDir = {};
  let totalLines = 0;

  for (const rel of relFiles) {
    const ext = path.extname(rel).toLowerCase() || "(no-ext)";
    byExtension[ext] = (byExtension[ext] || 0) + 1;

    const top = topDirectory(rel);
    byTopDir[top] = (byTopDir[top] || 0) + 1;

    const abs = path.join(ROOT, rel);
    // Skip binary-ish files by extension when counting lines.
    if (!/\.(png|jpg|jpeg|gif|icns|ico|mmdb|svg|webp|woff|woff2|ttf)$/i.test(rel)) {
      try {
        totalLines += lineCount(abs);
      } catch {
        // Ignore non-text files.
      }
    }
  }

  const analysis = {
    generatedAt: new Date().toISOString(),
    root: ROOT,
    totals: {
      files: relFiles.length,
      estimatedTextLines: totalLines,
    },
    subsystems: listSubsystems(),
    entrypoints: ENTRYPOINTS.filter((p) => fs.existsSync(path.join(ROOT, p))),
    testLikeFiles: findTestLikeFiles(relFiles),
    byExtension,
    byTopDirectory: byTopDir,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(analysis, null, 2) + "\n");
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH)}`);
}

main();
