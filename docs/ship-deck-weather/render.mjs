/**
 * The heavy weather at the top of the dial, in a real browser, from the bundle Paseo's own compiler makes
 * (`node docs/ship-deck-canvas/compile.mjs` first: it writes this branch's bundle). Headless Edge, never a daemon,
 * through the atmosphere harness's host and its fixture fleet, `?working=N` putting N of its crewmates to work.
 *
 * 1. **The ramp** — every weather layer's opacity for 0 to 8 working, from the deck's functions and extras.json's curves.
 * 2. **Stills** — the ship and its water at noon with 0, 2, 3, 4, 5 and the busiest count working; the whole deck
 *    calm (2 working) and in the storm; the storm at night.
 * 3. **The motion** — three seconds at 2 and the busiest, 150 ms a frame on the fake clock, as animated PNGs; and the
 *    storm rolling in over fifteen seconds after the crew goes to work, a frame a second.
 * 4. **Lightning** — ninety seconds of the busy deck, each flash read off the canvas (`data-firstmate-deck-flash`),
 *    the first caught beside the moment before it.
 * 5. **Reduced motion** — the busiest crew and still: the sea exactly the calm deck's, held a second later.
 * 6. **Click to focus** — a sailor focused and back out in the storm.
 *
 * Writes the pictures and `render-results.json` here.
 */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { crc32 } from "node:zlib";
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
  outfile: join(generated, "weather-host.js"),
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
  outfile: join(generated, "ship-deck-server-weather.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  nodePaths: [join(root, "node_modules")],
  logLevel: "warning",
});
const server = await import(pathToFileURL(join(generated, "ship-deck-server-weather.mjs")).href);
const extras = await server.readDeckExtras(async () => root);
const served = {
  "/deck-engine.json": JSON.stringify(await server.readDeckEngine(async () => root)),
  "/deck-art.json": JSON.stringify(await server.readDeckArt(async () => root)),
  "/deck-environment.json": JSON.stringify(await server.readDeckEnvironment(async () => root)),
  "/deck-extras.json": JSON.stringify(extras),
};
const files = { "/host.js": join(generated, "weather-host.js"), "/bundle/branch.js": join(generated, "branch.client.js") };
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
const base = `http://127.0.0.1:${http.address().port}/?bundle=branch&top=${extras.manifest.mast.position[1]}`;

const results = {};
const errors = [];
const noon = new Date("2026-10-14T12:00:00Z");

async function open(browser, working, { reducedMotion = "no-preference", fakeClock = false, viewport = { width: 1440, height: 900 }, scale = 2, time = noon } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale, reducedMotion, timezoneId: "UTC" });
  const view = await context.newPage();
  view.on("pageerror", (error) => errors.push(`${working} working: ${error.message}`));
  view.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") errors.push(`${working} working console ${message.type()}: ${message.text()}`);
  });
  if (fakeClock) await view.clock.install({ time });
  else await view.clock.setFixedTime(time);
  await view.goto(`${base}&theme=dark&working=${working}`);
  if (fakeClock) await view.clock.pauseAt((await view.evaluate(() => Date.now())) + 1000);
  const deckToggle = () => [...document.querySelectorAll("div")].some((node) => node.textContent === "Deck");
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
const deckClip = (view, left, top, right, bottom) =>
  view.evaluate(
    ([l, t, r, b]) => {
      const { box, fit } = window.deckGrid();
      return { x: box.left + fit.x + l * fit.scale, y: box.top + fit.y + t * fit.scale, width: (r - l) * fit.scale, height: (b - t) * fit.scale };
    },
    [left, top, right, bottom],
  );
const weatherOf = (view) => view.evaluate(() => document.querySelector("canvas[data-firstmate-deck]").getAttribute("data-firstmate-deck-weather"));
const panel = (view) => view.evaluate(() => document.querySelector("[data-testid=firstmate-deck-focus]")?.getAttribute("aria-label") ?? null);
const img = (png) => `data:image/png;base64,${png.toString("base64")}`;

