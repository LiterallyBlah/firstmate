/**
 * The animated water, before and after, in a real browser, from the bundles Paseo's own compiler makes
 * (`node docs/ship-deck-canvas/compile.mjs` first: it writes origin/main's bundle and this branch's). Headless
 * Edge, never a daemon, through the canvas harness's host and its fixture fleet. **Before** is origin/main's
 * bundle with origin/main's art and server code — the still sea tile, its foam strip and the wake drawn in
 * code; **after** is this branch's with its own — the generated sea, foam and wake from `extras.json`'s `water`.
 *
 * 1. **The deck** — the whole canvas before and after, dark at noon, and at night; after, light at 16:30 and dusk.
 * 2. **The water** — close on the hull's waterline and the stern, before and after, at the same scale.
 * 3. **The cycle** — the same close-up at 0, 240, 480 and 720 ms on the fake clock, before and after, side by
 *    side; and three seconds of each as an animated PNG, since stills do not show motion.
 * 4. **The pane** — wide and short, tall and narrow, fractional: the wake and the shark's sea in view.
 * 5. **The plank** — the walk off it to the splash and the shark, in the near sea, in front of the wake.
 * 6. **Click to focus** — a sailor focused and back out. 7. **Reduced motion** — the still deck, calm frames.
 *
 * Writes the pictures and `render-results.json` here.
 */
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { crc32 } from "node:zlib";
import { tmpdir } from "node:os";
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

// origin/main's art and the server code that reads it, as files, for the "before".
const mainDir = join(tmpdir(), `firstmate-water-main-${process.pid}`);
await rm(mainDir, { recursive: true, force: true });
await mkdir(mainDir, { recursive: true });
execFileSync("git", ["-C", root, "archive", "--format=tar", "-o", join(mainDir, "main.tar"), "origin/main", "art", "vendor", "server", "shared"]);
execFileSync("tar", ["-xf", "main.tar"], { cwd: mainDir });

await build({
  entryPoints: [join(here, "host.jsx")],
  outfile: join(generated, "water-host.js"),
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
/** Each side's own `server/ship-deck.ts`, as the daemon would run it beside that side's bundle. */
async function serverOf(name, dir) {
  await build({
    entryPoints: [join(dir, "server/ship-deck.ts")],
    outfile: join(generated, `ship-deck-server-water-${name}.mjs`),
    bundle: true,
    platform: "node",
    format: "esm",
    nodePaths: [join(root, "node_modules")],
    logLevel: "warning",
  });
  return import(pathToFileURL(join(generated, `ship-deck-server-water-${name}.mjs`)).href);
}

/** One page server per side: its bundle, and the art read from its own folder by its own server code. */
async function side(bundle, dir) {
  const server = await serverOf(bundle, dir);
  const extras = await server.readDeckExtras(async () => dir);
  const served = {
    "/deck-engine.json": JSON.stringify(await server.readDeckEngine(async () => dir)),
    "/deck-art.json": JSON.stringify(await server.readDeckArt(async () => dir)),
    "/deck-environment.json": JSON.stringify(await server.readDeckEnvironment(async () => dir)),
    "/deck-extras.json": JSON.stringify(extras),
  };
  const files = { "/host.js": join(generated, "water-host.js"), [`/bundle/${bundle}.js`]: join(generated, `${bundle}.client.js`) };
  const page = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:Segoe UI,sans-serif}*{box-sizing:border-box}</style>
<div id="root"></div><script src="/host.js"></script>
<script>(async () => { const params = new URLSearchParams(location.search);
  const source = await (await fetch("/bundle/" + params.get("bundle") + ".js")).text(); window.mountPlugin(source, params); })();</script>`;
  const http = createServer(async (request, response) => {
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
  await new Promise((done) => http.listen(0, "127.0.0.1", done));
  return { http, extras: extras.manifest, url: `http://127.0.0.1:${http.address().port}/?bundle=${bundle}&top=${extras.manifest.mast.position[1]}` };
}
const sides = { before: await side("main", mainDir), after: await side("branch", root) };
assert.equal(sides.before.extras.water, undefined, "main has no animated water");
assert.equal(sides.after.extras.water.sea.frames.length, 4, "the branch serves the four sea frames");
assert.equal(sides.before.extras.mast.position[1], sides.after.extras.mast.position[1], "both sides fit the same mast");

const results = { water: sides.after.extras.water };
const errors = [];
const noon = new Date("2026-10-14T12:00:00Z");

async function open(browser, which, { theme = "dark", reducedMotion = "no-preference", fakeClock = false, time = noon, viewport = { width: 1440, height: 900 }, scale = 2 } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale, reducedMotion, timezoneId: "UTC" });
  const view = await context.newPage();
  view.on("pageerror", (error) => errors.push(`${which} ${theme}: ${error.message}`));
  view.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") errors.push(`${which} ${theme} console ${message.type()}: ${message.text()}`);
  });
  if (fakeClock) await view.clock.install({ time });
  else await view.clock.setFixedTime(time);
  await view.goto(`${sides[which].url}&theme=${theme}`);
  if (fakeClock) await view.clock.pauseAt((await view.evaluate(() => Date.now())) + 100);
  // A compact pane keeps the crew behind its tab.
  const crewTab = () => [...document.querySelectorAll("div")].some((node) => /^Crew \(\d+\)$/.test(node.textContent ?? ""));
  const deckToggle = () => [...document.querySelectorAll("div")].some((node) => node.textContent === "Deck");
  await until(view, fakeClock, `(${crewTab})() || (${deckToggle})()`);
  if (!(await view.evaluate(deckToggle))) await view.getByText(/^Crew \(\d+\)$/).click();
  await until(view, fakeClock, deckToggle);
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
  throw new Error(`timed out waiting for ${predicate}; page errors: ${JSON.stringify(errors)}`);
}

