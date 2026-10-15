/**
 * The tall mast and the generated plank, in a real browser, from the bundles Paseo's own compiler makes
 * (`node docs/ship-deck-canvas/compile.mjs` first: it writes origin/main's bundle and this branch's). Headless
 * Edge, never a daemon, through the canvas harness's host and its fixture fleet. **Before** is origin/main's
 * bundle with origin/main's art; **after** is this branch's with its own.
 *
 * 1. **The deck** — the whole canvas before and after, dark at noon; after, light at 16:30 and at night.
 * 2. **The rig** — close on the mast, before and after, at the same scale.
 * 3. **The pane** — wide and short, tall and narrow, and fractional: the mast's tip and the plank's shark in
 *    view at every size, the ship centred.
 * 4. **The plank** — the generated board, and the way off it beat by beat: on the board, at its end, the
 *    splash, the shark's bite, the sea empty again.
 * 5. **Click to focus** — a sailor clicked, the camera closed in beside its card, and back out.
 * 6. **Reduced motion** — the still deck: the mast unswayed, the sail at rest.
 *
 * Writes the pictures and `render-results.json` here.
 */
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
const mainDir = join(tmpdir(), `firstmate-mast-main-${process.pid}`);
await rm(mainDir, { recursive: true, force: true });
await mkdir(mainDir, { recursive: true });
execFileSync("git", ["-C", root, "archive", "--format=tar", "-o", join(mainDir, "main.tar"), "origin/main", "art", "vendor", "server", "shared"]);
execFileSync("tar", ["-xf", "main.tar"], { cwd: mainDir });

await build({
  entryPoints: [join(here, "host.jsx")],
  outfile: join(generated, "mast-host.js"),
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
    outfile: join(generated, `ship-deck-server-${name}.mjs`),
    bundle: true,
    platform: "node",
    format: "esm",
    nodePaths: [join(root, "node_modules")],
    logLevel: "warning",
  });
  return import(pathToFileURL(join(generated, `ship-deck-server-${name}.mjs`)).href);
}

/** One page server per side: its bundle, and the art read from its own folder by its own server code. */
async function side(bundle, dir) {
  const server = await serverOf(bundle, dir);
  const served = {
    "/deck-engine.json": JSON.stringify(await server.readDeckEngine(async () => dir)),
    "/deck-art.json": JSON.stringify(await server.readDeckArt(async () => dir)),
    "/deck-environment.json": JSON.stringify(await server.readDeckEnvironment(async () => dir)),
    "/deck-extras.json": JSON.stringify(await server.readDeckExtras(async () => dir)),
  };
  const files = { "/host.js": join(generated, "mast-host.js"), [`/bundle/${bundle}.js`]: join(generated, `${bundle}.client.js`) };
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
  return { http, url: `http://127.0.0.1:${http.address().port}/?bundle=${bundle}${bundle === "branch" ? "&rig=tall" : ""}` };
}
const sides = { before: await side("main", mainDir), after: await side("branch", root) };

const results = {};
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

/** The rig at the same scale on both sides: the mast's tip to the deck, the bow's stay to the stern's. */
const RIG_VIEW = [110, -116, 310, 124];
/** Around the plank: the mast's foot to the gunwale's bollards, the deck down to the sea under the plank. */
const PLANK_VIEW = [168, 56, 336, 176];

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  // 1 and 2. The deck and the rig, before and after.
  for (const which of ["before", "after"]) {
    const view = await open(browser, which);
    await canvasShot(view, `${which}-deck.png`);
    const shown = await visible(view);
    // The "before" fit has no rows above the hull for the tall mast; clip the rig to what shows.
    const [l, t, r, b] = RIG_VIEW;
    await view.screenshot({ clip: await deckClip(view, l, Math.max(t, Math.ceil(shown.top)), r, b), path: join(here, `${which}-rig.png`) });
    results[which] = { visible: shown, motion: await motion(view) };
    await view.context().close();
  }
  for (const [name, theme, time] of [
    ["after-deck-light.png", "light", new Date("2026-10-14T16:30:00Z")],
    ["after-deck-night.png", "dark", new Date("2026-10-14T02:00:00Z")],
    ["after-deck-dusk.png", "dark", new Date("2026-10-14T18:30:00Z")],
  ]) {
    const view = await open(browser, "after", { theme, time });
    await canvasShot(view, name);
    await view.context().close();
  }

  // 3. The pane: every size shows the mast's tip and the shark's sea, the ship whole and centred.
  results.panes = {};
  for (const [name, viewport, scale] of [
    ["after-pane-wide-short.png", { width: 2300, height: 560 }, 1],
    ["after-pane-narrow-tall.png", { width: 1000, height: 1100 }, 2],
    ["after-pane-fractional.png", { width: 1203, height: 911 }, 1.25],
    ["before-pane-wide-short.png", { width: 2300, height: 560 }, 1],
  ]) {
    const which = name.startsWith("before") ? "before" : "after";
    const view = await open(browser, which, { viewport, scale });
    await canvasShot(view, name);
    const shown = await visible(view);
    results.panes[name] = shown;
    if (which === "after") {
      assert(shown.top < -110, `${name}: the mast's tip is in view (${shown.top})`);
      assert(shown.bottom > 171, `${name}: the shark's sea is in view (${shown.bottom})`);
      assert(shown.left <= 0 && shown.right >= 426, `${name}: the ship is whole across`);
    }
    await view.context().close();
  }

  // 4. The plank, and the way off it, beat by beat on the fake clock.
  {
    const fake = true;
    const view = await open(browser, "after", { fakeClock: fake });
    await view.screenshot({ clip: await deckClip(view, ...PLANK_VIEW), path: join(here, "after-plank.png") });
    const key = "work-1";
    await view.evaluate(([k]) => window.leave(k, "done"), [[key]]);
    await view.getByRole("button", { name: "Refresh" }).click();
    await view.clock.runFor(33);
    const { boards, sequence } = await view.evaluate((k) => window.plankTimes(k), [key]);
    const board = boards[key];
    assert(board > 0, "the crewmate reaches the plank");
    const beats = [
      ["plank-1-walking", Math.round(board / 2)],
      ["plank-2-on-the-board", board + sequence.onPlank],
      ["plank-3-at-the-end", board + sequence.teeter],
      ["plank-4-splash", board + sequence.impact + 120],
      ["plank-5-chomp", board + sequence.chomp + 90],
      ["plank-6-gone", board + sequence.gone + 400],
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

  // 5. Click to focus, under the tall mast.
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
    await canvasShot(view, "after-focus-back-out.png");
    await view.context().close();
  }

  // 6. Reduced motion.
  {
    const view = await open(browser, "after", { reducedMotion: "reduce" });
    results.reducedMotion = { motion: await motion(view) };
    assert.equal(results.reducedMotion.motion, "still");
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
