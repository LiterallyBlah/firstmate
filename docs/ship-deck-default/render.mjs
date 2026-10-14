/**
 * The Deck as a standard feature, in a real browser, from the bundles Paseo's own compiler makes
 * (`node docs/ship-deck-canvas/compile.mjs` first, which writes this branch's and origin/main's). Headless
 * Edge, never a daemon, through the tweaks harness's host; the daemon's four deck RPCs are answered with
 * what `server/ship-deck.ts` reads from this checkout — with no switch anywhere: the page's fleet carries
 * no `shipDeck`, and the server reads take no environment.
 *
 * 1. **Narrow** (390 px, the compact layout a phone gets) — the screen's DOM is main's, character for
 *    character, and no deck RPC is called.
 * 2. **Wide** (1440 px) — the screen's DOM differs from main's in one place only: the Deck segment in the
 *    header's Crew/Files switch. Until it is pressed, no deck RPC is called.
 * 3. **Deck, no switch** — pressing Deck draws the canvas with WebGL: the caption, the canvas's renderer.
 * 4. **No WebGL** — a browser with WebGL turned off still offers Deck, and pressing it gives the sentence
 *    saying why it cannot draw, with no canvas and no Pixi fetched.
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
  entryPoints: [join(root, "docs/ship-deck-tweaks/host.jsx")],
  outfile: join(generated, "default-host.js"),
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
  "/host.js": join(generated, "default-host.js"),
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

const results = { narrow: null, wide: null, deck: null, noWebgl: null };
const errors = [];
const deckCalls = (view) => view.evaluate(() => ({ engine: window.deckEngineCalls, art: window.deckArtCalls, environment: window.deckEnvironmentCalls, extras: window.deckExtrasCalls }));
const noCalls = { engine: 0, art: 0, environment: 0, extras: 0 };

async function open(browser, { bundle = "branch", width = 1440, scale = 1 }) {
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, deviceScaleFactor: scale, reducedMotion: "reduce", timezoneId: "UTC" });
  const view = await context.newPage();
  view.on("pageerror", (error) => errors.push(`${bundle}/${width}: ${error.message}`));
  view.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") errors.push(`${bundle}/${width} console ${message.type()}: ${message.text()}`);
  });
  await view.clock.setFixedTime(new Date("2026-10-14T12:00:00Z"));
  // No \`deck=1\`: the fleet the page serves has no switch in it, as the daemon's no longer does.
  await view.goto(`${origin}/?bundle=${bundle}&theme=dark`);
  await until(view, () => [...document.querySelectorAll("div")].some((node) => node.textContent === "Brief helper: coach prompt, skill and button" || node.textContent === "First mate"));
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

/** Where two strings differ: the stretch of each between their longest common start and end. */
function difference(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end += 1;
  return { at: start, main: a.slice(start, a.length - end), branch: b.slice(start, b.length - end) };
}

