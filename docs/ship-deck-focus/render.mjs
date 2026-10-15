/**
 * Clicking a sailor to focus it, in a real browser, from the bundle Paseo's own compiler makes
 * (`node docs/ship-deck-canvas/compile.mjs` first). Headless Edge, never a daemon, through the canvas
 * harness's host; `host.jsx` here is the rest-area host's crowded fleet (eleven idle beside five working,
 * one waiting and four blocked) with the focus layout's anchor on the page.
 *
 * 1. **Zoom and panel** — on a moving deck, a click on a blocked crewmate: pictured mid-zoom and focused;
 *    the panel is a dialog named for the card, holds the keyboard, and shows the card's few lines and its
 *    buttons, no more.
 * 2. **Its actions are the card's** — Steer typed and sent from the panel reaches `firstmate.crew.steer`,
 *    the board's own call; End asks the board's confirmation first, and Cancel sends nothing.
 * 3. **Ways out** — Esc, a click on open sea, and the panel's close button each close it, and afterwards
 *    the pointer labels sailors where the whole deck stands them again, so the camera is back at the fit.
 * 4. **Resting crew** — a sleeper off the working deck is focused by a click on it.
 * 5. **Resize** — focused, the window narrows until the panel docks under the sailor; a click where the
 *    layout puts the focused sailor keeps it focused, so the camera followed the new size.
 * 6. **Reduced motion** — the camera snaps: fully in on the next frame, the canvas still `still`.
 * 7. **Keyboard** — the deck takes the keyboard, an arrow focuses a sailor, Tab stays inside the panel,
 *    Esc gives the keyboard back to the deck.
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
  outfile: join(generated, "focus-host.js"),
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
  "/host.js": join(generated, "focus-host.js"),
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

async function open(browser, { theme = "dark", reducedMotion = "no-preference", time = "2026-10-14T12:00:00Z", width = 1440 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2, reducedMotion, timezoneId: "UTC" });
  const view = await context.newPage();
  view.on("pageerror", (error) => errors.push(`${theme}: ${error.message}`));
  view.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") errors.push(`${theme} console ${message.type()}: ${message.text()}`);
  });
  await view.clock.setFixedTime(new Date(time));
  await view.goto(`${origin}/?bundle=branch&theme=${theme}&crowd=1`);
  await until(view, () => [...document.querySelectorAll("div")].some((node) => node.textContent === "Deck"));
  await view.getByText("Deck", { exact: true }).click();
  await until(view, () => document.querySelector("canvas[data-firstmate-deck-motion]") !== null);
  await view.mouse.move(5, 880);
  await view.evaluate(() => document.activeElement?.blur());
  await view.waitForTimeout(400);
  return view;
}

async function until(view, predicate, arg, attempts = 400) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await view.evaluate(predicate, arg)) return;
    await view.waitForTimeout(50);
  }
  throw new Error(`timed out waiting for ${predicate}`);
}

const canvasBox = (view) =>
  view.evaluate(() => {
    const rect = document.querySelector("canvas[data-firstmate-deck]").getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
const canvasShot = async (view, path) => view.screenshot({ clip: await canvasBox(view), path: join(here, path) });
const middle = (box) => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 });

/** The focus panel, if open: its name, its words, its buttons, where it is, and whether it holds the keyboard. */
const panel = (view) =>
  view.evaluate(() => {
    const node = document.querySelector("[data-testid=firstmate-deck-focus]");
    if (node === null) return null;
    const rect = node.getBoundingClientRect();
    const words = [...node.querySelectorAll("div, span")]
      .filter((each) => each.children.length === 0 && each.textContent.trim() !== "")
      .map((each) => each.textContent.trim());
    const buttons = [...node.querySelectorAll("[role=button]")].map((each) => ({
      label: each.getAttribute("aria-label"),
      disabled: each.getAttribute("aria-disabled") === "true",
    }));
    return {
      role: node.getAttribute("role"),
      name: node.getAttribute("aria-label"),
      text: node.textContent,
      words,
      buttons,
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      holdsKeyboard: node.contains(document.activeElement),
    };
  });
const label = (view) =>
  view.evaluate(() => {
    const node = document.querySelector("[data-testid=firstmate-deck-label]");
    return node === null ? null : [...node.querySelectorAll("div")].filter((each) => each.children.length === 0 && each.textContent !== "").map((each) => each.textContent)[0];
  });
