/**
 * The ship deck in a real browser, from the bundles Paseo's own compiler makes (`compile.mjs` first).
 * Headless Edge, never a daemon. Each run evaluates a compiled `clientBundle` the way the app does and
 * renders the screen the plugin contributes, with the board-list fixture fleet:
 *
 * 1. **Switch off**: origin/main's bundle and this branch's, same fixture, same frozen clock — the screen's
 *    DOM must be identical, character for character, wide and narrow; no Deck, no canvas, no Pixi fetched.
 * 2. **Switch on**: Deck appears beside Crew and Files; opening it starts Pixi from the served build on a
 *    WebGL canvas inside the deck's react-native-web view, with the served art. The screenshot, read at
 *    every art pixel, is the deck a 2D canvas draws independently from the same scene, atlas and layer
 *    order — hull, props, sailors and depth pieces — so each sailor is where its state puts it, in its
 *    pose, and hidden exactly where the mast, a bollard or the near rail stands in front of it. A poll
 *    that changes the crew redraws it, a resize resizes it, and leaving the Deck takes the canvas away.
 * 3. **No WebGL** (`--disable-webgl`): the Deck says so in words, and neither Pixi nor the art is fetched.
 *
 * Run: `node docs/ship-deck-canvas/compile.mjs && node docs/ship-deck-canvas/render.mjs`, with
 * `docs/board-list`'s `npm ci` done. Writes the screenshots and `render-results.json` here.
 */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const generated = join(here, ".generated");
await mkdir(generated, { recursive: true });
const rootRequire = createRequire(join(root, "package.json"));
const harness = createRequire(join(here, "../board-list/package.json"));
const { build } = harness("esbuild");
const { chromium } = harness("playwright");

// The host: React, react-native-web, React Query, zod and the stubs, as the app would inject them.
await build({
  entryPoints: [join(here, "host.jsx")],
  outfile: join(generated, "host.js"),
  bundle: true,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "warning",
  plugins: [
    {
      name: "host",
      setup(builder) {
        builder.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: join(here, "../board-list/contracts.js") }));
        builder.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: join(here, "stubs.jsx") }));
        builder.onResolve({ filter: /^(react|zod|@tanstack\/react-query)($|\/)/ }, (args) => ({ path: rootRequire.resolve(args.path) }));
        builder.onResolve({ filter: /^react-dom($|\/)/ }, (args) => ({ path: harness.resolve(args.path) }));
        builder.onResolve({ filter: /^react-native(-web)?$/ }, () => ({ path: harness.resolve("react-native-web") }));
      },
    },
  ],
});

// What `firstmate.deck.engine` and `firstmate.deck.art` answer with the switch on: the server's own code, reading vendor/ and art/.
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
  if (path === "/deck-engine.json") {
    response.setHeader("Content-Type", "application/json");
    response.end(deckEngine);
  } else if (path === "/deck-art.json") {
    response.setHeader("Content-Type", "application/json");
    response.end(deckArt);
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

const results = { flagOff: [], flagOn: [], noWebgl: null };
const errors = [];

async function open(browser, { bundle, deck = false, theme = "dark", width = 1440, scale = 1 }) {
  const view = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 900 }, deviceScaleFactor: scale });
  view.on("pageerror", (error) => errors.push(`${bundle}/${theme}/${width}: ${error.message}`));
  view.on("console", (message) => {
    if (message.type() === "error") errors.push(`${bundle}/${theme}/${width} console: ${message.text()}`);
  });
  await view.clock.setFixedTime(now);
  await view.goto(`${origin}/?bundle=${bundle}&theme=${theme}${deck ? "&deck=1" : ""}`);
  await view.getByText(width < 600 ? "First mate" : "Brief helper: coach prompt, skill and button", { exact: true }).first().waitFor();
  return view;
}

