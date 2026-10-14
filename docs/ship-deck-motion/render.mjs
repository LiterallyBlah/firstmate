/**
 * The moving ship deck in a real browser, from the bundles Paseo's own compiler makes
 * (`node docs/ship-deck-canvas/compile.mjs` first). Headless Edge, never a daemon: the compiled
 * `clientBundle` is evaluated the way the app does (`docs/ship-deck-canvas/host.jsx`) and the screen is
 * rendered with the board-list fixture fleet.
 *
 * 1. **Switch off** — the screen's DOM is main's, character for character, wide and narrow; no Deck, no
 *    canvas, no Pixi fetched.
 * 2. **Reduced motion** (`prefers-reduced-motion: reduce`) — a still deck: the canvas says `still`, nothing
 *    is drawn between changes, and the deck is the one a 2D canvas draws independently from the same
 *    scene, crew placement, atlas and layer order, art pixel by art pixel, in both themes.
 * 3. **Motion, on Playwright's fake clock** — so every frame is at a known moment: the crew changes state
 *    (the marks change at once, the sailors walk after), a new crewmate climbs out of the hatch, an
 *    archived one goes back down it, the feed is lost (greyed, nobody idle), and a hidden window draws
 *    nothing. Screenshots of each, and `deck-motion.png`, an animated PNG of the first ten seconds.
 * 4. **Performance, on the real clock** — the GPU and SwiftShader (software) renderers: frames drawn a
 *    second, main-thread time, our JS per frame, with the crew walking, hidden, and still.
 *
 * Writes the screenshots, `deck-motion.png` and `render-results.json` here.
 */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

import { encodeApng } from "./apng.mjs";

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
  outfile: join(generated, "host.js"),
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
const deckEngine = JSON.stringify(await readDeckEngine(async () => root));
const deckArt = JSON.stringify(await readDeckArt(async () => root));

const files = {
  "/host.js": join(generated, "host.js"),
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

const results = { flagOff: [], still: [], motion: null, performance: [] };
const errors = [];

/** Counts the deck's draws: each one marks the canvas with the motion in force. */
const COUNT_DRAWS = `(() => {
  window.deckDraws = 0;
  new MutationObserver((records) => {
    for (const record of records) if (record.attributeName === "data-firstmate-deck-motion") window.deckDraws += 1;
  }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-firstmate-deck-motion"] });
  // Our JS a frame: the time inside every animation-frame callback.
  window.frameMs = 0;
  window.frameCallbacks = 0;
  const request = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => request((time) => {
    const started = performance.now();
    try { callback(time); } finally { window.frameMs += performance.now() - started; window.frameCallbacks += 1; }
  });
  window.hiddenDraws = [];
  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (name === "data-firstmate-deck-motion" && document.hidden) window.hiddenDraws.push(new Error().stack);
    return setAttribute.call(this, name, value);
  };
  // A stand-in for the window going to the background.
  window.setHidden = (hidden) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event("visibilitychange"));
  };
})();`;

async function open(browser, { bundle = "branch", deck = false, theme = "dark", width = 1440, scale = 1, reducedMotion = "no-preference", fakeClock = false }) {
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, deviceScaleFactor: scale, reducedMotion });
  const view = await context.newPage();
  view.on("pageerror", (error) => errors.push(`${bundle}/${theme}/${width}: ${error.message}`));
  view.on("console", (message) => {
    if (message.type() === "error") errors.push(`${bundle}/${theme}/${width} console: ${message.text()}`);
  });
  if (fakeClock) await view.clock.install({ time: now });
  else await view.clock.setFixedTime(now);
  await view.addInitScript(COUNT_DRAWS);
  await view.goto(`${origin}/?bundle=${bundle}&theme=${theme}${deck ? "&deck=1" : ""}`);
  // An installed clock still flows with real time (a screenshot alone moves it on); paused, it moves only
  // when `runFor` says, so every frame is at a known moment.
  if (fakeClock) await view.clock.pauseAt((await view.evaluate(() => Date.now())) + 100);
  await until(view, fakeClock, () =>
    [...document.querySelectorAll("div")].some((node) => node.textContent === "Brief helper: coach prompt, skill and button" || node.textContent === "First mate"),
  );
  return view;
}

/** Waits for `predicate` in the page, running the fake clock on while it waits when there is one. */
async function until(view, fakeClock, predicate, arg) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (await view.evaluate(predicate, arg)) return;
    if (fakeClock) await view.clock.runFor(50);
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

async function openDeck(view, fakeClock) {
  await view.getByText("Deck", { exact: true }).click();
  await until(view, fakeClock, () => document.querySelector("canvas[data-firstmate-deck-motion]") !== null);
  await view.mouse.move(700, 880);
  await view.evaluate(() => document.activeElement?.blur());
}

