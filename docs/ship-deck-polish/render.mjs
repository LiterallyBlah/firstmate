/**
 * The ship deck's polish in a real browser, from the bundles Paseo's own compiler makes
 * (`node docs/ship-deck-canvas/compile.mjs` first, which writes this branch's and origin/main's). Headless
 * Edge, never a daemon, through the canvas harness's host (`host.jsx` here adds what these checks read).
 *
 * 1. **Switch off** — the screen's DOM is main's, character for character, wide and narrow.
 * 2. **Resizing** — the chat's edge dragged a few pixels at a time at 2×, on main's bundle and this
 *    branch's: the ship's drawn width, read off each frame's screenshot by colour alone, against the
 *    canvas's. Main's jumps; this branch's follows the pane.
 * 3. **Hover** — the pointer put on every sailor of the fixture fleet: the label names the sailor under
 *    it, with its state in the board's words, and goes when the pointer leaves the canvas. Then once on
 *    a moving deck, on the real clock.
 * 4. **Badges** — the still deck in both themes, every sailor wearing its state's sign.
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
  outfile: join(generated, "polish-host.js"),
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
const { readDeckArt, readDeckEngine } = await import(pathToFileURL(join(generated, "ship-deck-server.mjs")).href);
const deckEngine = JSON.stringify(await readDeckEngine({ FIRSTMATE_SHIP_DECK: "1" }, async () => root));
const deckArt = JSON.stringify(await readDeckArt({ FIRSTMATE_SHIP_DECK: "1" }, async () => root));

const files = {
  "/host.js": join(generated, "polish-host.js"),
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
  if (path === "/deck-engine.json" || path === "/deck-art.json") {
    response.setHeader("Content-Type", "application/json");
    response.end(path === "/deck-engine.json" ? deckEngine : deckArt);
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
const now = new Date("2026-10-08T12:00:00.000Z");

const results = { flagOff: [], resize: {}, hover: null, hoverMoving: null, badges: [] };
const errors = [];

/** Counts the deck's draws: each one marks the canvas with the motion in force. */
const COUNT_DRAWS = `(() => {
  window.deckDraws = 0;
  new MutationObserver((records) => {
    for (const record of records) if (record.attributeName === "data-firstmate-deck-motion") window.deckDraws += 1;
  }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-firstmate-deck-motion"] });
})();`;

async function open(browser, { bundle = "branch", deck = false, theme = "dark", width = 1440, scale = 1, reducedMotion = "no-preference" }) {
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, deviceScaleFactor: scale, reducedMotion });
  const view = await context.newPage();
  view.on("pageerror", (error) => errors.push(`${bundle}/${theme}/${width}: ${error.message}`));
  view.on("console", (message) => {
    if (message.type() === "error") errors.push(`${bundle}/${theme}/${width} console: ${message.text()}`);
  });
  await view.clock.setFixedTime(now);
  await view.addInitScript(COUNT_DRAWS);
  await view.goto(`${origin}/?bundle=${bundle}&theme=${theme}${deck ? "&deck=1" : ""}`);
  await until(view, () =>
    [...document.querySelectorAll("div")].some((node) => node.textContent === "Brief helper: coach prompt, skill and button" || node.textContent === "First mate"),
  );
  return view;
}

async function until(view, predicate, arg) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (await view.evaluate(predicate, arg)) return;
    await view.waitForTimeout(50);
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

