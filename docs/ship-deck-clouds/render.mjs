/**
 * The sky's clouds, in a real browser, from the bundle Paseo's own compiler makes (`node docs/ship-deck-canvas/compile.mjs`
 * first). Headless Edge, never a daemon, through the canvas harness's host and its fixture fleet.
 *
 * 1. **The day** — the whole deck at each sky's anchor and in the dusk-to-night fade, the clouds tinted with it.
 * 2. **The drift** — on the fake clock at night (no gull to move), the sky above the deck a minute apart: changed.
 * 3. **Reduced motion** — the same minute: the sky above the deck unchanged, pixel for pixel.
 * 4. **The pane** — a wide, short pane that fits the deck's height, where only the lowest lanes show; a
 *    fractional size at a fractional device scale; and the camera closed in on a sailor.
 *
 * Writes the pictures and `render-results.json` here.
 */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const canvasDocs = join(root, "docs/ship-deck-canvas");
const generated = join(canvasDocs, ".generated");
await mkdir(generated, { recursive: true });
const rootRequire = createRequire(join(root, "package.json"));
const harness = createRequire(join(root, "docs/board-list/package.json"));
const { build } = harness("esbuild");
const { chromium } = harness("playwright");

await build({
  entryPoints: [join(canvasDocs, "host.jsx")],
  outfile: join(generated, "clouds-host.js"),
  bundle: true,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "warning",
  plugins: [
    {
      name: "host",
      setup(builder) {
        builder.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: join(root, "docs/board-list/contracts.js") }));
        builder.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: join(canvasDocs, "stubs.jsx") }));
        builder.onResolve({ filter: /^(react|zod|@tanstack\/react-query)($|\/)/ }, (args) => ({ path: rootRequire.resolve(args.path) }));
        builder.onResolve({ filter: /^react-dom($|\/)/ }, (args) => ({ path: harness.resolve(args.path) }));
        builder.onResolve({ filter: /^react-native(-web)?$/ }, () => ({ path: harness.resolve("react-native-web") }));
      },
    },
  ],
});
await build({
  entryPoints: [join(root, "server/ship-deck.ts")],
  outfile: join(generated, "ship-deck-server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "warning",
});
const { readDeckArt, readDeckEngine, readDeckEnvironment, readDeckExtras } = await import(pathToFileURL(join(generated, "ship-deck-server.mjs")).href);
const served = {
  "/deck-engine.json": JSON.stringify(await readDeckEngine(async () => root)),
  "/deck-art.json": JSON.stringify(await readDeckArt(async () => root)),
  "/deck-environment.json": JSON.stringify(await readDeckEnvironment(async () => root)),
  "/deck-extras.json": JSON.stringify(await readDeckExtras(async () => root)),
};
const files = {
  "/host.js": join(generated, "clouds-host.js"),
  "/bundle/branch.js": join(generated, "branch.client.js"),
};
const page = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:Segoe UI,sans-serif}*{box-sizing:border-box}</style>
<div id="root"></div><script src="/host.js"></script>
<script>(async () => { const params = new URLSearchParams(location.search);
  const source = await (await fetch("/bundle/" + params.get("bundle") + ".js")).text(); window.mountPlugin(source, params); })();</script>`;
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://x").pathname;
  if (served[path] !== undefined) {
    response.setHeader("Content-Type", "application/json");
    response.end(served[path]);
  } else if (files[path] !== undefined) {
    response.setHeader("Content-Type", "application/javascript");
    response.end(await readFile(files[path]));
  } else {
    response.setHeader("Content-Type", "text/html");
    response.end(page);
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;

const results = {};
const errors = [];

async function open(browser, { theme = "dark", reducedMotion = "no-preference", fakeClock = false, time, viewport = { width: 1440, height: 900 }, scale = 2 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale, reducedMotion, timezoneId: "UTC" });
  const view = await context.newPage();
  view.on("pageerror", (error) => errors.push(`${theme}: ${error.message}`));
  view.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") errors.push(`${theme} console ${message.type()}: ${message.text()}`);
  });
  if (fakeClock) await view.clock.install({ time });
  else await view.clock.setFixedTime(time);
  await view.goto(`${origin}/?bundle=branch&theme=${theme}`);
  if (fakeClock) await view.clock.pauseAt((await view.evaluate(() => Date.now())) + 100);
  await until(view, fakeClock, () => [...document.querySelectorAll("div")].some((node) => node.textContent === "Deck"));
  await view.getByText("Deck", { exact: true }).click();
  await until(view, fakeClock, () => document.querySelector("canvas[data-firstmate-deck-motion]") !== null);
  await view.mouse.move(5, viewport.height - 20);
  await view.evaluate(() => document.activeElement?.blur());
  if (fakeClock) await view.clock.runFor(400);
  else await view.waitForTimeout(400);
  return view;
}

async function until(view, fakeClock, predicate, arg) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (await view.evaluate(predicate, arg)) return;
    if (fakeClock) await view.clock.runFor(50);
    else await view.waitForTimeout(50);
  }
  throw new Error(`timed out waiting for ${predicate}`);
}

const canvasBox = (view) =>
  view.evaluate(() => {
    const rect = document.querySelector("canvas[data-firstmate-deck]").getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
const canvasShot = async (view, path) => view.screenshot({ clip: await canvasBox(view), path: join(here, path) });
/** The sky above the deck's top row, across the canvas: nothing of the ship is in it but the masthead's tip. */
const skyShot = async (view) => {
  const box = await canvasBox(view);
  const top = await view.evaluate(() => {
    const { fit, dpr } = window.deckGrid();
    return fit.y / dpr;
  });
  assert(top > 40, "the pane shows sky above the deck");
  return view.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: Math.floor(top) } });
};
const sky = (view) => view.evaluate(() => document.querySelector("canvas[data-firstmate-deck]").getAttribute("data-firstmate-deck-sky"));
const motion = (view) => view.evaluate(() => document.querySelector("canvas[data-firstmate-deck]").getAttribute("data-firstmate-deck-motion"));

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  // 1. The day.
  results.day = {};
  for (const [name, time, theme] of [
    ["0530-dawn", "2026-10-14T05:30:00Z", "dark"],
    ["0800-morning", "2026-10-14T08:00:00Z", "light"],
    ["1200-midday", "2026-10-14T12:00:00Z", "dark"],
    ["1600-afternoon", "2026-10-14T16:00:00Z", "light"],
    ["1830-dusk", "2026-10-14T18:30:00Z", "dark"],
    ["2015-dusk-to-night", "2026-10-14T20:15:00Z", "dark"],
    ["0200-night", "2026-10-14T02:00:00Z", "dark"],
  ]) {
    const view = await open(browser, { theme, time: new Date(time) });
    await canvasShot(view, `sky-${name}.png`);
    results.day[name] = { sky: await sky(view), motion: await motion(view) };
    await view.context().close();
  }

  // 2. The drift: a minute at night, on the fake clock.
  {
    const view = await open(browser, { fakeClock: true, time: new Date("2026-10-14T23:00:00Z") });
    const before = await skyShot(view);
    await view.clock.runFor(60_000);
    const after = await skyShot(view);
    await canvasShot(view, "drift-night-after-a-minute.png");
    results.drift = { motion: await motion(view), skyChanged: !before.equals(after) };
    assert.equal(results.drift.motion, "full");
    assert(results.drift.skyChanged, "the clouds drift in a minute");
    await view.context().close();
  }

  // 3. Reduced motion: the same minute, nothing moves.
  {
    const view = await open(browser, { fakeClock: true, reducedMotion: "reduce", time: new Date("2026-10-14T23:00:00Z") });
    const before = await skyShot(view);
    await view.clock.runFor(60_000);
    const after = await skyShot(view);
    await canvasShot(view, "still-night.png");
    results.reducedMotion = { motion: await motion(view), skyChanged: !before.equals(after) };
    assert.equal(results.reducedMotion.motion, "still");
    assert.equal(results.reducedMotion.skyChanged, false, "the clouds hold still under reduced motion");
    await view.context().close();
  }

  // 4. The pane: wide and short, fractional, and the camera closed in.
  {
    const wide = await open(browser, { time: new Date("2026-10-14T12:00:00Z"), viewport: { width: 2300, height: 560 }, scale: 1 });
    await canvasShot(wide, "pane-wide-short.png");
    await wide.context().close();
    const odd = await open(browser, { time: new Date("2026-10-14T16:00:00Z"), viewport: { width: 1203, height: 911 }, scale: 1.25 });
    await canvasShot(odd, "pane-fractional.png");
    await odd.setViewportSize({ width: 1517, height: 703 });
    await odd.waitForTimeout(500);
    await canvasShot(odd, "pane-fractional-resized.png");
    await odd.context().close();
    const focused = await open(browser, { time: new Date("2026-10-14T12:00:00Z") });
    await focused.evaluate(() => document.querySelector("[aria-label^='Ship deck:']").focus());
    await focused.keyboard.press("ArrowRight");
    await focused.waitForTimeout(700);
    await canvasShot(focused, "focused.png");
    await focused.keyboard.press("Escape");
    await focused.waitForTimeout(700);
    await canvasShot(focused, "focused-back-out.png");
    await focused.context().close();
  }
} finally {
  await browser.close();
  server.close();
}

results.errors = errors;
await writeFile(join(here, "render-results.json"), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results, null, 2));
assert.deepEqual(errors, [], "no page errors or warnings");