const canvasFacts = (view) =>
  view.evaluate(() => {
    const canvas = document.querySelector("canvas[data-firstmate-deck]");
    return {
      renderer: canvas.getAttribute("data-firstmate-deck"),
      motion: canvas.getAttribute("data-firstmate-deck-motion"),
      caption: [...document.querySelectorAll("div")].map((node) => node.textContent).find((text) => /^Preview · drawn/.test(text)),
      label: canvas.parentElement.getAttribute("aria-label"),
      deckEngineCalls: window.deckEngineCalls,
      deckArtCalls: window.deckArtCalls,
      pixiGlobal: "PIXI" in window,
    };
  });

async function canvasShot(view, name) {
  const box = await view.evaluate(() => {
    const rect = document.querySelector("canvas[data-firstmate-deck]").getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
  return view.screenshot({ path: join(here, name), clip: box });
}

/** Re-polls the fleet after the page's fixture has been changed. */
async function poll(view, fakeClock, change) {
  await view.evaluate(change);
  await view.getByRole("button", { name: "Refresh" }).click();
  if (fakeClock) await view.clock.runFor(50);
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
      deckButton: [...document.querySelectorAll("[role=button],[role=tab]")].some((node) => node.textContent === "Deck"),
      canvases: document.querySelectorAll("canvas").length,
      deckEngineCalls: window.deckEngineCalls,
      deckArtCalls: window.deckArtCalls,
      pixiGlobal: "PIXI" in window,
      deckDraws: window.deckDraws,
    }));
    assert.deepEqual(off, { deckButton: false, canvases: 0, deckEngineCalls: 0, deckArtCalls: 0, pixiGlobal: false, deckDraws: 0 });
    results.flagOff.push({ width, domIdenticalToMain: true, domChars: branchHtml.length, ...off });
    await main.context().close();
    await branch.context().close();
  }

  // 2. Reduced motion: a still deck, held art pixel by art pixel to an independent 2D reference.
  for (const theme of ["dark", "light"]) {
    const view = await open(browser, { deck: true, theme, scale: 2, reducedMotion: "reduce" });
    await openDeck(view, false);
    await view.waitForTimeout(400);
    const facts = await canvasFacts(view);
    assert.equal(facts.motion, "still");
    const drawsBefore = await view.evaluate(() => window.deckDraws);
    const shot = await view.screenshot({ path: join(here, `still-1440-${theme}.png`) });
    await view.waitForTimeout(2000);
    const drawsAfter = await view.evaluate(() => window.deckDraws);
    assert.equal(drawsAfter, drawsBefore, "a still deck draws nothing while nothing changes");
    const drawn = await compareStill(view, shot);
    if (theme === "dark") await canvasShot(view, "still-canvas.png");
    results.still.push({ theme, ...facts, drawsWhileIdleFor2s: drawsAfter - drawsBefore, ...drawn });
    await view.context().close();
  }

  // 3. Motion, frame by frame on the fake clock.
  {
    const fake = true;
    const view = await open(browser, { deck: true, scale: 2, fakeClock: fake });
    await openDeck(view, fake);
    const facts = await canvasFacts(view);
    assert.equal(facts.motion, "full");
    const grid = await view.evaluate(() => window.deckGrid());
    const frames = [];
    const frame = async () => {
      const png = await view.screenshot();
      const sampled = await view.evaluate(([data, at]) => window.artGrid(data, at), [png.toString("base64"), grid]);
      frames.push(sampled);
    };
    await canvasShot(view, "01-aboard.png");
    // The crew changes: a working remote worker is blocked, a blocked one goes back to work, an idle one
    // is done (Ready), and the job-waiting worker gets its answer.
    await poll(view, fake, () => {
      const set = (key, column, note) => {
        const card = window.fixtureFleet.cards.find((each) => each.key === key);
        card.column = column;
        if (note === undefined) delete card.note;
        else card.note = note;
      };
      set("work-0", "blocked");
      set("block-0", "working");
      set("work-5", "working");
      const idle = window.fixtureFleet.cards.find((each) => each.column === "idle" && each.agent !== null);
      if (idle) set(idle.key, "ready");
    });
    await view.clock.runFor(150);
    const counts = await view.evaluate(() => document.querySelector("canvas[data-firstmate-deck]").parentElement.getAttribute("aria-label"));
    await canvasShot(view, "02-state-changed.png");
    for (let step = 0; step < 100; step += 1) {
      if (step === 30) await canvasShot(view, "03-walking.png");
      await frame();
      await view.clock.runFor(100);
    }
    await view.clock.runFor(12000);
    await canvasShot(view, "04-arrived.png");

    // A new crewmate climbs out of the hatch and walks to its station.
    await poll(view, fake, () => {
      const source = window.fixtureFleet.cards.find((each) => each.key === "block-1");
      window.fixtureFleet.cards.push({ ...structuredClone(source), key: "new-0", taskId: "new-0", column: "working", agent: { ...source.agent, id: "new-0" } });
    });
    await view.clock.runFor(330);
    await canvasShot(view, "05-hatch-arriving.png");
    await view.clock.runFor(2500);
    await canvasShot(view, "06-new-crewmate-walks.png");

    // An archived one walks back to the hatch and climbs down.
    await poll(view, fake, () => {
      window.fixtureFleet.cards = window.fixtureFleet.cards.filter((each) => each.key !== "block-2");
    });
    await view.clock.runFor(900);
    await canvasShot(view, "07-leaving.png");
    await view.clock.runFor(20000);

    // The feed is lost: everyone greyed where they stood, nobody idle.
    await poll(view, fake, () => {
      window.fixtureFleetError = true;
    });
    await until(view, fake, () => /feed is lost/.test(document.body.textContent));
    await view.clock.runFor(500);
    await view.screenshot({ path: join(here, "08-feed-lost.png") });
    const lost = await canvasFacts(view);
    assert.match(lost.label, /feed lost: last known/);

    // A hidden window: no draws at all; shown again, it carries on.
    await view.evaluate(() => window.setHidden(true));
    const drawsBefore = await view.evaluate(() => window.deckDraws);
    await view.clock.runFor(3000);
    const drawsHidden = (await view.evaluate(() => window.deckDraws)) - drawsBefore;
    await view.evaluate(() => window.setHidden(false));
    await view.clock.runFor(1000);
    const drawsShown = (await view.evaluate(() => window.deckDraws)) - drawsBefore - drawsHidden;
    assert.equal(drawsHidden, 0, `a hidden deck draws nothing: ${await view.evaluate(() => window.hiddenDraws.join(" --- "))}`);
    assert(drawsShown >= 25 && drawsShown <= 32, `about 30 draws in a second once shown again: ${drawsShown}`);

    // The animated PNG: the first ten seconds of the state change, ten frames a second, one pixel an art
    // pixel, cropped to the ship with sky above the masthead for the gull and a strip of sea below.
    const { width: gridWidth, height: gridHeight } = frames[0];
    // The sampled grid starts `ceil(fit.y / scale)` art pixels above the deck's own row 0.
    const deckRow = Math.ceil(grid.fit.y / grid.fit.scale);
    const cropTop = Math.max(0, deckRow - 36);
    const crop = { left: 0, top: cropTop, width: gridWidth, height: Math.min(gridHeight - cropTop, deckRow - cropTop + 161 + 14) };
    const upscale = 1;
    const { width, height } = crop;
    const rgbFrames = frames.map(({ rgb }) => {
      const out = Buffer.alloc(width * upscale * height * upscale * 3);
      for (let y = 0; y < height * upscale; y += 1) {
        for (let x = 0; x < width * upscale; x += 1) {
          const from = (((Math.floor(y / upscale) + crop.top) * gridWidth) + Math.floor(x / upscale) + crop.left) * 3;
          const to = (y * width * upscale + x) * 3;
          out[to] = rgb[from];
          out[to + 1] = rgb[from + 1];
          out[to + 2] = rgb[from + 2];
        }
      }
      return out;
    });
    const apng = encodeApng(rgbFrames, width * upscale, height * upscale, 100);
    await writeFile(join(here, "deck-motion.png"), apng);
    results.motion = {
      ...facts,
      labelAfterTheStateChange: counts,
      labelWithTheFeedLost: lost.label,
      drawsWhileHiddenFor3s: drawsHidden,
      drawsInTheSecondAfterShown: drawsShown,
      animation: { frames: frames.length, fps: 10, width: width * upscale, height: height * upscale, bytes: apng.length },
    };
    await view.context().close();
  }
} finally {
  await browser.close();
}