/** The ship under sail and its water: the sail's top to the near sea, the bow's foam to the pane's right edge. */
const SHIP_VIEW = [40, -40, 434, 230];
/** Open sea only, ahead of the bow and under it: no crew, no hull. */
const SEA_VIEW = [0, 170, 380, 230];

/** An animated PNG of `frames`, screenshots of one size, each shown `delayMs`, looping (as `docs/ship-deck-water/render.mjs`). */
function apng(frames, delayMs) {
  const chunks = (png) => {
    const found = [];
    for (let at = 8; at < png.length;) {
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

/** The average share of pixels that differ from one screenshot to the next, decoded in a page. */
async function churn(browser, frames) {
  const context = await browser.newContext();
  const view = await context.newPage();
  const share = await view.evaluate(async (sources) => {
    const pixels = [];
    for (const source of sources) {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      pixels.push(context.getImageData(0, 0, image.width, image.height).data);
    }
    let total = 0;
    for (let index = 1; index < pixels.length; index += 1) {
      const [a, b] = [pixels[index - 1], pixels[index]];
      let changed = 0;
      for (let at = 0; at < a.length; at += 4) if (a[at] !== b[at] || a[at + 1] !== b[at + 1] || a[at + 2] !== b[at + 2]) changed += 1;
      total += changed / (a.length / 4);
    }
    return total / (pixels.length - 1);
  }, frames.map(img));
  await context.close();
  return Math.round(share * 1000) / 1000;
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
  // 1. The ramp.
  {
    const view = await open(browser, 0);
    results.ramp = await view.evaluate(() => window.weatherLayers([0, 1, 2, 3, 4, 5, 6, 8]));
    await view.context().close();
  }
  const busiest = (results.ramp.find((row) => row.intensity >= 1) ?? results.ramp.at(-1)).working;
  for (const row of results.ramp.filter((each) => each.working <= 3)) {
    assert(Object.values(row.layers).every((value) => value === 0), `no weather layer at ${row.working} working`);
  }

  // 2. Stills: the ramp at noon, close; the whole deck calm and stormy; the storm at night.
  const ramp = [];
  results.stills = {};
  for (const working of [0, 2, 3, 4, 5, busiest]) {
    const view = await open(browser, working, { fakeClock: true });
    await view.clock.runFor(2000);
    ramp.push([`${working} working (intensity ${await weatherOf(view)})`, await view.screenshot({ clip: await deckClip(view, ...SHIP_VIEW) })]);
    if (working === 2) await canvasShot(view, "calm-deck.png");
    if (working === busiest) await canvasShot(view, "storm-deck.png");
    results.stills[working] = await weatherOf(view);
    await view.context().close();
  }
  await sheet(browser, "storm-ramp.png", 3, ramp, 300);
  await sheet(browser, "calm-vs-storm.png", 2, [ramp[1], ramp.at(-1)], 520);
  {
    const view = await open(browser, busiest, { fakeClock: true, time: new Date("2026-10-15T01:00:00Z") });
    await view.clock.runFor(2000);
    await canvasShot(view, "storm-night.png");
    await view.context().close();
  }

  // 3. The motion, and the storm rolling in.
  results.motion = {};
  for (const [name, working] of [
    ["calm", 2],
    ["storm", busiest],
  ]) {
    const view = await open(browser, working, { fakeClock: true, scale: 1 });
    const frames = { ship: [], sea: [] };
    for (let step = 0; step < 20; step += 1) {
      if (step > 0) await view.clock.runFor(150);
      frames.ship.push(await view.screenshot({ clip: await deckClip(view, ...SHIP_VIEW) }));
      frames.sea.push(await view.screenshot({ clip: await deckClip(view, ...SEA_VIEW) }));
    }
    await writeFile(join(here, `animated-${name}.png`), apng(frames.ship, 150));
    results.motion[name] = { working, weather: await weatherOf(view), seaPixelsChangedPerFrame: await churn(browser, frames.sea) };
    await view.context().close();
  }
  {
    const view = await open(browser, 2, { fakeClock: true, scale: 1 });
    await view.evaluate((count) => window.setWorking(count), busiest);
    await view.getByRole("button", { name: "Refresh" }).click();
    const frames = [];
    const seen = [];
    for (let step = 0; step < 16; step += 1) {
      if (step > 0) await view.clock.runFor(1000);
      frames.push(await view.screenshot({ clip: await deckClip(view, ...SHIP_VIEW) }));
      seen.push(Number(await weatherOf(view)));
    }
    await writeFile(join(here, "storm-rolls-in.png"), apng(frames, 600));
    results.rollIn = { everySecond: seen };
    assert.deepEqual(
      seen,
      [...seen].sort((a, b) => a - b),
      "the weather only rises as the crew goes to work",
    );
    await view.context().close();
  }

  // 4. Lightning: ninety seconds of the busy deck, a twentieth of a second apart, each flash read off the canvas
  // (`data-firstmate-deck-flash`) and the first caught beside the moment before it.
  {
    const view = await open(browser, busiest, { fakeClock: true });
    const flashing = () => view.evaluate(() => document.querySelector("canvas[data-firstmate-deck]").getAttribute("data-firstmate-deck-flash"));
    const SKY = [-40, -80, 466, 100];
    const seen = [];
    let before = await view.screenshot({ clip: await deckClip(view, ...SKY) });
    let caught = null;
    let showing = false;
    for (let step = 0; step < 1800; step += 1) {
      await view.clock.runFor(50);
      const now = (await flashing()) ?? "";
      if (now !== "" && !showing) {
        seen.push((step + 1) / 20);
        if (caught === null) caught = [before, await view.screenshot({ clip: await deckClip(view, ...SKY) }), (step + 1) / 20];
      }
      showing = now !== "";
      if (!showing && caught === null && step % 10 === 0) before = await view.screenshot({ clip: await deckClip(view, ...SKY) });
    }
    results.lightning = { seconds: 90, flashesAt: seen };
    assert(seen.length >= 1, "lightning flashes with a busy fleet");
    assert(seen.length <= 6, "and no more than the cap");
    if (caught !== null) {
      await sheet(
        browser,
        "lightning.png",
        2,
        [
          ["Just before", caught[0]],
          [`A flash, ${caught[2]} s in: a faint distant fork under a thunderhead`, caught[1]],
        ],
        420,
      );
    }
    await view.context().close();
  }

  // 5. Reduced motion: the busiest crew's sea is the calm deck's, and held.
  {
    const calm = await open(browser, 0, { reducedMotion: "reduce" });
    const calmSea = await calm.screenshot({ clip: await deckClip(calm, ...SEA_VIEW) });
    await calm.context().close();
    const view = await open(browser, busiest, { reducedMotion: "reduce" });
    const first = await view.screenshot({ clip: await deckClip(view, ...SEA_VIEW) });
    await view.waitForTimeout(1000);
    const later = await view.screenshot({ clip: await deckClip(view, ...SEA_VIEW) });
    results.reducedMotion = { weather: await weatherOf(view), held: first.equals(later), calmSea: first.equals(calmSea) };
    assert.equal(results.reducedMotion.weather, "still");
    assert.equal(results.reducedMotion.held, true, "the still deck does not move");
    assert.equal(results.reducedMotion.calmSea, true, "and its sea is the calm one, however busy");
    await canvasShot(view, "still-busy.png");
    await view.context().close();
  }

  // 6. Click to focus and back out, in the storm.
  {
    const view = await open(browser, busiest);
    await view.evaluate(() => document.querySelector("[aria-label^='Ship deck:']").focus());
    await view.keyboard.press("ArrowRight");
    await view.waitForTimeout(700);
    const name = await panel(view);
    assert(name !== null, "a sailor is focused");
    await view.keyboard.press("Escape");
    await view.waitForTimeout(700);
    results.focus = { panel: name, after: await panel(view), weather: await weatherOf(view) };
    assert.equal(results.focus.after, null, "back out");
    await view.context().close();
  }
} finally {
  await browser.close();
  http.close();
}

results.errors = errors;
await writeFile(join(here, "render-results.json"), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results, null, 2));
assert.deepEqual(errors, [], "no page errors or warnings");
