/**
 * Idle crew at rest, in a real browser, from the bundles Paseo's own compiler makes
 * (`node docs/ship-deck-canvas/compile.mjs` first, which writes this branch's and origin/main's). Headless
 * Edge, never a daemon, through the canvas harness's host; `host.jsx` here crowds the fixture fleet with
 * sleepers (eleven idle beside five working, one waiting and four blocked).
 *
 * 1. **Before and after** — main's still deck and this branch's, the same crowded fleet: main's sleepers
 *    line the near rail in front of the stations; this branch's rest on the foredeck and at the foot of
 *    the quarterdeck stairs.
 * 2. **Every sailor in reach** — the pointer put on the middle of every sailor's badge, sleeper or not:
 *    the label names that sailor. A sleeper's label hangs below every sailor on deck and inside the
 *    canvas, so it covers none of them; anyone else's goes where it always went.
 * 3. **The walk** — on a moving deck, a working crewmate goes idle on the next poll and walks to the rest
 *    area, and a sleeper given work walks back to a station: found there by the pointer after the walk,
 *    and pictured mid-walk.
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
  outfile: join(generated, "rest-host.js"),
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
  "/host.js": join(generated, "rest-host.js"),
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

const results = { crowd: null, hover: [], walk: null };
const errors = [];

async function open(browser, { bundle = "branch", theme = "dark", scale = 2, reducedMotion = "reduce", time = "2026-10-14T12:00:00Z" }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: scale, reducedMotion, timezoneId: "UTC" });
  const view = await context.newPage();
  view.on("pageerror", (error) => errors.push(`${bundle}/${theme}: ${error.message}`));
  view.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") errors.push(`${bundle}/${theme} console ${message.type()}: ${message.text()}`);
  });
  await view.clock.setFixedTime(new Date(time));
  await view.goto(`${origin}/?bundle=${bundle}&theme=${theme}&crowd=1`);
  await until(view, () => [...document.querySelectorAll("div")].some((node) => node.textContent === "Deck"));
  await view.getByText("Deck", { exact: true }).click();
  await until(view, () => document.querySelector("canvas[data-firstmate-deck-motion]") !== null);
  await view.mouse.move(5, 880);
  await view.evaluate(() => document.activeElement?.blur());
  await view.waitForTimeout(400);
  return view;
}

async function until(view, predicate, arg, attempts = 400) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await view.evaluate(predicate, arg)) return;
    await view.waitForTimeout(50);
  }
  throw new Error(`timed out waiting for ${predicate}`);
}

const canvasBox = (view) =>
  view.evaluate(() => {
    const rect = document.querySelector("canvas[data-firstmate-deck]").getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
const canvasShot = async (view, path) => view.screenshot({ clip: await canvasBox(view), path: join(here, path) });
/** The label over the canvas: its words and where it is, or null. */
const label = (view) =>
  view.evaluate(() => {
    const node = document.querySelector("[data-testid=firstmate-deck-label]");
    if (node === null) return null;
    const rect = node.getBoundingClientRect();
    const words = [...node.querySelectorAll("div")].filter((each) => each.children.length === 0 && each.textContent !== "").map((each) => each.textContent);
    return { words, rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } };
  });
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Puts the pointer on `point` and waits for the label to name `title`; the label, or null if it never does. */
async function hoverFor(view, point, title) {
  await view.mouse.move(point.x, point.y);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const now = await label(view);
    if (now !== null && now.words[0] === title) return now;
    await view.waitForTimeout(50);
  }
  return null;
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  // 1. Before and after: the same crowded fleet on main's still deck and on this branch's.
  for (const bundle of ["main", "branch"]) {
    const view = await open(browser, { bundle });
    await canvasShot(view, `${bundle === "main" ? "before" : "after"}-crowd.png`);
    if (bundle === "branch") {
      await view.screenshot({ path: join(here, "deck-1440-dark-crowd.png") });
      const spots = await view.evaluate(() => window.deckSpots());
      const sleepers = spots.filter((spot) => spot.state === "idle");
      const awake = spots.filter((spot) => spot.state !== "idle");
      results.crowd = {
        counts: Object.fromEntries(["working", "waiting", "blocked", "idle"].map((state) => [state, spots.filter((spot) => spot.state === state).length])),
        sleepersAt: sleepers.map((spot) => `${spot.deck.x},${spot.deck.y}`),
        sleepersOverAwake: sleepers.flatMap((sleeper) => awake.filter((other) => overlaps(sleeper.box, other.box)).map((other) => `${sleeper.key} over ${other.key}`)),
        legend: await view.evaluate(() => document.body.textContent.includes("resting off watch")),
      };
      assert.equal(results.crowd.counts.idle, 11);
      assert.deepEqual(results.crowd.sleepersOverAwake, [], "no sleeper stands over a sailor at work");
      assert.equal(results.crowd.legend, true, "the legend says where the idle are");
    }
    await view.context().close();
  }
  {
    const light = await open(browser, { theme: "light", time: "2026-10-14T08:00:00Z" });
    await light.screenshot({ path: join(here, "deck-1440-light-crowd.png") });
    await light.context().close();
  }

  // 2. Every sailor in reach, by its badge; a sleeper's label over no sailor.
  {
    const view = await open(browser, {});
    const spots = await view.evaluate(() => window.deckSpots());
    const canvas = await canvasBox(view);
    for (const spot of spots) {
      const shown = await hoverFor(view, spot.badge, spot.title);
      const entry = { key: spot.key, state: spot.state, found: shown !== null };
      if (shown !== null) {
        entry.label = shown.rect;
        entry.insideCanvas =
          shown.rect.left >= canvas.x && shown.rect.right <= canvas.x + canvas.width && shown.rect.top >= canvas.y && shown.rect.bottom <= canvas.y + canvas.height;
        entry.covers = spots.filter((other) => overlaps(shown.rect, other.box)).map((other) => other.key);
      }
      results.hover.push(entry);
      assert(entry.found, `${spot.key} (${spot.state}) is found by its badge`);
      if (spot.state === "idle") {
        assert(entry.insideCanvas, `${spot.key}'s label is inside the canvas`);
        assert.deepEqual(entry.covers, [], `${spot.key}'s label covers no sailor`);
      }
    }
    // Pictures: a sleeper in the back row, its label under the rail; and one at work, its label over it.
    const backRow = spots.filter((spot) => spot.state === "idle").sort((a, b) => a.deck.y - b.deck.y)[0];
    await hoverFor(view, backRow.badge, backRow.title);
    await view.waitForTimeout(200);
    await canvasShot(view, "hover-sleeper.png");
    const worker = spots.find((spot) => spot.state === "working");
    await hoverFor(view, worker.badge, worker.title);
    await view.waitForTimeout(200);
    await canvasShot(view, "hover-working.png");
    await view.context().close();
  }

  // 3. The walk, on a moving deck: to rest, and back to work.
  {
    const view = await open(browser, { reducedMotion: "no-preference" });
    const before = await view.evaluate(() => window.deckSpots());
    const goer = before.find((spot) => spot.state === "working" && spot.key === "work-0") ?? before.find((spot) => spot.state === "working");
    const sleeper = before.find((spot) => spot.key === "rest-0");
    await view.evaluate(([one, other]) => (window.sleep(one), window.wake(other)), [goer.key, sleeper.key]);
    // The next poll (every five seconds) sets them walking at 32 deck px a second.
    await view.waitForTimeout(6500);
    await canvasShot(view, "walk-midway.png");
    await view.waitForTimeout(12000);
    await canvasShot(view, "walk-arrived.png");
    // Where the sailors stand now, from the same controller. Which spot of its place a walker took
    // depends on the walk's history, so each is looked for by the pointer at every spot its place has.
    const after = await view.evaluate(() => window.deckSpots());
    async function foundAmong(spots, title) {
      for (const spot of spots) {
        const shown = await hoverFor(view, spot.badge, title);
        if (shown !== null) return { deck: spot.deck, label: shown.rect };
      }
      return null;
    }
    const rested = await foundAmong(await view.evaluate(() => window.placeBadges("idle")), goer.title);
    const woken = await foundAmong(await view.evaluate(() => window.placeBadges("working")), sleeper.title);
    results.walk = {
      toRest: goer.key,
      from: goer.deck,
      restedAt: rested?.deck ?? null,
      restedLabelOverNoOne: rested !== null && after.every((spot) => !overlaps(rested.label, spot.box)),
      toWork: sleeper.key,
      wokeFrom: sleeper.deck,
      wokenAt: woken?.deck ?? null,
    };
    assert(rested !== null, `${goer.key} is found at a rest spot after the walk`);
    assert(results.walk.restedLabelOverNoOne, `${goer.key}'s label covers no sailor`);
    assert(woken !== null, `${sleeper.key} is found at a station after the walk`);
    await view.context().close();
  }
} finally {
  await browser.close();
  server.close();
}

results.errors = errors;
await writeFile(join(here, "render-results.json"), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify({ ...results, hover: results.hover.length }, null, 2));
assert.deepEqual(errors, [], "no page errors or warnings");