// 4. Performance on the real clock: a GPU and SwiftShader.
for (const [name, args] of [
  ["GPU (ANGLE D3D11)", ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"]],
  ["SwiftShader (CPU)", ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]],
]) {
  const perf = await chromium.launch({ channel: "msedge", headless: true, args });
  try {
    for (const reducedMotion of ["no-preference", "reduce"]) {
      const view = await open(perf, { deck: true, scale: 2, reducedMotion });
      await openDeck(view, false);
      await view.waitForTimeout(1000);
      const gpu = await view.evaluate(() => {
        const gl = document.createElement("canvas").getContext("webgl2");
        const info = gl?.getExtension("WEBGL_debug_renderer_info");
        return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null;
      });
      const cdp = await view.context().newCDPSession(view);
      await cdp.send("Performance.enable");
      const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
      async function measure(label, seconds) {
        const before = await metrics();
        const page = await view.evaluate(() => ({ draws: window.deckDraws, frameMs: window.frameMs, callbacks: window.frameCallbacks }));
        await view.waitForTimeout(seconds * 1000);
        const after = await metrics();
        const end = await view.evaluate(() => ({ draws: window.deckDraws, frameMs: window.frameMs, callbacks: window.frameCallbacks }));
        const draws = end.draws - page.draws;
        return {
          label,
          drawsPerSecond: +(draws / seconds).toFixed(1),
          mainThreadBusyPercent: +((((after.TaskDuration - before.TaskDuration) / seconds) * 100).toFixed(1)),
          scriptPercent: +((((after.ScriptDuration - before.ScriptDuration) / seconds) * 100).toFixed(1)),
          jsMsPerDraw: draws === 0 ? 0 : +((end.frameMs - page.frameMs) / draws).toFixed(2),
        };
      }
      // Set the crew walking: every working sailor to the rail and every blocked one to work, for the measurement.
      await view.evaluate(() => {
        for (const card of window.fixtureFleet.cards) {
          if (card.column === "working") card.column = "idle";
          else if (card.column === "blocked") card.column = "working";
        }
      });
      await view.getByRole("button", { name: "Refresh" }).click();
      await view.waitForTimeout(300);
      const motion = await view.evaluate(() => document.querySelector("canvas[data-firstmate-deck]").getAttribute("data-firstmate-deck-motion"));
      const walking = await measure("crew walking", 5);
      const settled = await measure("settled (ambient only)", 5);
      await view.evaluate(() => window.setHidden(true));
      const hidden = await measure("window hidden", 5);
      results.performance.push({ renderer: name, gpu, reducedMotion, motion, measurements: [walking, settled, hidden] });
      await view.context().close();
    }
  } finally {
    await perf.close();
  }
}
await new Promise((done) => server.close(done));

