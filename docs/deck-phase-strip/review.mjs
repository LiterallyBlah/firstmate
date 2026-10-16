// Called by the established compiled-plugin renderer with only its RPC fixture replaced.
// Reads screenshots and public canvas metadata; no Pixi internals or injected observers.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const harness = createRequire(new URL("../board-list/package.json", import.meta.url));
const { build } = harness("esbuild");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function review(browser, origin, generated) {
  await build({ entryPoints: [join(here, "../../test/png.ts")], outfile: join(generated, "phase-png.mjs"), bundle: true, platform: "node", format: "esm", logLevel: "warning" });
  const { decodePng } = await import(pathToFileURL(join(generated, "phase-png.mjs")).href);
  const errors = [], shots = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce", timezoneId: "UTC" });
  const view = await context.newPage();
  view.on("pageerror", (error) => errors.push(error.message));
  const start = Date.parse("2026-10-16T12:00:00Z");
  await view.clock.install({ time: start });
  await view.goto(`${origin}/?tree=branch&theme=dark&working=0&setting=ship`);
  await view.waitForFunction(() => document.querySelector('button[aria-label="Open Deck"]:not([disabled])') !== null);
  await view.clock.pauseAt(start + 20000);
  await view.getByRole("button", { name: "Open Deck", exact: true }).click();
  await view.waitForSelector("canvas[data-firstmate-deck]");
  await view.clock.runFor(400);
  const canvas = view.locator("canvas[data-firstmate-deck]");
  assert.equal(await canvas.getAttribute("data-firstmate-deck-setting"), "ship");
  async function shot(name) {
    await view.mouse.move(5, 895);
    const bytes = await canvas.screenshot({ animations: "allow" });
    await writeFile(join(here, `${name}.png`), bytes);
    const pixels = decodePng(bytes);
    const entry = { name, hash: hash(bytes), motion: await canvas.getAttribute("data-firstmate-deck-motion"), width: pixels.width, height: pixels.height };
    shots.push(entry);
    return { bytes, pixels, entry };
  }
  async function time(hour, minute = 0) {
    await view.clock.setFixedTime(new Date(`2026-10-16T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`));
    await view.clock.fastForward(61000); // existing still-mode minute refresh; no animation to replay
  }
  const captures = {};
  for (const [name, hour, minute] of [["dawn", 6, 0], ["day", 12, 0], ["dusk", 18, 0], ["night", 21, 0], ["dusk-half", 20, 0], ["dawn-half", 5, 0]]) {
    await time(hour, minute);
    captures[name] = await shot(name);
    assert.equal(captures[name].entry.motion, "still");
  }
  // Find a broad opaque coast patch by its known daytime RGB, then verify the other phases and
  // both eased half-blends at precisely the same screenshot pixel. This catches dark crossfade seams.
  const day = captures.day.pixels;
  let patch = -1;
  for (let p = 0; p < day.rgba.length; p += 4) {
    if ([80, 160, 100].every((v, i) => day.rgba[p + i] === v)
      && [30, 50, 80].every((v, i) => captures.night.pixels.rgba[p + i] === v)) { patch = p; break; }
  }
  assert(patch >= 0, "fixture coast is visible");
  const colours = { dawn: [180, 130, 90], day: [80, 160, 100], dusk: [130, 80, 100], night: [30, 50, 80], "dusk-half": [80, 65, 90], "dawn-half": [105, 90, 85] };
  const samples = {};
  for (const [name, rgb] of Object.entries(colours)) {
    const actual = [...captures[name].pixels.rgba.slice(patch, patch + 3)];
    assert(actual.every((value, i) => Math.abs(value - rgb[i]) <= 1), `${name}: ${actual} expected ${rgb}`);
    samples[name] = actual;
  }
  // A semi-transparent beam over empty scenery must disappear in daylight and fade out at dawn
  // just as it fades in at dusk. Sampling only opaque land would miss source-over ghosting.
  let beam = -1;
  for (let p = 0; p < day.rgba.length; p += 4) {
    if ([24, 27, 26].every((v, i) => day.rgba[p + i] === v)
      && [187, 163, 79].every((v, i) => captures.night.pixels.rgba[p + i] === v)) { beam = p; break; }
  }
  assert(beam >= 0, "night beam is visible over the transparent daytime set");
  for (const name of ["dawn", "day", "dusk", "dusk-half", "dawn-half"]) {
    const expected = name.endsWith("half") ? [106, 95, 53] : [24, 27, 26];
    const actual = [...captures[name].pixels.rgba.slice(beam, beam + 3)];
    assert(actual.every((value, i) => Math.abs(value - expected[i]) <= 1), `${name} beam: ${actual}`);
    samples[`${name}-beam`] = actual;
  }
  await time(20);
  const before = await shot("still-before");
  await view.clock.runFor(2000);
  assert.equal((await shot("still-after")).entry.hash, before.entry.hash, "still holds drift and beam");
  await view.emulateMedia({ reducedMotion: "no-preference" });
  await view.clock.runFor(500);
  const moving = await shot("drift-0");
  assert(["full", "lite"].includes(moving.entry.motion));
  await view.clock.runFor(2000);
  const moved = await shot("drift-2s");
  assert.notEqual(moved.entry.hash, moving.entry.hash, "coast drifts under a fixed half blend");
  // The colour remains the same while the strip moves horizontally; count enough unchanged blend
  // pixels to exclude a blank/fallback capture, independent of which landmark crosses the viewport.
  const halfPixels = (pixels) => {
    let n = 0;
    for (let p = 0; p < pixels.rgba.length; p += 4) if ([80, 65, 90].every((v, i) => Math.abs(pixels.rgba[p + i] - v) <= 1)) n++;
    return n;
  };
  assert(halfPixels(moving.pixels) > 100 && halfPixels(moved.pixels) > 100, "drift keeps the phase blend");
  await view.emulateMedia({ reducedMotion: "reduce" });
  await view.clock.runFor(100);
  const stopped = await shot("reduced-after-motion");
  assert.equal(stopped.entry.hash, before.entry.hash, "reduced motion resets to first route/beam frame");
  assert.deepEqual(errors, []);
  await writeFile(join(here, "render-results.json"), JSON.stringify({ samples, shots, errors }, null, 2) + "\n");
  console.log(JSON.stringify({ phaseStrip: "passed", samples, shots: shots.length, errors }));
  await context.close();
}