const canvasBox = (view) =>
  view.evaluate(() => {
    const rect = document.querySelector("canvas[data-firstmate-deck]").getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
const canvasShot = async (view, path) => view.screenshot({ clip: await canvasBox(view), path: join(here, path) });
/** The part of the canvas showing deck pixels `[left, top]` to `[right, bottom]`, at the fit's own scale. */
const deckClip = (view, left, top, right, bottom) =>
  view.evaluate(
    ([l, t, r, b]) => {
      const { box, fit } = window.deckGrid();
      return { x: box.left + fit.x + l * fit.scale, y: box.top + fit.y + t * fit.scale, width: (r - l) * fit.scale, height: (b - t) * fit.scale };
    },
    [left, top, right, bottom],
  );
/** What a pane shows, in deck rows and columns. */
const visible = (view) =>
  view.evaluate(() => {
    const { box, fit } = window.deckGrid();
    return { top: -fit.y / fit.scale, bottom: (box.height - fit.y) / fit.scale, left: -fit.x / fit.scale, right: (box.width - fit.x) / fit.scale, scale: fit.scale };
  });
const motion = (view) => view.evaluate(() => document.querySelector("canvas[data-firstmate-deck]").getAttribute("data-firstmate-deck-motion"));
const panel = (view) => view.evaluate(() => document.querySelector("[data-testid=firstmate-deck-focus]")?.getAttribute("aria-label") ?? null);
const img = (png) => `data:image/png;base64,${png.toString("base64")}`;

/** Close on the water: the bow's foam to the pane's right edge at 1440 × 900, the quarterdeck's rail down into the near sea. */
const WATER_VIEW = [40, 110, 434, 250];
/** Around the plank: the mast's foot to the stern, the deck down to the sea under the plank and the wake. */
const PLANK_VIEW = [168, 56, 460, 200];

/**
 * An animated PNG of `frames`, screenshots of one size, each shown `delayMs`, looping. Each frame's own compressed
 * data is reused as it is: the first's IDAT, the rest's as fdAT, so nothing is decoded or re-encoded.
 */
function apng(frames, delayMs) {
  const chunks = (png) => {
    const found = [];
    for (let at = 8; at < png.length; ) {
      const length = png.readUInt32BE(at);
      found.push({ type: png.toString("ascii", at + 4, at + 8), data: png.subarray(at + 8, at + 8 + length) });
      at += length + 12;
    }
    return found;
  };
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, tail]);
  };
  const first = chunks(frames[0]);
  const ihdr = first.find((each) => each.type === "IHDR").data;
  const out = [frames[0].subarray(0, 8), chunk("IHDR", ihdr)];
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(frames.length, 0);
  out.push(chunk("acTL", actl));
  let sequence = 0;
  frames.forEach(function (png, index) {
    const parts = chunks(png);
    assert(parts.find((each) => each.type === "IHDR").data.equals(ihdr), "every frame is the same size and kind");
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(sequence++, 0);
    fctl.writeUInt32BE(ihdr.readUInt32BE(0), 4);
    fctl.writeUInt32BE(ihdr.readUInt32BE(4), 8);
    fctl.writeUInt16BE(delayMs, 20);
    fctl.writeUInt16BE(1000, 22);
    out.push(chunk("fcTL", fctl));
    for (const part of parts.filter((each) => each.type === "IDAT")) {
      if (index === 0) out.push(chunk("IDAT", part.data));
      else {
        const number = Buffer.alloc(4);
        number.writeUInt32BE(sequence++, 0);
        out.push(chunk("fdAT", Buffer.concat([number, part.data])));
      }
    }
  });
  out.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(out);
}

