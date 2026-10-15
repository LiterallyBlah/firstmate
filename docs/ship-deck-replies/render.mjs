/**
 * Replies on the deck, in a real browser, from the bundle Paseo's own compiler makes
 * (`node docs/ship-deck-canvas/compile.mjs` first). Headless Edge, never a daemon, through the canvas
 * harness's host; `host.jsx` here is the focus host's crowded fleet with the first mate's suggestions naming
 * four crewmates.
 *
 * 1. **Markers** — the four crewmates wear the reply marker, each where the deck's own `askMarks` puts it,
 *    clear of every other sailor; the legend counts them.
 * 2. **The bubble on hover** — pointing at one shows its speech bubble instead of its label: inside the
 *    canvas, over the sailor and off it, with a chip per reply. The pointer crosses to a chip and clicks it:
 *    one `firstmate.mate.ask` with the reply's words — the board strip's call — and the marker and bubble
 *    clear.
 * 3. **Focused** — a click focuses another: its panel lists the same replies, its bubble hangs over it left
 *    of the panel, and Tab cycles through the bubble's chips and the panel without leaving them.
 * 4. **Resize** — narrowed while focused, the panel docks under the sailor and the bubble stays in the room
 *    above it.
 * 5. **Reduced motion** — the markers hold still: two frames a second apart are identical.
 * 6. **Crowded** — every crewmate asking: no marker on another sailor, its badge or another marker.
 * 7. **Light** — the bubble in the light theme at 08:00.
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
  outfile: join(generated, "replies-host.js"),
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
  "/host.js": join(generated, "replies-host.js"),
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

async function open(browser, { theme = "dark", reducedMotion = "no-preference", time = "2026-10-14T12:00:00Z", width = 1440, replies = "1" } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2, reducedMotion, timezoneId: "UTC" });
  const view = await context.newPage();
  view.on("pageerror", (error) => errors.push(`${theme}: ${error.message}`));
  view.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") errors.push(`${theme} console ${message.type()}: ${message.text()}`);
  });
  await view.clock.setFixedTime(new Date(time));
  await view.goto(`${origin}/?bundle=branch&theme=${theme}&crowd=1&replies=${replies}`);
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
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const inside = (inner, outer) => inner.left >= outer.left - 0.5 && inner.top >= outer.top - 0.5 && inner.right <= outer.right + 0.5 && inner.bottom <= outer.bottom + 0.5;

/** The speech bubble, if up: its box (the tail's included), its words, its chips, and the canvas's box. */
const bubble = (view) =>
  view.evaluate(() => {
    const node = document.querySelector("[data-testid=firstmate-deck-bubble]");
    if (node === null) return null;
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    };
    const canvas = document.querySelector("canvas[data-firstmate-deck]");
    const words = [...node.querySelectorAll("div")].filter((each) => each.children.length === 0 && each.textContent.trim() !== "").map((each) => each.textContent.trim());
    return {
      rect: box(node),
      parts: [...node.querySelectorAll("*")].map(box).filter((part) => part.right > part.left),
      canvas: box(canvas),
      words,
      chips: [...node.querySelectorAll("[role=button]")].map((each) => ({ label: each.getAttribute("aria-label"), disabled: each.getAttribute("aria-disabled") === "true" })),
    };
  });
/** Everything the bubble draws, tail included, as one box. */
const drawn = (shown) =>
  shown.parts.reduce(
    (all, part) => ({ left: Math.min(all.left, part.left), top: Math.min(all.top, part.top), right: Math.max(all.right, part.right), bottom: Math.max(all.bottom, part.bottom) }),
    shown.rect,
  );
const panel = (view) =>
  view.evaluate(() => {
    const node = document.querySelector("[data-testid=firstmate-deck-focus]");
    if (node === null) return null;
    const rect = node.getBoundingClientRect();
    return {
      text: node.textContent,
      buttons: [...node.querySelectorAll("[role=button]")].map((each) => each.getAttribute("aria-label")),
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
    };
  });
