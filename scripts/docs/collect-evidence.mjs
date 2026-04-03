#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "docs/generated");
const LOG_DIR = path.join(OUTPUT_DIR, "logs");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "evidence.json");

const COMMANDS = [
  { id: "lint", cmd: "npm run lint", required: false },
  { id: "build-app", cmd: "npm run build", required: true },
  { id: "build-website", cmd: "npm run website:build", required: true },
  { id: "build-release", cmd: "make build", required: true },
];

if (process.env.BLIP_DOCS_RUN_FULL_MAKE_ALL === "1") {
  COMMANDS.push({ id: "release-pipeline", cmd: "make all", required: false });
}

function runCommand(entry) {
  const startedAt = Date.now();
  const run = spawnSync(entry.cmd, {
    cwd: ROOT,
    shell: true,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const endedAt = Date.now();

  const output = [run.stdout || "", run.stderr || ""].join("").trim();
  const logName = `${entry.id}.log`;
  const logPath = path.join(LOG_DIR, logName);
  fs.writeFileSync(logPath, output + "\n");

  return {
    id: entry.id,
    command: entry.cmd,
    required: entry.required,
    exitCode: run.status,
    ok: run.status === 0,
    durationMs: endedAt - startedAt,
    logPath: path.relative(ROOT, logPath).replaceAll("\\", "/"),
  };
}

function main() {
  fs.mkdirSync(LOG_DIR, { recursive: true });

  const startedAt = new Date().toISOString();
  const results = COMMANDS.map(runCommand);
  const endedAt = new Date().toISOString();

  const summary = {
    generatedAt: endedAt,
    startedAt,
    endedAt,
    allPassed: results.every((r) => r.ok || !r.required),
    requiredPassed: results.filter((r) => r.required).every((r) => r.ok),
    commands: results,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(summary, null, 2) + "\n");

  const failed = results.filter((r) => !r.ok && r.required);
  if (failed.length > 0) {
    console.error("Required evidence commands failed:");
    for (const f of failed) {
      console.error(`- ${f.id}: exit ${f.exitCode}`);
    }
    process.exit(1);
  }

  console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH)}`);
}

main();