const textOf = (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  // 1. Narrow: main's screen, exactly.
  {
    const main = await open(browser, { bundle: "main", width: 390 });
    const branch = await open(browser, { bundle: "branch", width: 390 });
    const [mainHtml, branchHtml] = [await rootHtml(main), await rootHtml(branch)];
    results.narrow = { identical: mainHtml === branchHtml, characters: branchHtml.length, deckCalls: await deckCalls(branch) };
    assert.equal(branchHtml, mainHtml, "narrow: the DOM differs from main's");
    assert.deepEqual(results.narrow.deckCalls, noCalls, "narrow: no deck RPC is called");
    await main.context().close();
    await branch.context().close();
  }

  // 2. Wide: main's screen but for the Deck segment.
  {
    const main = await open(browser, { bundle: "main", width: 1440 });
    const branch = await open(browser, { bundle: "branch", width: 1440 });
    const [mainHtml, branchHtml] = [await rootHtml(main), await rootHtml(branch)];
    // React numbers its ids in render order, so one more tooltip renumbers the ones after it.
    const ids = (html) => html.replace(/«r[0-9a-z]+»/g, "«id»");
    const [mainIds, branchIds] = [ids(mainHtml), ids(branchHtml)];
    const diff = difference(mainIds, branchIds);
    // Take the Deck segment out of the branch's screen, and give Files back the rounded right end it has as
    // the last segment: what is left must be main's screen, character for character.
    const tooltip = "Show the crew as sailors on a ship deck.";
    const deckStart = branchIds.lastIndexOf('<div class="css-view-g5y9jx" style="z-index: 0;"><div role="tab"', branchIds.indexOf(">Deck</div>"));
    const deckEnd = branchIds.indexOf("</div></div></div>", branchIds.indexOf(tooltip)) + "</div></div></div>".length;
    const withoutDeck = branchIds.slice(0, deckStart) + branchIds.slice(deckEnd);
    // The Files tab's own style ends just before its label; squared off as a middle segment, rounded as the last.
    const filesTab = withoutDeck.lastIndexOf('"><div dir="auto"', withoutDeck.indexOf(">Files</div>"));
    const squared = "border-radius: 0px;";
    assert(withoutDeck.slice(0, filesTab).endsWith(squared), "wide: Files is a middle segment, squared off");
    const asMain = withoutDeck.slice(0, filesTab - squared.length) + "border-radius: 0px 7px 7px 0px;" + withoutDeck.slice(filesTab);
    results.wide = {
      characters: { main: mainHtml.length, branch: branchHtml.length },
      differsAt: diff.at,
      addedText: textOf(branchIds.slice(deckStart, deckEnd)),
      identicalWithoutTheDeckSegment: asMain === mainIds,
      deckCalls: await deckCalls(branch),
    };
    assert.equal(results.wide.addedText, `Deck ${tooltip}`, "wide: the segment taken out is Deck and its tooltip");
    assert.equal(asMain, mainIds, "wide: the screen is main's but for the Deck segment");
    assert.deepEqual(results.wide.deckCalls, noCalls, "wide: no deck RPC is called until Deck is pressed");
    await branch.screenshot({ path: join(here, "wide-header.png"), clip: { x: 0, y: 0, width: 1440, height: 120 } });

    // 3. Pressing Deck draws it, with no switch set.
    await branch.getByText("Deck", { exact: true }).click();
    await until(branch, () => document.querySelector("canvas[data-firstmate-deck-motion]") !== null);
    await branch.mouse.move(5, 880);
    await branch.waitForTimeout(500);
    const deck = await branch.evaluate(() => {
      const canvas = document.querySelector("canvas[data-firstmate-deck]");
      const caption = [...document.querySelectorAll("div")].find((node) => node.textContent?.startsWith("Drawn with"));
      return { renderer: canvas.getAttribute("data-firstmate-deck"), motion: canvas.getAttribute("data-firstmate-deck-motion"), caption: caption?.textContent ?? null };
    });
    results.deck = { ...deck, deckCalls: await deckCalls(branch) };
    assert.equal(deck.renderer, "webgl");
    assert.match(deck.caption ?? "", /^Drawn with WebGL · \d+ on deck$/);
    assert.deepEqual(results.deck.deckCalls, { engine: 1, art: 1, environment: 1, extras: 1 });
    await branch.screenshot({ path: join(here, "deck-1440-dark.png") });
    await main.context().close();
    await branch.context().close();
  }
} finally {
  await browser.close();
}

// 4. No WebGL: Deck is still offered, and says why it cannot draw.
const blind = await chromium.launch({ channel: "msedge", headless: true, args: ["--disable-webgl", "--disable-3d-apis"] });
try {
  const view = await open(blind, { bundle: "branch", width: 1440 });
  const offered = await view.getByText("Deck", { exact: true }).count();
  await view.getByText("Deck", { exact: true }).click();
  const sentence = "This display has no WebGL, so the ship deck cannot draw. The Crew board shows everything it would.";
  await until(view, (text) => [...document.querySelectorAll("div")].some((node) => node.textContent === text), sentence);
  results.noWebgl = { offered: offered > 0, sentence, canvases: await view.evaluate(() => document.querySelectorAll("canvas").length), deckCalls: await deckCalls(view) };
  assert(results.noWebgl.offered, "no WebGL: Deck is still offered");
  assert.equal(results.noWebgl.canvases, 0, "no WebGL: no canvas");
  assert.deepEqual(results.noWebgl.deckCalls, noCalls, "no WebGL: nothing is fetched");
  await view.screenshot({ path: join(here, "no-webgl-1440.png") });
  await view.context().close();
} finally {
  await blind.close();
  server.close();
}

results.errors = errors;
await writeFile(join(here, "render-results.json"), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results, null, 2));
assert.deepEqual(errors, [], "no page errors or warnings");
