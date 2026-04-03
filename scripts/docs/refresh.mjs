#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const steps = [
  { name: "Analyze repository", cmd: "node scripts/docs/analyze-repo.mjs" },
  { name: "Collect evidence", cmd: "node scripts/docs/collect-evidence.mjs" },
  { name: "Generate guide", cmd: "node scripts/docs/generate-book.mjs" },
];

for (const step of steps) {
  console.log(`\n== ${step.name} ==`);
  const run = spawnSync(step.cmd, { shell: true, stdio: "inherit" });
  if (run.status !== 0) {
    process.exit(run.status ?? 1);
  }
}

console.log("\nDocumentation refresh complete.");
