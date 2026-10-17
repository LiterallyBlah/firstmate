/** Run compile.mjs first. Uses the existing fixture host, without changing the frozen gate.
 * Output and synthetic files stay in ignored .local/deck-pack-budget/.
 * Fresh browser contexts measure cold client caches against a warm daemon pack cache.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crc32 } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = join(root, ".local/deck-pack-budget");
await mkdir(output, { recursive: true });
const generated = join(root, "docs/ship-deck-canvas/.generated");
const requireRoot = createRequire(join(root, "package.json"));
const harness = createRequire(join(root, "docs/board-list/package.json"));
const { build } = harness("esbuild");
const { chromium } = harness("playwright");
await build({ entryPoints: [join(root, "server/deck-settings.ts")], outfile: join(output, "server.mjs"), bundle: true, platform: "node", format: "esm", logLevel: "warning" });
const server = await import(pathToFileURL(join(output, "server.mjs")));
await build({ entryPoints: [join(root, "docs/deck-settings/host.jsx")], outfile: join(output, "host.js"), bundle: true, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning", plugins: [{
  name: "fixture-host", setup(builder) {
    builder.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: join(root, "docs/board-list/contracts.js") }));
    builder.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: join(root, "docs/deck-settings/stubs.jsx") }));
    builder.onResolve({ filter: /^(react|zod|@tanstack\/react-query)($|\/)/ }, (args) => ({ path: requireRoot.resolve(args.path) }));
    builder.onResolve({ filter: /^react-dom($|\/)/ }, (args) => ({ path: harness.resolve(args.path) }));
    builder.onResolve({ filter: /^react-native(-web)?$/ }, () => ({ path: harness.resolve("react-native-web") }));
  },
}] });

// Valid, random ancillary PNG data: increases transport/decode-input bytes, preserving pixels,
// dimensions and scene work. This is a byte-budget experiment, not a GPU/atlas capacity benchmark.
const base = await server.readDeckSetting("japanese-ship", async () => root);
const synthetic = structuredClone(base);
synthetic.manifest.id = "budget-fixture";
synthetic.manifest.name = "Budget fixture";
const rawBytes = (pack) => Object.values(pack.images).reduce((sum, image) => sum + Buffer.from(image, "base64").length, 0);
const images = Object.entries(synthetic.images);
let remaining = server.PACK_BYTES_MAX - rawBytes(base);
for (const [index, [id, encoded]] of images.entries()) {
  const extra = index === images.length - 1 ? remaining : Math.floor(remaining / (images.length - index));
  assert(extra >= 12);
  const png = Buffer.from(encoded, "base64");
  const chunk = Buffer.alloc(extra);
  chunk.writeUInt32BE(extra - 12);
  chunk.write("paDd", 4); // private ancillary safe-to-copy chunk
  randomBytes(extra - 12).copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), extra - 4);
  const padded = Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
  synthetic.images[id] = padded.toString("base64");
  synthetic.manifest.images[id].sha256 = createHash("sha256").update(padded).digest("hex");
  const file = join(output, "synthetic/art/settings/budget-fixture", synthetic.manifest.images[id].path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, padded);
  remaining -= extra;
}
await writeFile(join(output, "synthetic/art/settings/budget-fixture/setting.json"), JSON.stringify(synthetic.manifest));
const loaded = await server.readDeckSetting("budget-fixture", async () => join(output, "synthetic"));
assert.equal(rawBytes(loaded), server.PACK_BYTES_MAX);
const packs = new Map(await Promise.all(["ship", "japanese-ship", "sky-airship", "ghost-ship"].map(async (id) => [id, await server.readDeckSetting(id, async () => root)])));
packs.set("budget-fixture", loaded);
const summaries = [...await server.listDeckSettings(async () => root), ...await server.listDeckSettings(async () => join(output, "synthetic"))];
const engine = await server.readDeckEngine(async () => root);
// Observe completion of the real first render. The host and plugin bundle remain unchanged.
engine.source += `\n;const originalRender=PIXI.Application.prototype.render;PIXI.Application.prototype.render=function(...args){const result=originalRender.apply(this,args);if(window.firstDrawAt===undefined){window.firstDrawAt=performance.now();}return result;};`;
const measurements = [...packs].map(([id, pack]) => {
  const rpc = { type: "session", message: { type: "plugin.rpc.invoke.response", payload: { requestId: "00000000-0000-4000-8000-000000000000", output: pack } } };
  const jsonBytes = Buffer.byteLength(JSON.stringify(rpc));
  return { id, imageBytes: rawBytes(pack), jsonBytes, relayBytes: 4 * Math.ceil((jsonBytes + 40) / 3), samplesMs: [] };
});
const http = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://fixture").pathname;
    if (path.startsWith("/rpc/branch/")) {
      let body = "";
      for await (const chunk of request) body += chunk;
      const method = path.slice("/rpc/branch/".length);
      const answer = method === "firstmate.deck.engine" ? engine : method === "firstmate.deck.settings" ? summaries : packs.get(JSON.parse(body).id);
      assert(answer);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(answer));
    } else if (path === "/host.js" || path === "/bundle.js") {
      response.setHeader("content-type", "application/javascript");
      response.end(await readFile(path === "/host.js" ? join(output, "host.js") : join(generated, "branch.client.js")));
    } else {
      response.setHeader("content-type", "text/html");
      response.end(`<!doctype html><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}*{box-sizing:border-box}</style><div id="root"></div><script src="/host.js"></script><script>(async()=>{const source=await(await fetch('/bundle.js')).text();window.mountPlugin(source,new URLSearchParams(location.search));})();</script>`);
    }
  } catch (error) { response.statusCode = 500; response.end(String(error)); }
});
await new Promise((done) => http.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  // One warmup, then seven interleaved samples to reduce ordering bias.
  for (let round = -1; round < 7; round++) {
    for (const item of measurements) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce", timezoneId: "UTC" });
      const view = await context.newPage();
      const errors = [];
      view.on("pageerror", (error) => errors.push(error.message));
      await view.addInitScript(() => {
        const original = window.fetch;
        window.fetch = function(input, ...args) {
          if (String(input).endsWith("/firstmate.deck.setting") && window.packRequestAt === undefined) window.packRequestAt = performance.now();
          return original.call(this, input, ...args);
        };
      });
      await view.clock.setFixedTime(new Date("2026-10-14T12:00:00Z"));
      await view.goto(`http://127.0.0.1:${http.address().port}/?tree=branch&setting=${item.id}&working=4`);
      await view.getByRole("button", { name: "Open Deck", exact: true }).click();
      await view.waitForFunction(() => window.firstDrawAt !== undefined);
      assert.deepEqual(errors, []);
      assert.equal(await view.locator("canvas[data-firstmate-deck]").getAttribute("data-firstmate-deck-setting"), item.id);
      const ms = await view.evaluate(() => window.firstDrawAt - window.packRequestAt);
      assert(ms > 0);
      if (round >= 0) item.samplesMs.push(Math.round(ms * 10) / 10);
      if (round === 0) await view.locator("canvas[data-firstmate-deck]").screenshot({ path: join(output, `${item.id}.png`) });
      await context.close();
    }
    console.log(`measurement round ${round + 1}/7 complete`);
  }
  for (const item of measurements) {
    const sorted = [...item.samplesMs].sort((a, b) => a - b);
    item.medianMs = sorted[3];
    item.minMs = sorted[0];
    item.maxMs = sorted[6];
  }
  await writeFile(join(output, "measurements.json"), JSON.stringify({ browser: browser.version(), measurements }, null, 2) + "\n");
  console.log(JSON.stringify(measurements, null, 2));
} finally {
  await browser.close();
  await new Promise((done) => http.close(done));
}