/** The screen's DOM once it has stopped changing: the suggestion strip measures itself over a few frames. */
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
      assert.fail(`switch off at ${width}px: the DOM differs from main's at ${at}:
 main:   ${mainHtml.slice(at - 300, at + 300)}
 branch: ${branchHtml.slice(at - 300, at + 300)}`);
    }
    const off = await branch.evaluate(() => ({
      deckButton: [...document.querySelectorAll("[role=button],[role=tab]")].some((node) => node.textContent === "Deck"),
      canvases: document.querySelectorAll("canvas").length,
      deckEngineCalls: window.deckEngineCalls,
      deckArtCalls: window.deckArtCalls,
      pixiGlobal: "PIXI" in window,
    }));
    assert.deepEqual(off, { deckButton: false, canvases: 0, deckEngineCalls: 0, deckArtCalls: 0, pixiGlobal: false });
    if (width === 1440) await branch.screenshot({ path: join(here, "flag-off-1440-dark.png") });
    results.flagOff.push({ width, domIdenticalToMain: true, domChars: branchHtml.length, ...off });
    await main.close();
    await branch.close();
  }

  // 2. On: the Deck, drawn with WebGL from the fixture fleet and the served art. A 2x display, as most
  // laptops are, so the deck is scaled by whole device pixels and every art pixel can be read back.
  for (const theme of ["dark", "light"]) {
    const view = await open(browser, { bundle: "branch", deck: true, theme, scale: 2 });
    await view.getByText("Deck", { exact: true }).click();
    await view.locator("canvas[data-firstmate-deck]").waitFor();
    await view.getByText(/drawn with WebGL · \d+ on deck/).waitFor();
    const facts = await view.evaluate(() => {
      const canvas = document.querySelector("canvas[data-firstmate-deck]");
      const host = canvas.parentElement;
      return {
        renderer: canvas.getAttribute("data-firstmate-deck"),
        webgl2: canvas.getContext("webgl2") !== null,
        hostRole: host.getAttribute("role"),
        hostLabel: host.getAttribute("aria-label"),
        canvasFillsHost: canvas.clientWidth === host.clientWidth && canvas.clientHeight === host.clientHeight,
        hostReactChildren: host.children.length,
        caption: [...document.querySelectorAll("div")].map((node) => node.textContent).find((text) => /^Preview · drawn/.test(text)),
        deckEngineCalls: window.deckEngineCalls,
        deckArtCalls: window.deckArtCalls,
        pixiGlobal: "PIXI" in window,
      };
    });
    // Off the Deck button and out of focus, so its tooltip is not in the picture.
    await view.mouse.move(700, 880);
    await view.evaluate(() => document.activeElement?.blur());
    await view.waitForTimeout(300);
    const shot = await view.screenshot({ path: join(here, `deck-1440-${theme}.png`) });
    const drawn = await compare(view, shot);
    assert.deepEqual(drawn.counts, { working: 5, waiting: 1, blocked: 4, idle: 2 });
    assert.equal(facts.renderer, "webgl");
    assert.equal(facts.hostRole, "img");
    assert.equal(facts.canvasFillsHost, true);
    assert.equal(facts.hostReactChildren, 1, "the host view holds only Pixi's canvas");
    assert.equal(facts.deckEngineCalls, 1);
    assert.equal(facts.deckArtCalls, 1);
    assert.equal(facts.pixiGlobal, false, "Pixi's namespace stays out of the page's globals");

    let after = {};
    if (theme === "dark") {
      // A crop of the hull at 3x the deck's own scale, for the eye: the depth pieces in front of sailors.
      const crop = await view.evaluate(() => {
        const canvas = document.querySelector("canvas[data-firstmate-deck]").getBoundingClientRect();
        return { x: canvas.left, y: canvas.top, width: canvas.width, height: canvas.height };
      });
      await view.screenshot({ path: join(here, "deck-1440-dark-canvas.png"), clip: crop });
      // A poll that changes the crew: two blocked crewmates are let go; the deck redraws from the new cards.
      await view.evaluate(() => {
        window.fixtureFleet.cards = window.fixtureFleet.cards.filter((card) => card.key !== "block-0" && card.key !== "block-1");
      });
      await view.getByRole("button", { name: "Refresh" }).click();
      await view.getByText("Preview · drawn with WebGL · 10 on deck").waitFor();
      const reshot = await view.screenshot({ path: join(here, "deck-1440-dark-after-poll.png") });
      const redrawn = await compare(view, reshot);
      // A narrower window: the canvas follows its view.
      await view.setViewportSize({ width: 1100, height: 900 });
      await view.waitForFunction(() => {
        const canvas = document.querySelector("canvas[data-firstmate-deck]");
        return canvas.clientWidth === canvas.parentElement.clientWidth;
      });
      const resized = await view.evaluate(() => document.querySelector("canvas[data-firstmate-deck]").clientWidth);
      // Leaving the Deck takes the canvas with it.
      await view.getByText(/^Crew \(/).click();
      await view.waitForFunction(() => document.querySelectorAll("canvas").length === 0);
      after = {
        redrawnOnPoll: { counts: redrawn.counts, artPixelsMatching: redrawn.matching },
        resizedCanvasWidth: resized,
        canvasesAfterLeaving: 0,
        deckEngineCallsAfterRedraw: await view.evaluate(() => window.deckEngineCalls),
        deckArtCallsAfterRedraw: await view.evaluate(() => window.deckArtCalls),
      };
    }
    results.flagOn.push({ theme, ...facts, ...drawn, ...after });
    await view.close();
  }
} finally {
  await browser.close();
}

