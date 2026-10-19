/** Compare routing at main, the original PR and the current checkout. No daemon or installation. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = join(root, ".local/attention-deck/routes");
mkdirSync(out, { recursive: true });
const { build } = createRequire(join(root, "docs/board-list/package.json"))("esbuild");
const refs = { main: "2519564", original: "9698749", fixed: null };
const read = (ref, path) => ref === null ? readFileSync(join(root, path), "utf8")
  : execFileSync("git", ["show", `${ref}:${path}`], { cwd: root, encoding: "utf8", maxBuffer: 10_000_000 });
const versions = {};
for (const [name, ref] of Object.entries(refs)) {
  versions[name] = {};
  for (const instrumented of [false, true]) {
    const file = join(out, `${name}-${instrumented}.mjs`);
    await build({
      stdin: { contents: "export * from './client/deck-geometry'; export {compileStage} from './client/deck-stage';", resolveDir: root, loader: "ts" },
      outfile: file, bundle: true, platform: "node", format: "esm",
      plugins: [{ name: "revision", setup(b) {
        b.onLoad({ filter: /[/\\](client|shared)[/\\].*\.ts$/ }, ({ path }) => {
          let contents = read(ref, relative(root, path).replaceAll("\\", "/"));
          if (instrumented && path.endsWith("deck-geometry.ts")) {
            // Test-only source instrumentation, kept out of timing runs and the shipped engine.
            const insert = (needle, text) => {
              assert.equal(contents.split(needle).length, 2, `instrumentation anchor: ${needle}`);
              contents = contents.replace(needle, text);
            };
            insert("let inside = false;", "auditWork.polygons++; let inside = false;");
            insert("const [xi, yi]", "auditWork.edges++; const [xi, yi]");
            insert("const t = step / steps;", "auditWork.samples++; const t = step / steps;");
            insert("closed[cell] = 1;", "auditWork.expansions++; closed[cell] = 1;");
            contents = "export const auditWork = { polygons: 0, edges: 0, samples: 0, expansions: 0 };\n" + contents;
          }
          return { contents, loader: "ts" };
        });
      } }],
    });
    versions[name][instrumented ? "measured" : "timed"] = await import(pathToFileURL(file));
  }
}
const places = stage => [
  ...[...stage.zones.values()].flatMap(z => z.posts), { id: "entry", ...stage.entry },
  ...[...stage.exits.entries()].map(([id, e]) => ({ id, ...(e.kind === "sink" ? e.at : e.queue.at) })),
  ...(stage.firstMate ? [{ id: "firstMate", ...stage.firstMate }] : []),
];
const results = [];
function run(name, id, instrumented, round) {
  const m = versions[name][instrumented ? "measured" : "timed"];
  const stage = m.compileStage(JSON.parse(read(refs[name], `art/settings/${id}/setting.json`)));
  const points = places(stage), paths = [], work = m.auditWork;
  if (work) for (const key in work) work[key] = 0;
  let maxLength = 0, length = 0, routingMs = 0;
  const max = { expandedCells: 0, lineSamples: 0, failedSearches: 0 };
  for (const from of points) for (const to of points) {
    if (from.x === to.x && from.y === to.y) continue;
    const stats = { expandedCells: 0, lineSamples: 0, failedSearches: 0 };
    const start = performance.now();
    const path = m.findPath(stage.floor, from, to, instrumented ? stats : undefined);
    routingMs += performance.now() - start;
    paths.push(path);
    const distance = m.pathLength(from, path); length += distance; maxLength = Math.max(maxLength, distance);
    for (const key in max) max[key] = Math.max(max[key], stats[key]);
    if (instrumented) {
      const saved = { ...work };
      assert.deepEqual(path.at(-1), { x: to.x, y: to.y });
      const route = [from, ...path];
      for (let i = 0; i < route.length - 1; i++) assert(m.clearLine(stage.floor, route[i], route[i + 1]), `${id}: off floor`);
      for (let i = 0; i < route.length - 2; i++) for (let j = i + 2; j < route.length; j++) assert(!m.clearLine(stage.floor, route[i], route[j]), `${id}: avoidable corner`);
      Object.assign(work, saved); // Only findPath's work, not validation's.
    }
  }
  const result = { name, id, instrumented, round, places: points.length, routes: paths.length, routingMs,
    length, maxLength, ...(work ? { work: { ...work }, max } : {}),
    pathHash: createHash("sha256").update(JSON.stringify(paths)).digest("hex") };
  results.push(result);
  console.log(JSON.stringify(result));
  return result;
}
// Alternate order; first round is warm-up. Each pass starts with a fresh floor/grid cache.
for (let round = 0; round < 7; round++) {
  for (const name of round % 2 ? ["fixed", "original", "main"] : ["main", "original", "fixed"]) run(name, "ghost-ship", false, round);
}
run("main", "ghost-ship", true, 0);
for (const id of readdirSync(join(root, "art/settings"))) {
  const original = run("original", id, true, 0), fixed = run("fixed", id, true, 0);
  assert.equal(fixed.pathHash, original.pathHash, `${id}: route coordinates changed`);
}
writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2) + "\n");
