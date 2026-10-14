/**
 * The generated sea, sky and gull in a real browser, from the bundles Paseo's own compiler makes
 * (`node docs/ship-deck-canvas/compile.mjs` first, which writes this branch's and origin/main's). Headless
 * Edge, never a daemon, through the canvas harness's host; the daemon's three deck RPCs are answered with
 * what `server/ship-deck.ts` reads from this checkout.
 *
 * 1. **Switch off** — the screen's DOM is main's, character for character, wide and narrow.
 * 2. **The day** — a still deck (reduced motion) at each sky's anchor and in the middle of a fade, the
 *    page's clock fixed in UTC: the canvas says which sky it drew, and the screenshot shows it.
 * 3. **Real time passing** — a still deck at 19:29 (dusk), the page's clock moved on to 23:00: within the minute
 *    the deck has redrawn itself with the night sky, with no frame loop running.
 * 4. **Motion** — a moving deck at noon: the sea scrolls, a gull crosses, still about 30 frames a second.
 * 5. **Resizing** — the chat's edge dragged both ways: the sky still reaches every corner of the canvas.
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
  outfile: join(generated, "environment-host.js"),
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
  // The sail and the crew's looks too, as the daemon sends them: without them the deck warns, and this check fails on any warning.
  "/deck-extras.json": JSON.stringify(await readDeckExtras(async () => root)),
};

const files = {
  "/host.js": join(generated, "environment-host.js"),
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

const results = { flagOff: [], day: [], realTime: null, motion: null, resize: [], environmentCalls: null };
const errors = [];

/** Counts the deck's draws: each one marks the canvas with the motion in force. */
const COUNT_DRAWS = `(() => {
  window.deckDraws = 0;
  new MutationObserver((records) => {
    for (const record of records) if (record.attributeName === "data-firstmate-deck-motion") window.deckDraws += 1;
  }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-firstmate-deck-motion"] });
})();`;

async function open(browser, { bundle = "branch", deck = false, theme = "dark", width = 1440, scale = 1, reducedMotion = "no-preference", time = "2026-10-14T12:00:00Z" }) {
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, deviceScaleFactor: scale, reducedMotion, timezoneId: "UTC" });
  const view = await context.newPage();
  view.on("pageerror", (error) => errors.push(`${bundle}/${theme}/${width}: ${error.message}`));
  view.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") errors.push(`${bundle}/${theme}/${width} console ${message.type()}: ${message.text()}`);
  });
  await view.clock.setFixedTime(new Date(time));
  await view.addInitScript(COUNT_DRAWS);
  await view.goto(`${origin}/?bundle=${bundle}&theme=${theme}${deck ? "&deck=1" : ""}`);
  await until(view, () =>
    [...document.querySelectorAll("div")].some((node) => node.textContent === "Brief helper: coach prompt, skill and button" || node.textContent === "First mate"),
  );
  return view;
}