/**
 * The screenshot against the deck the 2D reference draws, art pixel by art pixel, outside each sailor's
 * state mark (a soft ellipse the reference does not draw). Every one must match; and the sailors the scene
 * stands behind the mast, a bollard or the near rail must be hidden there.
 */
async function compare(view, shot) {
  const reference = await view.evaluate(() => window.referenceDeck());
  const actual = await view.evaluate(([png, at]) => window.deckPixels(png, at), [shot.toString("base64"), reference]);
  const marked = (x, y) => reference.marks.some((mark) => Math.abs(x - mark.x) <= 7 && y - mark.y >= -3 && y - mark.y <= 2);
  let compared = 0;
  const mismatches = [];
  for (let y = 0; y < reference.height; y += 1) {
    for (let x = 0; x < reference.width; x += 1) {
      if (marked(x, y)) continue;
      compared += 1;
      const at = y * reference.width + x;
      const want = reference.pixels.slice(at * 4, at * 4 + 3);
      const got = actual.slice(at * 3, at * 3 + 3);
      if (want.some((value, index) => Math.abs(value - got[index]) > 3)) mismatches.push({ x, y, want, got });
    }
  }
  assert.equal(Number.isInteger(reference.fit.scale * reference.dpr), true, `whole device pixels per art pixel: ${reference.fit.scale * reference.dpr}`);
  assert.deepEqual(mismatches.slice(0, 10), [], `${mismatches.length} of ${compared} art pixels differ from the reference`);
  // Each sailor is on screen: its own art pixels show where nothing stands in front of it.
  const sailors = reference.sailors.map(({ pixels, ...sailor }) => {
    const hidden = Object.values(sailor.hiddenBy).reduce((sum, count) => sum + count, 0);
    return { ...sailor, artPixels: pixels.length, visible: pixels.length - hidden };
  });
  for (const sailor of sailors) assert(sailor.visible > sailor.artPixels / 3, `${sailor.key} is mostly visible`);
  const hiddenBy = (name) => sailors.filter((sailor) => (sailor.hiddenBy[name] ?? 0) > 0).map((sailor) => sailor.key);
  return {
    counts: reference.counts,
    scale: reference.fit.scale,
    devicePixelsPerArtPixel: reference.fit.scale * reference.dpr,
    artPixelsCompared: compared,
    matching: compared - mismatches.length,
    drawOrder: reference.order,
    behindTheMast: hiddenBy("mast"),
    behindTheNearRail: hiddenBy("near"),
    behindABollard: ["bollard-bow-aft", "bollard-bow-fore", "bollard-gunwale-fore", "bollard-gunwale-aft"].flatMap(hiddenBy),
    sailors,
  };
}

// 3. No WebGL: a plain message, and the daemon is never asked for Pixi.
const noGl = await chromium.launch({ channel: "msedge", headless: true, args: ["--disable-webgl", "--disable-3d-apis"] });
try {
  const view = await open(noGl, { bundle: "branch", deck: true });
  await view.getByText("Deck", { exact: true }).click();
  await view.getByText(/This display has no WebGL/).waitFor();
  await view.mouse.move(700, 880);
  results.noWebgl = await view.evaluate(() => ({
    canvases: document.querySelectorAll("canvas").length,
    deckEngineCalls: window.deckEngineCalls,
    deckArtCalls: window.deckArtCalls,
  }));
  assert.deepEqual(results.noWebgl, { canvases: 0, deckEngineCalls: 0, deckArtCalls: 0 });
  await view.screenshot({ path: join(here, "deck-no-webgl.png") });
  await view.close();
} finally {
  await noGl.close();
  await new Promise((done) => server.close(done));
}

results.errors = errors;
await writeFile(join(here, "render-results.json"), JSON.stringify(results, null, 2) + "\n");
assert.deepEqual(errors, [], "no page errors or console errors");
console.log(JSON.stringify({ ...results, flagOn: results.flagOn.map(({ sailors, drawOrder, ...rest }) => rest) }, null, 2));