/** Lays out labelled pictures in a grid and screenshots it. */
async function sheet(browser, path, columns, cells, height) {
  const context = await browser.newContext({ viewport: { width: 2400, height: 1400 }, deviceScaleFactor: 1 });
  const view = await context.newPage();
  await view.setContent(`<body style="margin:0;background:#1b1f27;color:#e6e6e6;font:600 20px Segoe UI,sans-serif">
    <div id="sheet" style="display:inline-grid;grid-template-columns:repeat(${columns},auto);gap:16px;padding:16px">
      ${cells.map(([caption, png]) => `<figure style="margin:0"><figcaption style="padding-bottom:6px">${caption}</figcaption><img src="${img(png)}" style="height:${height}px;image-rendering:pixelated"></figure>`).join("")}
    </div></body>`);
  await view.locator("#sheet").screenshot({ path: join(here, path) });
  await context.close();
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  // 1 and 2. The deck and the water, before and after.
  const close = {};
  for (const which of ["before", "after"]) {
    const view = await open(browser, which);
    await canvasShot(view, `${which}-deck.png`);
    const shown = await visible(view);
    close[which] = await view.screenshot({ clip: await deckClip(view, ...WATER_VIEW), path: join(here, `${which}-water.png`) });
    results[which] = { visible: shown, motion: await motion(view) };
    await view.context().close();
  }
  assert.equal(results.before.visible.scale, results.after.visible.scale, "the close-ups are at one scale");
  await sheet(browser, "before-after-water.png", 1, [["Before (main): the still tile, the generic foam strip, the wake's dashes drawn in code", close.before], ["After: the generated sea, foam and stern wake", close.after]], 560);
  for (const [name, which, theme, time] of [
    ["before-deck-night.png", "before", "dark", new Date("2026-10-14T02:00:00Z")],
    ["after-deck-night.png", "after", "dark", new Date("2026-10-14T02:00:00Z")],
    ["after-deck-dusk.png", "after", "dark", new Date("2026-10-14T18:30:00Z")],
    ["after-deck-light.png", "after", "light", new Date("2026-10-14T16:30:00Z")],
  ]) {
    const view = await open(browser, which, { theme, time });
    await canvasShot(view, name);
    if (name === "after-deck-night.png") await view.screenshot({ clip: await deckClip(view, ...WATER_VIEW), path: join(here, "after-water-night.png") });
    await view.context().close();
  }

  // 3. The cycle: four moments 240 ms apart on the fake clock, on each side.
  results.cycle = {};
  const cells = [];
  for (const which of ["before", "after"]) {
    const view = await open(browser, which, { fakeClock: true });
    const frames = [];
    for (let step = 0; step < 4; step += 1) {
      if (step > 0) await view.clock.runFor(240);
      frames.push(await view.screenshot({ clip: await deckClip(view, ...WATER_VIEW) }));
    }
    results.cycle[which] = { distinctFrames: new Set(frames.map((png) => png.toString("base64"))).size, motion: await motion(view) };
    frames.forEach((png, step) => cells.push([`${which === "before" ? "Before" : "After"}, ${step * 240} ms`, png]));
    await view.context().close();
  }
  assert.equal(results.cycle.after.distinctFrames, 4, "the water changes every 240 ms");
  await sheet(browser, "cycle.png", 2, [0, 1, 2, 3].flatMap((step) => [cells[step], cells[4 + step]]), 300);
  // Three seconds of each, a frame every 120 ms on the fake clock, as an animated PNG: motion stills cannot show.
  results.animation = {};
  for (const which of ["before", "after"]) {
    const view = await open(browser, which, { fakeClock: true, scale: 1 });
    const frames = [];
    for (let step = 0; step < 25; step += 1) {
      if (step > 0) await view.clock.runFor(120);
      frames.push(await view.screenshot({ clip: await deckClip(view, ...WATER_VIEW) }));
    }
    await writeFile(join(here, `${which}-water-animated.png`), apng(frames, 120));
    results.animation[which] = { frames: frames.length, delayMs: 120 };
    await view.context().close();
  }

  // 4. The pane: every size shows the ship whole, the wake and the shark's sea.
  results.panes = {};
  for (const [name, viewport, scale] of [
    ["after-pane-wide-short.png", { width: 2300, height: 560 }, 1],
    ["after-pane-narrow-tall.png", { width: 1000, height: 1100 }, 2],
    ["after-pane-fractional.png", { width: 1203, height: 911 }, 1.25],
  ]) {
    const view = await open(browser, "after", { viewport, scale });
    await canvasShot(view, name);
    const shown = await visible(view);
    results.panes[name] = shown;
    if (name === "after-pane-wide-short.png") {
      // Wide enough for the whole wake: close on it, and the same pane before.
      const right = Math.min(shown.right, 640);
      const bottom = Math.min(shown.bottom, 250);
      await view.screenshot({ clip: await deckClip(view, 40, 110, right, bottom), path: join(here, "after-wake-wide.png") });
      const before = await open(browser, "before", { viewport, scale });
      await before.screenshot({ clip: await deckClip(before, 40, 110, right, bottom), path: join(here, "before-wake-wide.png") });
      await before.context().close();
    }
    assert(shown.bottom > 171, `${name}: the shark's sea is in view (${shown.bottom})`);
    assert(shown.left <= 0 && shown.right >= 426, `${name}: the ship is whole across`);
    await view.context().close();
  }

  // 5. The plank, and the way off it, beat by beat on the fake clock: the splash and the shark over the near sea.
  {
    const view = await open(browser, "after", { fakeClock: true });
    const key = "work-1";
    await view.evaluate(([k]) => window.leave(k, "done"), [[key]]);
    await view.getByRole("button", { name: "Refresh" }).click();
    await view.clock.runFor(33);
    const { boards, sequence } = await view.evaluate((k) => window.plankTimes(k), [key]);
    const board = boards[key];
    assert(board > 0, "the crewmate reaches the plank");
    const beats = [
      ["plank-1-on-the-board", board + sequence.onPlank],
      ["plank-2-splash", board + sequence.impact + 120],
      ["plank-3-chomp", board + sequence.chomp + 90],
    ];
    let at = 33;
    for (const [name, t] of beats) {
      await view.clock.runFor(Math.max(0, t - at));
      at = Math.max(at, t);
      await view.screenshot({ clip: await deckClip(view, ...PLANK_VIEW), path: join(here, `${name}.png`) });
    }
    results.plank = { key, boardsAfterMs: board, beats: Object.fromEntries(beats), motion: await motion(view) };
    assert.equal(results.plank.motion, "full");
    await view.context().close();
  }

  // 6. Click to focus, over the new water.
  {
    const view = await open(browser, "after");
    await view.evaluate(() => document.querySelector("[aria-label^='Ship deck:']").focus());
    await view.keyboard.press("ArrowRight");
    await view.waitForTimeout(700);
    const name = await panel(view);
    assert(name !== null, "a sailor is focused");
    await canvasShot(view, "after-focused.png");
    await view.keyboard.press("Escape");
    await view.waitForTimeout(700);
    results.focus = { panel: name, after: await panel(view) };
    assert.equal(results.focus.after, null, "back out");
    await canvasShot(view, "after-focus-back-out.png");
    await view.context().close();
  }

  // 7. Reduced motion: still, and the water on its calm first frames, held a second later.
  {
    const view = await open(browser, "after", { reducedMotion: "reduce" });
    const first = await view.screenshot({ clip: await deckClip(view, ...WATER_VIEW) });
    await view.waitForTimeout(1000);
    const later = await view.screenshot({ clip: await deckClip(view, ...WATER_VIEW) });
    results.reducedMotion = { motion: await motion(view), held: first.equals(later) };
    assert.equal(results.reducedMotion.motion, "still");
    assert.equal(results.reducedMotion.held, true, "the still deck's water does not move");
    await canvasShot(view, "after-still.png");
    await view.context().close();
  }
} finally {
  await browser.close();
  for (const each of Object.values(sides)) each.http.close();
  await rm(mainDir, { recursive: true, force: true });
}

results.errors = errors;
await writeFile(join(here, "render-results.json"), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results, null, 2));
assert.deepEqual(errors, [], "no page errors or warnings");
