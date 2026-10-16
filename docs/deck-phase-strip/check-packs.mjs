/** Unchanged installed packs, through the established compiled-client/RPC renderer. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../..");
const results = [];
for (const setting of ["japanese-ship", "sky-airship"]) {
  const path = join(root, `docs/deck-settings/render-${setting}.png`);
  let saved;
  try { saved = readFileSync(path); } catch {}
  try {
    const hashes = [];
    for (const tree of ["before", "after"]) {
      execFileSync(process.execPath, ["docs/deck-settings/render.mjs", `?setting=${setting}`], {
        cwd: root, env: { ...process.env, PHASE_STRIP_REVIEW: "0", SHARK_REVIEW: "", RENDER_TREE: tree === "before" ? "main" : "branch" }, stdio: "inherit",
      });
      hashes.push(createHash("sha256").update(readFileSync(path)).digest("hex"));
    }
    assert.equal(hashes[0], hashes[1], `${setting} changed`);
    results.push({ setting, main: hashes[0], branch: hashes[1], identical: true });
  } finally { if (saved) writeFileSync(path, saved); else rmSync(path, { force: true }); }
}
const compiled = JSON.parse(readFileSync(join(root, "docs/ship-deck-canvas/.generated/compiled-inputs.json"), "utf8"));
writeFileSync(join(here, "unchanged-packs.json"), JSON.stringify({ ...compiled, captures: results }, null, 2) + "\n");
