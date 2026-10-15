/**
 * The plank, in a real browser, from the bundle Paseo's own compiler makes (`node docs/ship-deck-canvas/compile.mjs`
 * first). Headless Edge, never a daemon, through the canvas harness's host and its fixture fleet; `host.jsx` here
 * adds `leave` and `plankTimes`.
 *
 * 1. **The plank** — the whole deck, dark and light, with the plank over the gunwale amidships.
 * 2. **The sequence** — on the fake clock, a working crewmate's card goes to Done: it walks to the plank,
 *    out along it, jumps, splashes, and the shark has it. Each beat pictured at its moment, and the whole of it
 *    as an animated PNG at 20 frames a second, one art pixel to two.
 * 3. **Several at once** — three cards gone from the board in one poll: one on the plank, the others waiting
 *    their turn beside its foot, one shark at a time.
 * 4. **A focused sailor leaving** — its panel closes, the camera pulls back out, and it walks the plank.
 * 5. **Reduced motion** — no walk, no plank, no shark: the sailor fades out where it stood, and the deck is
 *    still again once it has gone.
 *
 * Writes the pictures and `render-results.json` here.
 */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

import { encodeApng } from "../ship-deck-motion/apng.mjs";

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
  outfile: join(generated, "plank-host.js"),
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
  "/host.js": join(generated, "plank-host.js"),
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
const now = new Date("2026-10-14T12:00:00Z");

async function open(browser, { theme = "dark", reducedMotion = "no-preference", fakeClock = false, time = now } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion, timezoneId: "UTC" });
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
  await view.mouse.move(5, 880);
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

/** Takes `keys` off the deck — to Done, or off the board (`null`) — and polls the fleet once. */
async function leave(view, fakeClock, keys, column) {
  await view.evaluate(([k, c]) => window.leave(k, c), [keys, column]);
  await view.getByRole("button", { name: "Refresh" }).click();
  if (fakeClock) await view.clock.runFor(33);
}