/**
 * The still deck's screenshot against the 2D reference, at every art pixel the reference draws above the
 * waterline, outside each sailor's mark and each lantern's glow (which the reference does not draw).
 */
async function compareStill(view, shot) {
  const reference = await view.evaluate(() => window.referenceDeck());
  const actual = await view.evaluate(([png, at]) => window.deckPixels(png, at), [shot.toString("base64"), reference]);
  const marked = (x, y) => reference.marks.some((mark) => Math.abs(x - mark.x) <= 7 && y - mark.y >= -3 && y - mark.y <= 2);
  const lit = (x, y) => reference.lanterns.some((lantern) => Math.abs(x - lantern.x) <= 10 && y - lantern.y >= -6 && y - lantern.y <= 14);
  let compared = 0;
  const mismatches = [];
  for (let y = 0; y < reference.waterline - 1; y += 1) {
    for (let x = 0; x < reference.width; x += 1) {
      const at = y * reference.width + x;
      if (reference.pixels[at * 4 + 3] !== 255 || marked(x, y) || lit(x, y)) continue;
      compared += 1;
      const want = reference.pixels.slice(at * 4, at * 4 + 3);
      const got = actual.slice(at * 3, at * 3 + 3);
      if (want.some((value, index) => Math.abs(value - got[index]) > 3)) mismatches.push({ x, y, want, got });
    }
  }
  assert.deepEqual(mismatches.slice(0, 10), [], `${mismatches.length} of ${compared} art pixels differ from the reference`);
  const sailors = reference.sailors.map(({ pixels, ...sailor }) => {
    const hidden = Object.values(sailor.hiddenBy).reduce((sum, count) => sum + count, 0);
    return { key: sailor.key, state: sailor.state, x: sailor.x, y: sailor.row, pose: sailor.pose, artPixels: pixels.length, visible: pixels.length - hidden, hiddenBy: sailor.hiddenBy };
  });
  for (const sailor of sailors) assert(sailor.visible > sailor.artPixels / 3, `${sailor.key} is mostly visible`);
  return { counts: reference.counts, devicePixelsPerArtPixel: reference.fit.scale * reference.dpr, artPixelsCompared: compared, matching: compared - mismatches.length, sailors };
}

results.errors = errors;
await writeFile(join(here, "render-results.json"), JSON.stringify(results, null, 2) + "\n");
assert.deepEqual(errors, [], "no page errors or console errors");
console.log(JSON.stringify({ ...results, still: results.still.map(({ sailors, ...rest }) => rest) }, null, 2));
