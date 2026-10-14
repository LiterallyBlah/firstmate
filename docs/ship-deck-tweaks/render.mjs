/**
 * The deck's four tweaks — the sail, the wake, the crew's looks, the sailor at ease — in a real browser,
 * from the bundles Paseo's own compiler makes (`node docs/ship-deck-canvas/compile.mjs` first, which writes
 * this branch's and origin/main's). Headless Edge, never a daemon, through the canvas harness's host; the
 * daemon's four deck RPCs are answered with what `server/ship-deck.ts` reads from this checkout.
 *
 * 1. **Switch off** — the screen's DOM is main's, character for character, wide and narrow, and the extras
 *    are never asked for.
 * 2. **Depth, still** — a still deck (reduced motion) against an independent 2D composite of the hull, the
 *    sail, the crew in their looks and the depth pieces with the mast's occluder: every art pixel above the
 *    foam, outside the marks and the lanterns, matches. The sail stays on its rest frame.
 * 3. **Motion** — a moving deck: the sail's cloth changes between its two states, the water astern
 *    changes as the wake scrolls, at about 30 frames a second; an at-ease sailor's head and shoulders
 *    move while its legs stay where they are.
 * 4. **Before and after** — main's deck and this branch's, at the same noon, for the eye.
 *
 * Writes the screenshots and `render-results.json` here.
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
  entryPoints: [join(here, "host.jsx")],
  outfile: join(generated, "tweaks-host.js"),
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
  "/host.js": join(generated, "tweaks-host.js"),
  "/bundle/main.js": join(generated, "main.client.js"),
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

const results = { flagOff: [], still: null, motion: null, breath: null, extrasCalls: null };
const errors = [];

const COUNT_DRAWS = `(() => {
  window.deckDraws = 0;
  new MutationObserver((records) => {
    for (const record of records) if (record.attributeName === "data-firstmate-deck-motion") window.deckDraws += 1;
  }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-firstmate-deck-motion"] });
})();`;

async function open(browser, { bundle = "branch", deck = false, theme = "dark", width = 1440, scale = 1, reducedMotion = "no-preference", time = "2026-10-14T12:00:00Z", only = null, fakeClock = false }) {
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, deviceScaleFactor: scale, reducedMotion, timezoneId: "UTC" });
  const view = await context.newPage();
  view.fakeClock = fakeClock;
  view.on("pageerror", (error) => errors.push(`${bundle}/${theme}/${width}: ${error.message}`));
  view.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") errors.push(`${bundle}/${theme}/${width} console ${message.type()}: ${message.text()}`);
  });
  if (fakeClock) await view.clock.install({ time: new Date(time) });
  else await view.clock.setFixedTime(new Date(time));
  await view.addInitScript(COUNT_DRAWS);
  await view.goto(`${origin}/?bundle=${bundle}&theme=${theme}${deck ? "&deck=1" : ""}${only === null ? "" : `&only=${only}`}`);
  // An installed clock still flows with real time; paused, it moves only when `runFor` says.
  if (fakeClock) await view.clock.pauseAt((await view.evaluate(() => Date.now())) + 100);
  await until(view, () =>
    [...document.querySelectorAll("div")].some((node) => node.textContent === "Brief helper: coach prompt, skill and button" || node.textContent === "First mate" || node.textContent === "Deck"),
  );
  return view;
}

async function until(view, predicate, arg, attempts = 400) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await view.evaluate(predicate, arg)) return;
    // On a paused clock the page's own timers run only when told to.
    if (view.fakeClock === true) await view.clock.runFor(50);
    else await view.waitForTimeout(50);
  }
  throw new Error(`timed out waiting for ${predicate}`);
}

async function rootHtml(view) {
  const read = () => view.evaluate(() => document.getElementById("root").innerHTML);
  let previous = await read();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await view.waitForTimeout(250);
    const current = await read();
    if (current === previous) return current;
    previous = current;
  }
  throw new Error("the screen never settled");
}

async function openDeck(view, _fakeClock = false) {
  await view.getByText("Deck", { exact: true }).click();
  await until(view, () => document.querySelector("canvas[data-firstmate-deck-motion]") !== null);
  await view.mouse.move(5, 880);
  await view.evaluate(() => document.activeElement?.blur());
}

const canvasBox = (view) =>
  view.evaluate(() => {
    const rect = document.querySelector("canvas[data-firstmate-deck]").getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
const attribute = (view, name) => view.evaluate((name) => document.querySelector("canvas[data-firstmate-deck]").getAttribute(name), name);
const canvasShot = async (view, path) => view.screenshot({ clip: await canvasBox(view), ...(path === undefined ? {} : { path: join(here, path) }) });
/** A screenshot of `region` (CSS px from the canvas's corner). */
async function regionShot(view, region, path) {
  const canvas = await canvasBox(view);
  return view.screenshot({ clip: { x: canvas.x + region.x, y: canvas.y + region.y, width: region.width, height: region.height }, ...(path === undefined ? {} : { path: join(here, path) }) });
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  // 1. Off: the branch draws exactly what main draws, and never asks for the extras.
  for (const width of [1440, 390]) {
    const main = await open(browser, { bundle: "main", width });
    const branch = await open(browser, { bundle: "branch", width });
    const [mainHtml, branchHtml] = [await rootHtml(main), await rootHtml(branch)];
    const extrasCalls = await branch.evaluate(() => window.deckExtrasCalls);
    results.flagOff.push({ width, identical: mainHtml === branchHtml, characters: branchHtml.length, extrasCalls });
    assert.equal(branchHtml, mainHtml, `switch off at ${width}px: the DOM differs from main's`);
    assert.equal(extrasCalls, 0, "switch off: the extras are never asked for");
    await main.context().close();
    await branch.context().close();
  }

  // 2. Depth on a still deck: the screenshot against the independent composite, art pixel by art pixel.
  {
    const view = await open(browser, { deck: true, scale: 2, reducedMotion: "reduce" });
    await openDeck(view);
    await view.waitForTimeout(400);
    await view.screenshot({ path: join(here, "deck-1440-dark-noon.png") });
    const shot = await canvasShot(view, "still-noon.png");
    const reference = await view.evaluate(() => window.tweaksReference());
    // The screenshot is of the canvas alone, so its corner is the canvas's.
    const actual = await view.evaluate(([png, at]) => window.deckPixels(png, at), [shot.toString("base64"), { ...reference, origin: { left: 0, top: 0 } }]);
    const marked = (x, y) => reference.marks.some((mark) => Math.abs(x - mark.x) <= 9 && y - mark.y >= -3 && y - mark.y <= 3);
    const lit = (x, y) => reference.lanterns.some((lantern) => Math.abs(x - lantern.x) <= 10 && y - lantern.y >= -6 && y - lantern.y <= 14);
    const inSail = (x, y) => reference.sail !== null && x >= reference.sail.x && x < reference.sail.x + reference.sail.width && y >= reference.sail.y && y < reference.sail.y + reference.sail.height;
    let compared = 0;
    let sailCompared = 0;
    const mismatches = [];
    for (let y = 0; y < reference.foamTop; y += 1) {
      for (let x = 0; x < reference.width; x += 1) {
        const at = y * reference.width + x;
        if (reference.pixels[at * 4 + 3] !== 255 || marked(x, y) || lit(x, y)) continue;
        compared += 1;
        if (inSail(x, y)) sailCompared += 1;
        const want = reference.pixels.slice(at * 4, at * 4 + 3);
        const got = actual.slice(at * 3, at * 3 + 3);
        if (want.some((value, index) => Math.abs(value - got[index]) > 3)) mismatches.push({ x, y, want, got });
      }
    }
    const sailFrames = new Set();
    for (let second = 0; second < 3; second += 1) {
      sailFrames.add((await regionShot(view, await view.evaluate(() => window.tweakRegions().sail))).toString("base64"));
      await view.waitForTimeout(500);
    }
    results.still = {
      motion: await attribute(view, "data-firstmate-deck-motion"),
      artPixelsCompared: compared,
      sailPixelsCompared: sailCompared,
      matching: compared - mismatches.length,
      firstMismatches: mismatches.slice(0, 10),
      looks: reference.looks,
      drawOrder: reference.order,
      sailStillFrames: sailFrames.size,
    };
    assert.deepEqual(mismatches.slice(0, 10), [], `${mismatches.length} of ${compared} art pixels differ from the reference`);
    assert(sailCompared > 1500, `the sail is compared: ${sailCompared}`);
    assert.equal(sailFrames.size, 1, "under reduced motion the sail rests on one frame");
    assert(new Set(reference.looks.map((sailor) => sailor.look)).size >= 5, "the crew wear several looks");
    await regionShot(view, await view.evaluate(() => window.tweakRegions().stern), "stern-still.png");
    await view.context().close();
  }
  {
    const light = await open(browser, { deck: true, theme: "light", scale: 2, reducedMotion: "reduce", time: "2026-10-14T08:00:00Z" });
    await openDeck(light);
    await light.waitForTimeout(400);
    await light.screenshot({ path: join(here, "deck-1440-light-morning.png") });
    await light.context().close();
  }

  // 3. Motion: the sail billows, the wake scrolls, the frame cap holds, an at-ease sailor breathes.
  {
    const view = await open(browser, { deck: true, scale: 2 });
    await openDeck(view);
    await view.waitForTimeout(500);
    const regions = await view.evaluate(() => window.tweakRegions());
    const sail = new Set();
    const wake = new Set();
    for (let step = 0; step < 12; step += 1) {
      sail.add((await regionShot(view, regions.sail)).toString("base64"));
      wake.add((await regionShot(view, regions.wake)).toString("base64"));
      await view.waitForTimeout(300);
    }
    const drawsInASecond = await view.evaluate(
      () =>
        new Promise((done) => {
          const [draws, started] = [window.deckDraws, performance.now()];
          setTimeout(() => done(Math.round(((window.deckDraws - draws) * 1000) / (performance.now() - started))), 2000);
        }),
    );
    results.motion = { motion: await attribute(view, "data-firstmate-deck-motion"), sailStates: sail.size, wakeStates: wake.size, drawsInASecond };
    // The ship bobs, so the sail's region can show more than its two states; at least two, then.
    assert(sail.size >= 2, `the sail billows: ${sail.size} states seen`);
    assert(wake.size >= 6, `the wake moves: ${wake.size} states seen`);
    assert(drawsInASecond >= 20 && drawsInASecond <= 32, `about 30 frames a second: ${drawsInASecond}`);
    await canvasShot(view, "moving-noon.png");
    await regionShot(view, regions.stern, "stern-moving.png");
    await view.context().close();
  }
  {
    // The at-ease crew alone, so no shipmate hauling beside them moves through the boxes watched, on a
    // paused clock, so every frame is at a known moment. The ship's bob moves a sailor's head and legs
    // alike, so frames are grouped by how the legs look — the ship at one height — and a group whose
    // frames show the head two ways is a sailor that breathed with its feet still.
    const view = await open(browser, { deck: true, scale: 2, only: "idle", fakeClock: true });
    await openDeck(view, true);
    await view.clock.runFor(1000);
    const spots = await view.evaluate(() => window.idleSpots());
    assert(spots.length > 0, "the fixture has idle sailors");
    const STEP = 100;
    const frames = [];
    for (let step = 0; step < 100; step += 1) {
      const shot = (await canvasShot(view)).toString("base64");
      const samples = await view.evaluate(([png, boxes]) => window.artSample(png, boxes), [shot, spots.flatMap((spot) => [spot.art.head, spot.art.legs])]);
      frames.push(spots.map((_, index) => ({ head: samples[index * 2], legs: samples[index * 2 + 1] })));
      await view.clock.runFor(STEP);
    }
    const breath = spots.map((spot, index) => {
      const heads = new Map();
      for (const frame of frames) {
        const { legs, head } = frame[index];
        if (!heads.has(legs)) heads.set(legs, new Set());
        heads.get(legs).add(head);
      }
      return {
        key: spot.key,
        look: spot.look,
        legStates: heads.size,
        headStatesAtOneLegState: Math.max(...[...heads.values()].map((each) => each.size)),
      };
    });
    results.breath = breath;
    for (const each of breath) assert(each.headStatesAtOneLegState >= 2, `${each.key} breathes: its head settles while its legs stay`);
    // A close-up of one at ease, in and out: the first two frames with the same legs and different heads.
    const index = 0;
    search: for (let a = 0; a < frames.length; a += 1) {
      for (let b = a + 1; b < frames.length; b += 1) {
        if (frames[a][index].legs === frames[b][index].legs && frames[a][index].head !== frames[b][index].head) {
          results.breathPair = { fromMs: a * STEP, toMs: b * STEP };
          break search;
        }
      }
    }
    await view.context().close();
    // Played again to the two moments found, for the pictures.
    if (results.breathPair !== undefined) {
      const replay = await open(browser, { deck: true, scale: 2, only: "idle", fakeClock: true });
      await openDeck(replay, true);
      await replay.clock.runFor(1000 + results.breathPair.fromMs);
      await regionShot(replay, spots[index].whole, "at-ease-in.png");
      await replay.clock.runFor(results.breathPair.toMs - results.breathPair.fromMs);
      await regionShot(replay, spots[index].whole, "at-ease-out.png");
      await replay.context().close();
    }
  }

  // 4. Before and after, at noon: main's moving deck, and this branch's.
  for (const bundle of ["main", "branch"]) {
    const view = await open(browser, { bundle, deck: true, scale: 2, reducedMotion: "reduce" });
    await openDeck(view);
    await view.waitForTimeout(400);
    await canvasShot(view, `${bundle === "main" ? "before" : "after"}-still-noon.png`);
    if (bundle === "branch") results.extrasCalls = await view.evaluate(() => window.deckExtrasCalls);
    await view.context().close();
  }
} finally {
  await browser.close();
  server.close();
}

results.errors = errors;
await writeFile(join(here, "render-results.json"), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify({ ...results, still: { ...results.still, drawOrder: undefined } }, null, 2));
assert.deepEqual(errors, [], "no page errors or warnings");