async function until(view, predicate, arg, attempts = 400) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
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
  await until(view, () => document.querySelector("canvas[data-firstmate-deck-sky]") !== null);
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

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  // 1. Off: the branch draws exactly what main draws.
  for (const width of [1440, 390]) {
    const main = await open(browser, { bundle: "main", width });
    const branch = await open(browser, { bundle: "branch", width });
    const [mainHtml, branchHtml] = [await rootHtml(main), await rootHtml(branch)];
    results.flagOff.push({ width, identical: mainHtml === branchHtml, characters: branchHtml.length, environmentCalls: await branch.evaluate(() => window.deckEnvironmentCalls) });
    assert.equal(branchHtml, mainHtml, `switch off at ${width}px: the DOM differs from main's`);
    assert.equal(await branch.evaluate(() => window.deckEnvironmentCalls), 0, "switch off: the environment is never asked for");
    await main.context().close();
    await branch.context().close();
  }

  // 2. The day, on a still deck: each anchor, and halfway from dusk to night.
  const day = [
    ["05:30", "dawn"],
    ["08:00", "morning"],
    ["12:00", "midday"],
    ["16:00", "afternoon"],
    ["18:30", "dusk"],
    ["20:15", "night"],
    ["21:00", "night"],
    ["02:00", "night"],
  ];
  for (const [clock, expected] of day) {
    const view = await open(browser, { deck: true, scale: 2, reducedMotion: "reduce", time: `2026-10-14T${clock}:00Z` });
    await openDeck(view);
    await view.waitForTimeout(300);
    const sky = await attribute(view, "data-firstmate-deck-sky");
    const name = `sky-${clock.replace(":", "")}.png`;
    const png = await canvasShot(view, name);
    // The sky high in the canvas's middle, and the sea low at its edge.
    const [skyColour, seaColour] = await view.evaluate(([data, points]) => window.pixelsAt(data, points), [png.toString("base64"), [[0.5, 0.06], [0.04, 0.95]]]);
    results.day.push({ clock, sky, motion: await attribute(view, "data-firstmate-deck-motion"), screenshot: name, skyColour, seaColour });
    assert.equal(sky, expected, `${clock} shows ${expected}`);
    if (clock === "18:30") await view.screenshot({ path: join(here, "deck-1440-dark-dusk.png") });
    await view.context().close();
  }
  const light = await open(browser, { deck: true, theme: "light", scale: 2, reducedMotion: "reduce", time: "2026-10-14T08:00:00Z" });
  await openDeck(light);
  await light.waitForTimeout(300);
  await light.screenshot({ path: join(here, "deck-1440-light-morning.png") });
  await light.context().close();

  // 3. Real time passing on a still deck: no frame loop, and the sky still turns at the minute.
  {
    const view = await open(browser, { deck: true, scale: 1, reducedMotion: "reduce", time: "2026-10-14T19:29:30Z" });
    await openDeck(view);
    const before = await attribute(view, "data-firstmate-deck-sky");
    const drawsBefore = await view.evaluate(() => window.deckDraws);
    await view.clock.setFixedTime(new Date("2026-10-14T23:00:00Z"));
    const started = Date.now();
    await until(view, () => document.querySelector("canvas[data-firstmate-deck]").getAttribute("data-firstmate-deck-sky") === "night", undefined, 1400);
    const draws = (await view.evaluate(() => window.deckDraws)) - drawsBefore;
    results.realTime = { before, after: await attribute(view, "data-firstmate-deck-sky"), secondsToTurn: Math.round((Date.now() - started) / 100) / 10, draws };
    assert.equal(before, "dusk");
    assert(draws <= 2, `a still deck redraws once for the minute, not in a loop: ${draws}`);
    await view.context().close();
  }

  // 4. Motion at noon: the sea scrolls, a gull crosses, the frame cap holds.
  {
    const gullAt = await (async () => {
      const probe = await open(browser, { deck: false });
      const t = await probe.evaluate(() => window.gullOverShipAt(1));
      await probe.context().close();
      return t;
    })();
    const view = await open(browser, { deck: true, scale: 2 });
    await openDeck(view);
    const opened = Date.now();
    const first = await canvasShot(view);
    await view.waitForTimeout(1000);
    const second = await canvasShot(view);
    // Frames a second, over two seconds of the page's own clock.
    const drawsInASecond = await view.evaluate(
      () =>
        new Promise((done) => {
          const [draws, started] = [window.deckDraws, performance.now()];
          setTimeout(() => done(Math.round(((window.deckDraws - draws) * 1000) / (performance.now() - started))), 2000);
        }),
    );
    const [seaChanged, skyChanged] = await view.evaluate(
      ([a, b]) => Promise.all([window.changedPixels(a, b, 0.75, 1), window.changedPixels(a, b, 0, 0.12)]),
      [first.toString("base64"), second.toString("base64")],
    );
    const wait = gullAt * 1000 - (Date.now() - opened);
    if (wait > 0) await view.waitForTimeout(wait);
    await canvasShot(view, "moving-gull-noon.png");
    results.motion = { motion: await attribute(view, "data-firstmate-deck-motion"), seaPixelsChanged: seaChanged, highSkyPixelsChanged: skyChanged, drawsInASecond, gullExpectedAtSeconds: gullAt };
    assert(seaChanged > 1000, `the sea scrolls: ${seaChanged} pixels changed`);
    assert(drawsInASecond >= 20 && drawsInASecond <= 32, `about 30 frames a second: ${drawsInASecond}`);
    await view.context().close();
  }

  // 5. Resizing: the sky reaches every corner at every width, the sea every bottom corner.
  {
    const view = await open(browser, { deck: true, scale: 2, reducedMotion: "reduce", time: "2026-10-14T12:00:00Z" });
    await openDeck(view);
    const handle = view.getByRole("separator", { name: "Chat width" });
    const box = await handle.boundingBox();
    let x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await view.mouse.move(x, y);
    await view.mouse.down();
    for (const delta of [0, -300, 200, 300, 200]) {
      x += delta;
      await view.mouse.move(x, y, { steps: 2 });
      await view.waitForTimeout(200);
      const canvas = await canvasBox(view);
      const png = await canvasShot(view);
      const corners = await view.evaluate(([data, points]) => window.pixelsAt(data, points), [
        png.toString("base64"),
        [[0.02, 0.03], [0.98, 0.03], [0.02, 0.97], [0.98, 0.97]],
      ]);
      // The theme's surface is the canvas's background: no corner may show it.
      const background = [0x18, 0x1b, 0x1a];
      const bare = corners.filter((rgb) => rgb.every((value, index) => Math.abs(value - background[index]) < 6)).length;
      results.resize.push({ canvasCss: [Math.round(canvas.width), Math.round(canvas.height)], corners, bareCorners: bare });
      assert.equal(bare, 0, `at ${Math.round(canvas.width)} px, every corner is sky or sea`);
    }
    await view.mouse.up();
    await canvasShot(view, "resized-wide-noon.png");
    results.environmentCalls = await view.evaluate(() => window.deckEnvironmentCalls);
    await view.context().close();
  }
} finally {
  await browser.close();
  server.close();
}

results.errors = errors;
await writeFile(join(here, "render-results.json"), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results, null, 2));
assert.deepEqual(errors, [], "no page errors or warnings");
