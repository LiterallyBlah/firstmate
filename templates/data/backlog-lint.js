#!/usr/bin/env node
// Use the daemon's exact strict observer instead of maintaining a divergent parser replica.
// A failed/offline daemon is an error, never a clean lint result. Unknown hosts remain problems
// until the observer can resolve them; local metadata and legacy dependency prose are additive.
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");
try {
  const response = JSON.parse(execFileSync(process.execPath, [join(__dirname, "../tools/workflow.mjs"), "lint", "--json"],
    { encoding: "utf8", windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }));
  if (!response.ok) throw new Error(response.error);
  console.log(JSON.stringify(response.result, null, 2));
  if (!response.result.valid || response.result.problems.length) process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
