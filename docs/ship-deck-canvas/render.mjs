/**
 * The ship deck in a real browser, from the bundles Paseo's own compiler makes (`compile.mjs` first).
 * Headless Edge, never a daemon. Each run evaluates a compiled `clientBundle` the way the app does and
 * renders the screen the plugin contributes, with the board-list fixture fleet:
 *
 * 1. **Switch off**: origin/main's bundle and this branch's, same fixture, same frozen clock — the screen's
 *    DOM must be identical, character for character, wide and narrow; no Deck, no canvas, no Pixi fetched.
 * 2. **Switch on**: Deck appears beside Crew and Files; opening it starts Pixi from the served build on a
 *    WebGL canvas inside the deck's react-native-web view; the screenshot has each sailor's state colour
 *    where the scene puts it, and the deck's colour on the deck. A poll that changes the crew redraws it,
 *    a resize resizes it, and leaving the Deck takes the canvas away.
 * 3. **No WebGL** (`--disable-webgl`): the Deck says so in words, and Pixi is never fetched.
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

// What `firstmate.deck.engine` answers with the switch on: the server's own code, reading vendor/.
await build({
  entryPoints: [join(root, "server/ship-deck.ts")],
  outfile: join(generated, "ship-deck-server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "warning",
});
const { readDeckEngine } = await import(pathToFileURL(join(generated, "ship-deck-server.mjs")).href);
const deckEngine = JSON.stringify(await readDeckEngine({ FIRSTMATE_SHIP_DECK: "1" }, async () => root));

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

async function open(browser, { bundle, deck = false, theme = "dark", width = 1440 }) {
  const view = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 900 } });
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
      pixiGlobal: "PIXI" in window,
    }));
    assert.deepEqual(off, { deckButton: false, canvases: 0, deckEngineCalls: 0, pixiGlobal: false });
    if (width === 1440) await branch.screenshot({ path: join(here, "flag-off-1440-dark.png") });
    results.flagOff.push({ width, domIdenticalToMain: true, domChars: branchHtml.length, ...off });
    await main.close();
    await branch.close();
  }

  // 2. On: the Deck, drawn with WebGL from the fixture fleet.
  for (const theme of ["dark", "light"]) {
    const view = await open(browser, { bundle: "branch", deck: true, theme });
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
        pixiGlobal: "PIXI" in window,
      };
    });
    const expected = await view.evaluate(() => window.expectedSailors());
    // Off the Deck button and out of focus, so its tooltip is not in the picture.
    await view.mouse.move(700, 880);
    await view.evaluate(() => document.activeElement?.blur());
    await view.waitForTimeout(300);
    const shot = await view.screenshot({ path: join(here, `deck-1440-${theme}.png`) });
    const points = [expected.deckPoint, ...expected.sailors];
    const pixels = await view.evaluate(([png, at]) => window.pixelsAt(png, at), [shot.toString("base64"), points]);
    const hex = (color) => [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16));
    const near = (actual, color) => actual.every((value, index) => Math.abs(value - hex(color)[index]) <= 6);
    assert(near(pixels[0], expected.deckColor), `deck colour at the open deck: ${pixels[0]}`);
    const sailors = expected.sailors.map((sailor, index) => ({ ...sailor, pixel: pixels[index + 1], matches: near(pixels[index + 1], sailor.color) }));
    assert(sailors.every((sailor) => sailor.matches), `every sailor's colour: ${JSON.stringify(sailors.filter((s) => !s.matches))}`);
    assert.deepEqual(expected.counts, { working: 5, waiting: 1, blocked: 4, idle: 2 });
    assert.equal(facts.renderer, "webgl");
    assert.equal(facts.hostRole, "img");
    assert.equal(facts.canvasFillsHost, true);
    assert.equal(facts.hostReactChildren, 1, "the host view holds only Pixi's canvas");
    assert.equal(facts.deckEngineCalls, 1);
    assert.equal(facts.pixiGlobal, false, "Pixi's namespace stays out of the page's globals");

    let after = {};
    if (theme === "dark") {
      // A poll that changes the crew: two blocked crewmates are let go; the deck redraws from the new cards.
      await view.evaluate(() => {
        window.fixtureFleet.cards = window.fixtureFleet.cards.filter((card) => card.key !== "block-0" && card.key !== "block-1");
      });
      await view.getByRole("button", { name: "Refresh" }).click();
      await view.getByText("Preview · drawn with WebGL · 10 on deck").waitFor();
      const redrawn = await view.evaluate(() => window.expectedSailors());
      const reshot = await view.screenshot({ path: join(here, "deck-1440-dark-after-poll.png") });
      const repixels = await view.evaluate(([png, at]) => window.pixelsAt(png, at), [reshot.toString("base64"), redrawn.sailors]);
      assert(redrawn.sailors.every((sailor, index) => near(repixels[index], sailor.color)), "redrawn sailors");
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
      after = { redrawnOnPoll: redrawn.counts, resizedCanvasWidth: resized, canvasesAfterLeaving: 0, deckEngineCallsAfterRedraw: await view.evaluate(() => window.deckEngineCalls) };
    }
    results.flagOn.push({ theme, ...facts, counts: expected.counts, sailors: sailors.map(({ key, state, color, pixel }) => ({ key, state, color, pixel })), ...after });
    await view.close();
  }
} finally {
  await browser.close();
}

// 3. No WebGL: a plain message, and the daemon is never asked for Pixi.
const noGl = await chromium.launch({ channel: "msedge", headless: true, args: ["--disable-webgl", "--disable-3d-apis"] });
try {
  const view = await open(noGl, { bundle: "branch", deck: true });
  await view.getByText("Deck", { exact: true }).click();
  await view.getByText(/This display has no WebGL/).waitFor();
  await view.mouse.move(700, 880);
  results.noWebgl = await view.evaluate(() => ({ canvases: document.querySelectorAll("canvas").length, deckEngineCalls: window.deckEngineCalls }));
  assert.deepEqual(results.noWebgl, { canvases: 0, deckEngineCalls: 0 });
  await view.screenshot({ path: join(here, "deck-no-webgl.png") });
  await view.close();
} finally {
  await noGl.close();
  await new Promise((done) => server.close(done));
}

results.errors = errors;
await writeFile(join(here, "render-results.json"), JSON.stringify(results, null, 2) + "\n");
assert.deepEqual(errors, [], "no page errors or console errors");
console.log(JSON.stringify({ ...results, flagOn: results.flagOn.map(({ sailors, ...rest }) => rest) }, null, 2));