async function openDeck(view) {
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

const labelText = (view) =>
  view.evaluate(() => {
    const label = document.querySelector("[data-testid=firstmate-deck-label]");
    return label === null ? null : [...label.querySelectorAll("div")].filter((node) => node.children.length === 0 && node.textContent !== "").map((node) => node.textContent).join(" | ");
  });

/** The ship's drawn width against the canvas's, read off a screenshot of the canvas alone. */
async function measure(view) {
  const box = await canvasBox(view);
  const png = await view.screenshot({ clip: box });
  const extent = await view.evaluate((data) => window.shipExtent(data), png.toString("base64"));
  return { canvasCss: Math.round(box.width), ...extent, share: Math.round((extent.shipWidth / extent.canvasWidth) * 10000) / 10000 };
}

/** Drags the chat's edge from where it is by `steps`, measuring the ship after each. */
async function dragSweep(view, deltas) {
  const handle = view.getByRole("separator", { name: "Chat width" });
  const box = await handle.boundingBox();
  let x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await view.mouse.move(x, y);
  await view.mouse.down();
  const series = [];
  for (const delta of deltas) {
    x += delta;
    const before = await view.evaluate(() => window.deckDraws);
    await view.mouse.move(x, y, { steps: 2 });
    // A still deck draws once a change; give the ResizeObserver its frame.
    await view.waitForTimeout(120);
    const drew = (await view.evaluate(() => window.deckDraws)) - before;
    series.push({ ...(await measure(view)), drew });
  }
  await view.mouse.up();
  return series;
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  // 1. Off: the branch draws exactly what main draws.
  for (const width of [1440, 390]) {
    const main = await open(browser, { bundle: "main", width });
    const branch = await open(browser, { bundle: "branch", width });
    const [mainHtml, branchHtml] = [await rootHtml(main), await rootHtml(branch)];
    if (branchHtml !== mainHtml) {
      let at = 0;
      while (at < mainHtml.length && branchHtml[at] === mainHtml[at]) at += 1;
      assert.fail(`switch off at ${width}px: the DOM differs from main's at ${at}`);
    }
    const off = await branch.evaluate(() => ({
      canvases: document.querySelectorAll("canvas").length,
      deckEngineCalls: window.deckEngineCalls,
      deckArtCalls: window.deckArtCalls,
      pixiGlobal: "PIXI" in window,
    }));
    assert.deepEqual(off, { canvases: 0, deckEngineCalls: 0, deckArtCalls: 0, pixiGlobal: false });
    results.flagOff.push({ width, domIdenticalToMain: true, domChars: branchHtml.length, ...off });
    await main.context().close();
    await branch.context().close();
  }

  // 2. Resizing: drag the chat's edge right (the deck's pane narrower) and back, on main and on this branch.
  const deltas = [...Array(24).fill(10), ...Array(24).fill(-10)];
  for (const bundle of ["main", "branch"]) {
    const view = await open(browser, { bundle, deck: true, scale: 2, reducedMotion: "reduce" });
    await openDeck(view);
    await view.waitForTimeout(300);
    const start = await measure(view);
    const series = [start, ...(await dragSweep(view, deltas))];
    // The biggest change in the ship's width between two neighbouring drag steps, against the canvas's.
    let worst = { shipStep: 0, canvasStep: 0, at: null };
    for (let index = 1; index < series.length; index += 1) {
      const shipStep = Math.abs(series[index].shipWidth - series[index - 1].shipWidth);
      const canvasStep = Math.abs(series[index].canvasWidth - series[index - 1].canvasWidth);
      if (shipStep > worst.shipStep) worst = { shipStep, canvasStep, at: [series[index - 1].canvasCss, series[index].canvasCss] };
    }
    const shares = series.map((point) => point.share);
    results.resize[bundle] = {
      canvasCss: [Math.min(...series.map((p) => p.canvasCss)), Math.max(...series.map((p) => p.canvasCss))],
      shipShare: [Math.min(...shares), Math.max(...shares)],
      biggestShipStepDevicePx: worst,
      series: series.map(({ canvasCss, canvasWidth, shipWidth, share, drew }) => ({ canvasCss, canvasWidth, shipWidth, share, drew })),
    };
    // Screenshots either side of main's step, the canvas at the narrowest and widest the drag reached.
    await view.screenshot({ path: join(here, `resize-${bundle}-after-drag.png`) });
    await view.context().close();
  }
  // This branch: the ship keeps its share of the pane, and no drag step moves it by more than the pane moved.
  const branchResize = results.resize.branch;
  assert(branchResize.shipShare[1] - branchResize.shipShare[0] < 0.01, `the ship's share of the pane stays put: ${branchResize.shipShare}`);
  assert(
    branchResize.biggestShipStepDevicePx.shipStep <= branchResize.biggestShipStepDevicePx.canvasStep + 2,
    `no step jumps: ${JSON.stringify(branchResize.biggestShipStepDevicePx)}`,
  );

  // Before and after, either side of where main's ship jumped, at the same pane widths.
  {
    const mainSeries = results.resize.main.series;
    let jump = null;
    for (let index = 1; index < mainSeries.length; index += 1) {
      const step = mainSeries[index].shipWidth - mainSeries[index - 1].shipWidth;
      if (jump === null || Math.abs(step) > Math.abs(jump.step)) jump = { step, index };
    }
    results.resize.mainJump = jump === null ? null : { from: mainSeries[jump.index - 1], to: mainSeries[jump.index] };
  }

  // 3. Hover: every sailor, on a still deck at 2×.
  {
    const view = await open(browser, { deck: true, scale: 2, reducedMotion: "reduce" });
    await openDeck(view);
    await view.waitForTimeout(300);
    const spots = await view.evaluate(() => window.sailorSpots());
    const seen = [];
    const shot = new Set();
    for (const spot of spots) {
      await view.mouse.move(spot.x, spot.y);
      await until(view, () => document.querySelector("[data-testid=firstmate-deck-label]") !== null);
      const text = await labelText(view);
      assert(text.startsWith(`${spot.frontTitle} | ${spot.frontStatus}`), `the label under ${spot.key} names ${spot.frontKey}: ${text}`);
      seen.push({ key: spot.key, state: spot.state, labelled: spot.frontKey, ownLabel: spot.frontKey === spot.key, text });
      if (!shot.has(spot.state) && spot.frontKey === spot.key) {
        shot.add(spot.state);
        const box = await canvasBox(view);
        await view.screenshot({ path: join(here, `hover-${spot.state}-dark.png`), clip: box });
      }
    }
    // Off the canvas: the label goes.
    await view.mouse.move(5, 880);
    await until(view, () => document.querySelector("[data-testid=firstmate-deck-label]") === null);
    results.hover = {
      sailors: spots.length,
      labelledAsThemselves: seen.filter((each) => each.ownLabel).length,
      statesShot: [...shot],
      leavesWithThePointer: true,
      labels: seen,
    };
    await view.context().close();
  }

  // ... and on a moving deck, on the real clock: the label follows its sailor and the deck keeps its pace.
  {
    const view = await open(browser, { deck: true, scale: 2, theme: "light" });
    await openDeck(view);
    await view.waitForTimeout(500);
    const spots = await view.evaluate(() => window.sailorSpots());
    const target = spots.find((spot) => spot.state === "idle" && spot.frontKey === spot.key) ?? spots[0];
    await view.mouse.move(target.x, target.y);
    await view.waitForTimeout(150);
    const text = await labelText(view);
    const drawsBefore = await view.evaluate(() => window.deckDraws);
    await view.waitForTimeout(1000);
    const drawsInASecond = (await view.evaluate(() => window.deckDraws)) - drawsBefore;
    await view.screenshot({ path: join(here, "hover-moving-light.png") });
    results.hoverMoving = { key: target.key, text, motion: await view.evaluate(() => document.querySelector("canvas[data-firstmate-deck]").getAttribute("data-firstmate-deck-motion")), drawsInASecond };
    assert(text !== null, "a moving deck labels the sailor under the pointer too");
    assert(drawsInASecond >= 20 && drawsInASecond <= 32, `still about 30 frames a second while hovering: ${drawsInASecond}`);
    await view.context().close();
  }

  // 4. Badges: the still deck in both themes.
  for (const theme of ["dark", "light"]) {
    const view = await open(browser, { deck: true, theme, scale: 2, reducedMotion: "reduce" });
    await openDeck(view);
    await view.waitForTimeout(300);
    await view.screenshot({ path: join(here, `deck-1440-${theme}.png`) });
    const box = await canvasBox(view);
    await view.screenshot({ path: join(here, `badges-${theme}.png`), clip: box });
    results.badges.push({ theme, legend: await view.evaluate(() => [...document.querySelectorAll("div")].map((node) => node.textContent).find((text) => /working.*hauling amidships/.test(text) && text.length < 200)) });
    await view.context().close();
  }
} finally {
  await browser.close();
  server.close();
}

results.errors = errors;
await writeFile(join(here, "render-results.json"), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify({ ...results, resize: Object.fromEntries(Object.entries(results.resize).map(([k, v]) => [k, v && v.series ? { ...v, series: `${v.series.length} points` } : v])), hover: results.hover && { ...results.hover, labels: `${results.hover.labels.length}` } }, null, 2));
assert.deepEqual(errors, [], "no page errors");