const legend = (view) => view.evaluate(() => [...document.querySelectorAll("div")].find((node) => /with (a reply|replies) for you$/.test(node.textContent) && node.children.length === 0)?.textContent ?? null);
async function bubbleFor(view, point) {
  await view.mouse.move(point.x, point.y);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const shown = await bubble(view);
    if (shown !== null) return shown;
    await view.waitForTimeout(50);
  }
  return null;
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  // 1. Markers.
  {
    const view = await open(browser);
    await canvasShot(view, "deck-markers.png");
    await view.screenshot({ path: join(here, "deck-1440-dark.png") });
    const spots = await view.evaluate(() => window.deckSpots());
    const marks = await view.evaluate(() => window.deckMarks());
    results.markers = { askers: marks.map((mark) => mark.key).sort(), framed: marks.filter((mark) => mark.framed).map((mark) => mark.key), legend: await legend(view) };
    assert.deepEqual(results.markers.askers, ["block-0", "block-1", "block-2", "work-5"]);
    assert.equal(results.markers.legend, "4 with replies for you");
    for (const mark of marks) {
      if (mark.framed) continue;
      for (const spot of spots) if (spot.key !== mark.key) assert(!overlaps(mark.box, spot.box), `${mark.key}'s marker is on ${spot.key}`);
    }

    // 2. The bubble on hover, and a chip sent.
    const asker = spots.find((spot) => spot.key === "block-1");
    const shown = await bubbleFor(view, asker.badge);
    assert(shown !== null, "pointing at a sailor with replies shows its bubble");
    await canvasShot(view, "bubble-hover.png");
    const label = await view.evaluate(() => document.querySelector("[data-testid=firstmate-deck-label]"));
    const all = drawn(shown);
    const sailor = asker.box;
    results.hover = {
      words: shown.words,
      chips: shown.chips,
      insideCanvas: inside(all, shown.canvas),
      coversSailor: overlaps(shown.rect, sailor),
      noLabel: label === null,
    };
    assert(results.hover.insideCanvas, "the bubble stays on the canvas");
    assert(!results.hover.coversSailor, "the bubble does not cover its sailor");
    assert(results.hover.noLabel, "the bubble replaces the label");
    assert.deepEqual(
      shown.chips.map((chip) => chip.label),
      [
        'Reviewed PR: send "For block-1, deliver the next chapter review as a reviewed pull request." to the first mate',
        'Local-only: send "For block-1, deliver the next chapter review local-only." to the first mate',
      ],
    );
    // Cross from the sailor to the chip, as a hand would, and pick it.
    const chip = view.locator('[data-testid=firstmate-deck-bubble] [role=button][aria-label^="Reviewed PR"]');
    const target = await chip.boundingBox();
    await view.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
    await view.waitForTimeout(800);
    results.hover.stillUpOverChip = (await bubble(view)) !== null;
    assert(results.hover.stillUpOverChip, "the bubble stays up while the pointer is over its chips");
    await view.mouse.click(target.x + target.width / 2, target.y + target.height / 2);
    await view.waitForTimeout(300);
    const calls = await view.evaluate(() => window.fixtureCalls.filter((call) => call.name.startsWith("firstmate.mate")));
    results.pick = {
      calls,
      bubbleAfter: await bubble(view),
      legendAfter: await legend(view),
    };
    assert.equal(calls.length, 1, "one send");
    assert.equal(calls[0].name, "firstmate.mate.ask", "the board strip's own call");
    assert.equal(calls[0].input.text, "For block-1, deliver the next chapter review as a reviewed pull request.");
    assert.equal(results.pick.bubbleAfter, null, "the bubble clears once answered");
    assert.equal(results.pick.legendAfter, "3 with replies for you", "and so does the marker");
    await view.mouse.move(5, 880);
    await view.waitForTimeout(300);
    await canvasShot(view, "after-pick.png");

    // 3. Focused: the panel's replies, the bubble beside it, and Tab through both.
    const focusedOn = spots.find((spot) => spot.key === "block-2");
    await view.mouse.click(focusedOn.badge.x, focusedOn.badge.y);
    await view.waitForTimeout(800);
    const opened = await panel(view);
    const spoken = await bubble(view);
    await canvasShot(view, "focused-bubble.png");
    await view.screenshot({ path: join(here, "focused-1440-dark.png") });
    assert(opened !== null && spoken !== null, "focused: panel and bubble");
    const stops = [];
    for (let press = 0; press < 14; press += 1) {
      await view.keyboard.press("Tab");
      stops.push(
        await view.evaluate(() => {
          const active = document.activeElement;
          if (document.querySelector("[data-testid=firstmate-deck-bubble]")?.contains(active)) return "bubble";
          if (document.querySelector("[data-testid=firstmate-deck-focus]")?.contains(active)) return "panel";
          return "outside";
        }),
      );
    }
    results.focused = {
      panelReplies: opened.buttons.filter((name) => name?.includes("to the first mate")),
      bubbleChips: spoken.chips.map((chip) => chip.label),
      bubbleLeftOfPanel: drawn(spoken).right <= opened.rect.left,
      bubbleInsideCanvas: inside(drawn(spoken), spoken.canvas),
      tabStops: stops,
    };
    assert.deepEqual(results.focused.panelReplies, ['Opening B reads best: send "Tell block-2 the second story opening reads best; roll that one out." to the first mate']);
    assert.deepEqual(results.focused.bubbleChips, results.focused.panelReplies);
    assert(results.focused.bubbleLeftOfPanel, "the bubble keeps to the room the panel leaves");
    assert(results.focused.bubbleInsideCanvas);
    assert(stops.every((stop) => stop !== "outside") && stops.includes("bubble") && stops.includes("panel"), `Tab stays in bubble and panel: ${stops}`);

    // 4. Narrowed while focused: docked panel, bubble above it. The Tabs above left a button holding the
    // keyboard; its tooltip is not this check's, so the panel takes the keyboard back first.
    await view.evaluate(() => document.querySelector("[data-testid=firstmate-deck-focus]")?.focus({ preventScroll: true }));
    await view.setViewportSize({ width: 1000, height: 900 });
    await view.waitForTimeout(800);
    const docked = await panel(view);
    const dockedBubble = await bubble(view);
    await canvasShot(view, "focused-docked.png");
    results.docked = {
      panel: docked.rect,
      bubble: dockedBubble === null ? null : drawn(dockedBubble),
      aboveThePanel: dockedBubble !== null && drawn(dockedBubble).bottom <= docked.rect.top,
      insideCanvas: dockedBubble !== null && inside(drawn(dockedBubble), dockedBubble.canvas),
    };
    assert(results.docked.aboveThePanel, "docked: the bubble stays in the room above the panel");
    assert(results.docked.insideCanvas);
    await view.context().close();
  }

  // 5. Reduced motion: still markers.
  {
    const view = await open(browser, { reducedMotion: "reduce" });
    await canvasShot(view, "still-a.png");
    await view.waitForTimeout(1000);
    await canvasShot(view, "still-b.png");
    const [a, b] = await Promise.all(["still-a.png", "still-b.png"].map((name) => readFile(join(here, name))));
    results.reducedMotion = {
      motion: await view.evaluate(() => document.querySelector("canvas[data-firstmate-deck]").getAttribute("data-firstmate-deck-motion")),
      identical: a.equals(b),
    };
    assert.equal(results.reducedMotion.motion, "still");
    assert(results.reducedMotion.identical, "the markers hold still under reduced motion");
    await view.context().close();
  }

  // 6. Everyone asking: the markers keep clear.
  {
    const view = await open(browser, { replies: "all" });
    await canvasShot(view, "crowd-all-asking.png");
    const spots = await view.evaluate(() => window.deckSpots());
    const marks = await view.evaluate(() => window.deckMarks());
    const clashes = [];
    for (const mark of marks) {
      if (mark.framed) continue;
      for (const spot of spots) if (spot.key !== mark.key && overlaps(mark.box, spot.box)) clashes.push(`${mark.key} on ${spot.key}`);
      for (const other of marks) if (other !== mark && !other.framed && overlaps(mark.box, other.box)) clashes.push(`${mark.key} on ${other.key}'s marker`);
    }
    results.crowded = { sailors: spots.length, markers: marks.length, framed: marks.filter((mark) => mark.framed).length, clashes, legend: await legend(view) };
    assert.equal(results.crowded.markers, spots.length);
    assert.deepEqual(clashes, []);
    await view.context().close();
  }

  // 7. Light, at 08:00.
  {
    const view = await open(browser, { theme: "light", time: "2026-10-14T08:00:00Z" });
    const spots = await view.evaluate(() => window.deckSpots());
    const shown = await bubbleFor(view, spots.find((spot) => spot.key === "work-5").badge);
    assert(shown !== null);
    await canvasShot(view, "bubble-light.png");
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