async function hoverFor(view, point, title) {
  await view.mouse.move(point.x, point.y);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await label(view)) === title) return true;
    await view.waitForTimeout(50);
  }
  return false;
}
const pressButton = (view, name) => view.locator(`[data-testid=firstmate-deck-focus] [role=button][aria-label="${name}"]`).click();
/** Clicks a sailor on its badge, where the rest areas keep every sleeper clear of the others; waits out the zoom; the panel. */
async function focusOn(view, spot, settle = 700) {
  await view.mouse.click(spot.badge.x, spot.badge.y);
  await view.waitForTimeout(settle);
  return panel(view);
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  // 1. Zoom and panel, on a moving deck.
  {
    const view = await open(browser);
    await canvasShot(view, "deck-whole.png");
    const spots = await view.evaluate(() => window.deckSpots());
    const blocked = spots.find((spot) => spot.state === "blocked" && spot.key.startsWith("block-"));
    await view.mouse.click(middle(blocked.box).x, middle(blocked.box).y);
    await view.waitForTimeout(230);
    await canvasShot(view, "zoom-midway.png");
    await view.waitForTimeout(600);
    await canvasShot(view, "focused-blocked.png");
    await view.screenshot({ path: join(here, "focused-1440-dark.png") });
    const shown = await panel(view);
    results.focused = { key: blocked.key, title: blocked.title, ...shown };
    assert(shown !== null, "the panel opens on a click");
    assert.equal(shown.role, "dialog");
    assert.equal(shown.name, `${blocked.title}: details and actions`);
    assert(shown.text.includes(blocked.title), "the panel names the card");
    assert(shown.holdsKeyboard, "the panel takes the keyboard");
    assert.deepEqual(
      shown.buttons.map((button) => button.label),
      ["Close", "Watch", "Steer", "Interrupt", "Relaunch", "End"],
      "the card's own actions, and a close button, nothing else",
    );
    // Minimal: no tag editor, no facts line, no report path.
    assert(!shown.words.some((word) => /^Tags?\b|^Report:/.test(word)), "no tags or report path");
    // No hover label while focused.
    await view.mouse.move(middle(spots[0].box).x, middle(spots[0].box).y);
    await view.waitForTimeout(150);
    results.focused.labelWhileFocused = await label(view);
    assert.equal(results.focused.labelWhileFocused, null);

    // 2. Its actions are the card's.
    await pressButton(view, "Steer");
    await view.locator("[data-testid=firstmate-deck-focus] textarea").fill("Try the smaller fixture first.");
    await pressButton(view, "Send");
    await view.waitForTimeout(200);
    await pressButton(view, "End");
    await view.waitForTimeout(100);
    await canvasShot(view, "focused-end-confirm.png");
    const confirm = await panel(view);
    await pressButton(view, "Cancel");
    await view.waitForTimeout(100);
    const calls = await view.evaluate(() => window.fixtureCalls.filter((call) => /crew/.test(call.name)));
    results.actions = { calls, endConfirmation: confirm.words.find((word) => word.startsWith("End this worker")) ?? null };
    assert.equal(calls.length, 1, "one call: the steer; End's confirmation was cancelled");
    assert.equal(calls[0].name, "firstmate.crew.steer");
    assert.equal(calls[0].input.text, "Try the smaller fixture first.");
    assert(results.actions.endConfirmation !== null, "End asks first");

    // 3. Ways out: Esc, open sea, the close button. After each, the pointer labels sailors where the whole deck stands them.
    results.exits = {};
    const canvas = await canvasBox(view);
    const sea = { x: canvas.x + 12, y: canvas.y + canvas.height - 12 };
    for (const [how, leave] of [
      ["escape", () => view.keyboard.press("Escape")],
      ["open sea", () => view.mouse.click(sea.x, sea.y)],
      ["close button", () => pressButton(view, "Close")],
    ]) {
      if ((await panel(view)) === null) await focusOn(view, blocked);
      assert((await panel(view)) !== null, `focused before ${how}`);
      await leave();
      await view.waitForTimeout(700);
      const worker = spots.find((spot) => spot.state === "working");
      results.exits[how] = { closed: (await panel(view)) === null, labelsAgain: await hoverFor(view, worker.badge, worker.title) };
      assert(results.exits[how].closed, `${how} closes the panel`);
      assert(results.exits[how].labelsAgain, `after ${how}, the camera is back at the fit`);
      await view.mouse.move(5, 880);
    }
    await canvasShot(view, "deck-after-exit.png");

    // 4. Resting crew: a sleeper off the working deck.
    const sleeper = spots.filter((spot) => spot.state === "idle").sort((a, b) => a.deck.y - b.deck.y)[0];
    const restPanel = await focusOn(view, sleeper);
    results.sleeper = { key: sleeper.key, title: sleeper.title, deck: sleeper.deck, focused: restPanel?.text.includes(sleeper.title) ?? false };
    assert(results.sleeper.focused, "a resting sailor is focused by a click on it");
    await canvasShot(view, "focused-sleeper.png");

    // 5. Resize while focused: narrow until the panel docks under the sailor. The blocked crewmate stands
    //    clear of the others, so a click where the layout puts it can only be on it.
    await view.keyboard.press("Escape");
    await view.waitForTimeout(700);
    await focusOn(view, blocked);
    await view.setViewportSize({ width: 1000, height: 900 });
    await view.waitForTimeout(700);
    const anchor = await view.evaluate(() => window.focusAnchor());
    const docked = await panel(view);
    await view.mouse.click(anchor.x, anchor.y);
    await view.waitForTimeout(200);
    results.resize = { side: anchor.side, panel: docked?.rect ?? null, stillFocusedAfterClickOnAnchor: (await panel(view)) !== null };
    await canvasShot(view, "focused-resized.png");
    assert.equal(anchor.side, "bottom", "a narrow pane docks the panel under the sailor");
    assert(results.resize.stillFocusedAfterClickOnAnchor, "the focused sailor is where the layout says after a resize");
    await view.context().close();
  }

  // 6. Reduced motion: the camera snaps.
  {
    const view = await open(browser, { reducedMotion: "reduce" });
    const spots = await view.evaluate(() => window.deckSpots());
    const worker = spots.find((spot) => spot.state === "working");
    await view.mouse.click(middle(worker.box).x, middle(worker.box).y);
    await view.waitForTimeout(60);
    await canvasShot(view, "reduced-motion-snap-60ms.png");
    await view.waitForTimeout(700);
    await canvasShot(view, "reduced-motion-snap-760ms.png");
    const [early, late] = await Promise.all(
      ["reduced-motion-snap-60ms.png", "reduced-motion-snap-760ms.png"].map((name) => readFile(join(here, name))),
    );
    results.reducedMotion = {
      motion: await view.evaluate(() => document.querySelector("canvas[data-firstmate-deck]").getAttribute("data-firstmate-deck-motion")),
      snapped: early.equals(late),
      panel: (await panel(view)) !== null,
    };
    assert.equal(results.reducedMotion.motion, "still");
    assert(results.reducedMotion.snapped, "no zoom to watch: the first frame is the last");
    await view.context().close();
  }

  // 7. The keyboard.
  {
    const view = await open(browser);
    await view.evaluate(() => document.querySelector("[aria-label^='Ship deck:']").focus());
    await view.keyboard.press("ArrowRight");
    await view.waitForTimeout(700);
    const opened = await panel(view);
    const stops = [];
    for (let press = 0; press < 12; press += 1) {
      await view.keyboard.press("Tab");
      stops.push(await view.evaluate(() => document.querySelector("[data-testid=firstmate-deck-focus]")?.contains(document.activeElement) ?? false));
    }
    await view.keyboard.press("Escape");
    await view.waitForTimeout(100);
    results.keyboard = {
      arrowOpens: opened !== null,
      tabStaysInPanel: stops.every(Boolean),
      escapeCloses: (await panel(view)) === null,
      deckHasKeyboardBack: await view.evaluate(() => document.activeElement?.getAttribute("aria-label")?.startsWith("Ship deck:") ?? false),
    };
    assert(Object.values(results.keyboard).every(Boolean), JSON.stringify(results.keyboard));
    await view.context().close();
  }

  // A light theme, focused.
  {
    const view = await open(browser, { theme: "light", time: "2026-10-14T08:00:00Z" });
    const spots = await view.evaluate(() => window.deckSpots());
    const waiting = spots.find((spot) => spot.state === "waiting");
    await focusOn(view, waiting);
    await view.screenshot({ path: join(here, "focused-1440-light.png") });
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