const canvasBox = (view) =>
  view.evaluate(() => {
    const rect = document.querySelector("canvas[data-firstmate-deck]").getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
const canvasShot = async (view, path) => view.screenshot({ clip: await canvasBox(view), path: join(here, path) });
/** The part of the canvas showing deck pixels `[left, top]` to `[right, bottom]`. */
const deckClip = (view, left, top, right, bottom) =>
  view.evaluate(
    ([l, t, r, b]) => {
      const { box, fit } = window.deckGrid();
      return { x: box.left + fit.x + l * fit.scale, y: box.top + fit.y + t * fit.scale, width: (r - l) * fit.scale, height: (b - t) * fit.scale };
    },
    [left, top, right, bottom],
  );
/** Around the plank: the mast to the gunwale's bollards, the deck down to the sea under the plank. */
const PLANK_VIEW = [168, 56, 336, 176];
const plankShot = async (view, path) => view.screenshot({ clip: await deckClip(view, ...PLANK_VIEW), path: join(here, path) });
const motion = (view) => view.evaluate(() => document.querySelector("canvas[data-firstmate-deck]").getAttribute("data-firstmate-deck-motion"));
const panel = (view) => view.evaluate(() => document.querySelector("[data-testid=firstmate-deck-focus]")?.getAttribute("aria-label") ?? null);

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  // 1. The plank, on the whole deck.
  for (const theme of ["dark", "light"]) {
    const view = await open(browser, { theme, time: theme === "dark" ? now : new Date("2026-10-14T16:30:00Z") });
    await canvasShot(view, `deck-plank-${theme}.png`);
    await view.context().close();
  }

  // 2. The sequence, beat by beat on the fake clock, and as an animated PNG.
  {
    const fake = true;
    const view = await open(browser, { fakeClock: fake });
    const key = "work-1";
    await leave(view, fake, [key], "done");
    const { boards, sequence } = await view.evaluate((k) => window.plankTimes(k), [key]);
    const board = boards[key];
    assert(board > 0, "the crewmate reaches the plank");
    const beats = [
      ["01-walking-to-the-plank", Math.round(board / 2)],
      ["02-on-the-plank", board + sequence.onPlank],
      ["03-teetering", board + sequence.teeter],
      ["04-jumping", board + sequence.impact - 160],
      ["05-splash", board + sequence.impact + 120],
      ["06-fin", board + sequence.fin + 380],
      ["07-chomp", board + sequence.chomp + 90],
      ["08-submerge", board + sequence.submerge + 60],
      ["09-gone", board + sequence.gone + 400],
    ];
    const grid = await view.evaluate(() => window.deckGrid());
    const deckRow = Math.ceil(grid.fit.y / grid.fit.scale);
    const deckCol = Math.ceil(grid.fit.x / grid.fit.scale);
    const frames = [];
    const end = board + sequence.gone + 600;
    let at = 33;
    let beat = 0;
    for (let t = 0; t <= end; t += 50) {
      if (t > at) {
        await view.clock.runFor(t - at);
        at = t;
      }
      while (beat < beats.length && beats[beat][1] <= at) {
        await plankShot(view, `${beats[beat][0]}.png`);
        beat += 1;
      }
      const png = await view.screenshot();
      frames.push(await view.evaluate(([data, g]) => window.artGrid(data, g), [png.toString("base64"), grid]));
    }
    while (beat < beats.length) {
      await view.clock.runFor(Math.max(0, beats[beat][1] - at));
      at = Math.max(at, beats[beat][1]);
      await plankShot(view, `${beats[beat][0]}.png`);
      beat += 1;
    }
    const [left, top, right, bottom] = PLANK_VIEW;
    const crop = { left: deckCol + left, top: deckRow + top, width: right - left, height: bottom - top };
    const upscale = 2;
    const rgbFrames = frames.map(({ rgb, width: gridWidth }) => {
      const out = Buffer.alloc(crop.width * upscale * crop.height * upscale * 3);
      for (let y = 0; y < crop.height * upscale; y += 1) {
        for (let x = 0; x < crop.width * upscale; x += 1) {
          const from = ((Math.floor(y / upscale) + crop.top) * gridWidth + Math.floor(x / upscale) + crop.left) * 3;
          const to = (y * crop.width * upscale + x) * 3;
          out[to] = rgb[from];
          out[to + 1] = rgb[from + 1];
          out[to + 2] = rgb[from + 2];
        }
      }
      return out;
    });
    const apng = encodeApng(rgbFrames, crop.width * upscale, crop.height * upscale, 50);
    await writeFile(join(here, "walk-the-plank.png"), apng);
    results.sequence = {
      key,
      boardsAfterMs: board,
      beats: Object.fromEntries(beats),
      motion: await motion(view),
      animation: { frames: frames.length, fps: 20, width: crop.width * upscale, height: crop.height * upscale, bytes: apng.length },
    };
    assert.equal(results.sequence.motion, "full");
    await view.context().close();
  }

  // 3. Several at once.
  {
    const fake = true;
    const view = await open(browser, { fakeClock: fake });
    const keys = ["work-0", "work-2", "work-3"];
    await leave(view, fake, keys, null);
    const { boards, sequence } = await view.evaluate((k) => window.plankTimes(k), keys);
    const order = Object.entries(boards).sort((a, b) => a[1] - b[1]);
    const [, second] = order;
    // The second on the plank while the first's shark is out, the third waiting by the foot.
    await view.clock.runFor(second[1] + sequence.onPlank - 33);
    await plankShot(view, "10-several-queue.png");
    await canvasShot(view, "10-several-deck.png");
    results.several = {
      keys,
      boardsAfterMs: Object.fromEntries(order),
      gapsMs: order.slice(1).map(([, ms], index) => ms - order[index][1]),
      impactMs: sequence.impact,
    };
    for (const gap of results.several.gapsMs) assert(gap >= sequence.impact, `one on the plank at a time: ${gap}`);
    await view.clock.runFor(order.at(-1)[1] + sequence.gone + 1000);
    await plankShot(view, "11-several-gone.png");
    await view.context().close();
  }

  // 4. A focused sailor leaving.
  {
    const view = await open(browser);
    await view.evaluate(() => document.querySelector("[aria-label^='Ship deck:']").focus());
    await view.keyboard.press("ArrowRight");
    await view.waitForTimeout(700);
    const name = await panel(view);
    assert(name !== null, "a sailor is focused");
    await canvasShot(view, "12-focused.png");
    const title = name.replace(/: details and actions$/, "");
    const key = await view.evaluate((t) => window.fixtureFleet.cards.find((card) => card.title === t).key, title);
    await view.evaluate(([k]) => window.leave([k], "done"), [key]);
    await view.getByRole("button", { name: "Refresh" }).click();
    await view.waitForTimeout(900);
    const after = await panel(view);
    await canvasShot(view, "13-focused-leaves.png");
    results.focusedLeaving = { key, title, panelAfter: after };
    assert.equal(after, null, "the panel closes when its sailor leaves");
    await view.context().close();
  }

  // 5. Reduced motion: a fade where it stood.
  {
    const view = await open(browser, { reducedMotion: "reduce" });
    assert.equal(await motion(view), "still");
    await plankShot(view, "14-still-before.png");
    await view.evaluate(() => window.leave(["work-1"], "done"));
    await view.getByRole("button", { name: "Refresh" }).click();
    await view.waitForTimeout(220);
    await plankShot(view, "15-still-fading.png");
    await view.waitForTimeout(1200);
    await plankShot(view, "16-still-gone.png");
    results.reducedMotion = { motion: await motion(view) };
    assert.equal(results.reducedMotion.motion, "still");
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
