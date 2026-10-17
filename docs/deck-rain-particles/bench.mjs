import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../..");
const require = createRequire(join(root, "docs/board-list/package.json"));
const { build } = require("esbuild"), { chromium } = require("playwright");
const out = join(root, ".local/rain-evidence"); mkdirSync(out, { recursive: true });
const baseline = execFileSync("git", ["rev-parse", "origin/main"], { cwd: root, encoding: "utf8" }).trim();
const source = join(root, ".local/rain-harness/bench.js");
await build({ entryPoints: [join(here, "bench-client.mjs")], outfile: source, bundle: true, logLevel: "warning" });
const packs = {};
for (const setting of ["ship", "japanese-ship", "sky-airship", "ghost-ship"]) for (const version of ["tile", "precip"]) {
  const prefix = `art/settings/${setting}/`;
  const read = (path) => version === "tile" ? execFileSync("git", ["show", `${baseline}:${prefix}${path}`], { cwd: root, maxBuffer: 3_000_000 }) : readFileSync(join(root, prefix, path));
  const manifest = JSON.parse(read("setting.json"));
  manifest.ambience = manifest.ambience.filter((element) => element.id === "rain" || element.id === "rain-spray");
  const ids = version === "precip" ? ["rain-drops"] : Object.keys(manifest.images).filter((id) => JSON.stringify(manifest.ambience).includes(`"${id}"`));
  packs[`${setting}:${version}`] = { manifest, images: Object.fromEntries(ids.map((id) => [id, read(manifest.images[id].path).toString("base64")])) };
}
const http = createServer((request, response) => {
  if (request.url === "/pixi.js") { response.setHeader("Content-Type", "text/javascript"); response.end(readFileSync(join(root, "vendor/pixi.min.js"))); }
  else if (request.url === "/bench.js") { response.setHeader("Content-Type", "text/javascript"); response.end(readFileSync(source)); }
  else response.end('<body style="margin:0"><script src="/pixi.js"></script><script src="/bench.js"></script></body>');
});
await new Promise((done) => http.listen(0, "127.0.0.1", done));
const results = [], errors = [];
const summary = (values) => { const sorted = [...values].sort((a,b) => a-b); return { mean: values.reduce((n,x)=>n+x,0)/values.length, p50: sorted[Math.floor(sorted.length*.5)], p95: sorted[Math.floor(sorted.length*.95)] }; };
try {
  for (const mode of ["full", "lite"]) {
    const browser = await chromium.launch({ channel: "msedge", headless: true, ...(mode === "lite" ? { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } : {}) });
    try {
      const view = await browser.newPage({ viewport: { width: 3840, height: 2160 }, deviceScaleFactor: 1 });
      view.on("pageerror", (error) => errors.push(error.message));
      await view.goto(`http://127.0.0.1:${http.address().port}`);
      for (const setting of ["ship", "japanese-ship", "sky-airship", "ghost-ship"]) {
        const all = { tile: [], precip: [] };
        for (let trial = 0; trial < 3; trial++) for (const version of trial % 2 ? ["precip", "tile"] : ["tile", "precip"]) {
          all[version].push(await view.evaluate((args) => window.benchRain(args), { ...packs[`${setting}:${version}`], mode, width: 3840, height: 2160 }));
        }
        for (const [version, batches] of Object.entries(all)) results.push({ setting, version, mode, renderer: batches[0].renderer, particles: batches[0].particles,
          frames: 180, submit: summary(batches.flatMap((batch) => batch.submit)), completed: summary(batches.flatMap((batch) => batch.samples)) });
        console.log(setting, mode, JSON.stringify(results.slice(-2)));
      }
    } finally { await browser.close(); }
  }
} finally { http.close(); }
if (errors.length) throw new Error(errors.join("\n"));
writeFileSync(join(out, "frame-times.json"), JSON.stringify({ baseline, width: 3840, height: 2160, scale: 4, method: "Isolated rain; same engine, scene art and world scale; 3 alternating batches, 30 warmup + 60 measured frames each; completed includes synchronous WebGL readback", results, errors }, null, 2)+"\n");
const rows = results.map((r)=>`| ${r.setting} | ${r.mode} | ${r.version} | ${r.particles} | ${r.submit.p50.toFixed(2)} | ${r.submit.p95.toFixed(2)} | ${r.completed.p50.toFixed(2)} | ${r.completed.p95.toFixed(2)} |`);
writeFileSync(join(out,"frame-times.md"), `4K pane, 180 measured frames per row. Baseline ${baseline}. CPU is update + render submission; completed includes synchronous GPU readback. Isolated rain cost, not whole-app latency.\n\n| Scene | Mode | Rain | Particles | CPU p50 ms | CPU p95 ms | Completed p50 ms | Completed p95 ms |\n|---|---|---|---:|---:|---:|---:|---:|\n${rows.join("\n")}\n`);
