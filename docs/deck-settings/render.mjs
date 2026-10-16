/** Render one installed setting through the real compiled plugin. Use ?setting=<id> as the first argument
 * or SETTING=<id>; OVERLAY=1 adds the authoring overlay. Run compile.mjs first; requires Edge.
 */
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const generated = join(root, "docs/ship-deck-canvas/.generated");
const rootRequire = createRequire(join(root, "package.json"));
const harness = createRequire(join(root, "docs/board-list/package.json"));
const { build } = harness("esbuild");
const { chromium } = harness("playwright");
const params = new URLSearchParams(process.argv[2] ?? "");
const setting = process.env.SETTING ?? params.get("setting") ?? "ship";
if (!/^[a-z0-9-]+$/.test(setting)) throw new Error("invalid setting id");
const overlay = process.env.OVERLAY === "1" || params.get("overlay") === "1";

const hostPlugins = [
  {
    name: "host",
    setup(builder) {
      builder.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: join(root, "docs/board-list/contracts.js") }));
      builder.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: join(here, "stubs.jsx") }));
      builder.onResolve({ filter: /^(react|zod|@tanstack\/react-query)($|\/)/ }, (args) => ({ path: rootRequire.resolve(args.path) }));
      builder.onResolve({ filter: /^react-dom($|\/)/ }, (args) => ({ path: harness.resolve(args.path) }));
      builder.onResolve({ filter: /^react-native(-web)?$/ }, () => ({ path: harness.resolve("react-native-web") }));
    },
  },
];
await build({ entryPoints: [join(here, "host.jsx")], outfile: join(generated, "gate-host.js"), bundle: true, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning", plugins: hostPlugins });
await build({ entryPoints: [join(here, "overlay-draw.mjs")], outfile: join(generated, "overlay-draw.js"), bundle: true, logLevel: "warning", nodePaths: [join(root, "node_modules")] });
await build({ entryPoints: [join(root, "server/deck-settings.ts")], outfile: join(generated, "overlay-server.mjs"), bundle: true, platform: "node", format: "esm", nodePaths: [join(root, "node_modules")], logLevel: "warning" });
const server = await import(pathToFileURL(join(generated, "overlay-server.mjs")).href);
const at = async () => root;
const answers = {
  "firstmate.deck.engine": async () => {
    const engine = await server.readDeckEngine(at);
    // Read-only observer for animation review; the plugin and renderer run unmodified.
    if (process.env.CHECK_JAPANESE_MOTION !== "1" && process.env.WATERLINE_REVIEW !== "1") return engine;
    return { ...engine, source: engine.source + `\n;const init=PIXI.Application.prototype.init;PIXI.Application.prototype.init=async function(...args){await init.apply(this,args);globalThis.motionReviewApp=this;};` };
  },
  "firstmate.deck.settings": () => server.listDeckSettings(at),
  "firstmate.deck.setting": async (input) => {
    const pack = await server.readDeckSetting(input.id, at);
    if (process.env.SHARK_REVIEW !== "before") return pack;
    const { mainRevision } = JSON.parse(await readFile(join(generated, "compiled-inputs.json"), "utf8"));
    return { ...pack, manifest: JSON.parse(execFileSync("git", ["show", `${mainRevision}:art/settings/${input.id}/setting.json`], { cwd: root, encoding: "utf8" })) };
  },
};

const page = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:Segoe UI,sans-serif}*{box-sizing:border-box}</style>
<div id="root"></div><script src="/host.js"></script><script src="/overlay.js"></script>
<script>(async () => { const params = new URLSearchParams(location.search);
  const source = await (await fetch("/bundle/branch.js")).text(); window.mountPlugin(source, params); })();</script>`;
const http = createServer(async (request, response) => {
  const path = new URL(request.url, "http://x").pathname;
  const rpc = /^\/rpc\/branch\/([a-z.]+)$/.exec(path);
  try {
    if (rpc !== null) {
      let body = "";
      for await (const chunk of request) body += chunk;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(await answers[rpc[1]](JSON.parse(body || "{}"))));
    } else if (path === "/host.js" || path === "/overlay.js" || path === "/bundle/branch.js") {
      response.setHeader("Content-Type", "application/javascript");
      const file = { "/host.js": "gate-host.js", "/overlay.js": "overlay-draw.js", "/bundle/branch.js": "branch.client.js" }[path];
      response.end(await readFile(join(generated, process.env.SHARK_REVIEW === "before" && file === "branch.client.js" ? "main.client.js" : file)));
    } else {
      response.setHeader("Content-Type", "text/html");
      response.end(page);
    }
  } catch (error) {
    response.statusCode = 500;
    response.end(String(error?.stack ?? error));
  }
});
await new Promise((done) => http.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ channel: "msedge", headless: true, ...(process.env.CHECK_JAPANESE_LITE === "1" || process.env.WATERLINE_LITE === "1" ? { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: "reduce", timezoneId: "UTC" });
  const view = await context.newPage();
  const errors = [];
  view.on("pageerror", (error) => errors.push(error.message));
  await view.clock.setFixedTime(new Date("2026-10-14T12:00:00Z"));
  await view.goto(`http://127.0.0.1:${http.address().port}/?tree=branch&theme=dark&working=4&setting=${encodeURIComponent(setting)}${process.env.CHECK_SWITCHER === "1" || process.env.CHECK_JAPANESE === "1" ? "&persistScene=1" : ""}`);
  await view.getByRole("button", { name: "Open Deck", exact: true }).click();
  await view.waitForSelector("canvas[data-firstmate-deck-motion]");
  await view.waitForTimeout(800);
  const manifest = (await (await fetch(`http://127.0.0.1:${http.address().port}/rpc/branch/firstmate.deck.setting`, { method: "POST", body: JSON.stringify({ id: setting }) })).json()).manifest;
  const actual = await view.locator("canvas[data-firstmate-deck]").getAttribute("data-firstmate-deck-setting");
  if (actual !== setting) throw new Error(`requested ${setting}, but rendered ${actual}`);
  const drawn = overlay ? await view.evaluate((each) => window.drawOverlay(each), manifest) : null;
  const clip = await view.evaluate(() => {
    const rect = document.querySelector("canvas[data-firstmate-deck]").getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
  await view.screenshot({ path: join(here, `${overlay ? "overlay" : "render"}-${setting}.png`), clip });
  if (process.env.CHECK_SELECTION === "1") {
    await view.evaluate(() => window.selectDeckSetting("missing-pack-for-selection-check"));
    await view.getByRole("alert").filter({ hasText: "is not installed" }).waitFor();
    await view.waitForSelector('canvas[data-firstmate-deck-setting="ship"]');
    await view.evaluate((id) => window.selectDeckSetting(id), setting);
    await view.waitForFunction((id) => document.querySelector("canvas[data-firstmate-deck]")?.getAttribute("data-firstmate-deck-setting") === id && !document.querySelector('[role="alert"]'), setting);
    if (await view.locator("canvas[data-firstmate-deck]").count() !== 1) throw new Error("selection left more than one deck mounted");
  }
  if (process.env.CHECK_SWITCHER === "1") {
    const { checkSwitcher } = await import("../deck-scene-switcher/check.mjs");
    await checkSwitcher(view);
  }
  if (process.env.CHECK_OFFICE_WITHDRAWAL === "1") {
    const { checkOffice } = await import("../deck-fixes/check-office.mjs");
    await checkOffice(view);
  }
  if (process.env.CHECK_IDLE === "1") {
    const { checkIdle } = await import("../deck-enrichment/check-idle.mjs");
    await checkIdle(view, manifest);
  }
  if (process.env.CHECK_ATTENTION === "1") {
    const { checkAttention } = await import("../deck-enrichment/check-attention.mjs");
    await checkAttention(view, manifest);
  }
  if (process.env.SHARK_REVIEW) {
    const { checkSharkSuggestions } = await import("../deck-shark-suggestions/check.mjs");
    await checkSharkSuggestions(view, manifest, process.env.SHARK_REVIEW);
  }
  if (process.env.WATERLINE_REVIEW === "1") {
    const { checkWaterline } = await import("../deck-shark-suggestions/check-waterline.mjs");
    await checkWaterline(view, manifest);
  }
  if (process.env.CHECK_POLISH === "1") {
    const { checkPolish } = await import("../deck-enrichment/check-polish.mjs");
    await checkPolish(view, manifest);
  }
  if (process.env.CHECK_JAPANESE === "1") {
    const { checkJapaneseShip } = await import("../settings/japanese-ship/check-scene.mjs");
    await checkJapaneseShip(view, manifest);
  }
  if (process.env.CHECK_JAPANESE_LITE === "1") {
    const { checkJapaneseLite } = await import("../settings/japanese-ship/check-scene.mjs");
    await checkJapaneseLite(view);
  }
  if (process.env.CHECK_JAPANESE_MOTION === "1") {
    const { checkMotion } = await import("../settings/japanese-ship/check-motion.mjs");
    await checkMotion(view, manifest);
  }
  if (errors.length !== 0) throw new Error(errors.join("\n"));
  console.log(JSON.stringify({ setting: actual, overlay: drawn, selectionCheck: process.env.CHECK_SELECTION === "1", errors }));
} finally {
  await browser.close();
  http.close();
}
