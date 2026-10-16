import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
export async function review(browser, origin, mode) {
  const version = process.env.RENDER_TREE === "main" ? "before" : "after";
  const out = resolve(here, version);
  mkdirSync(out, { recursive: true });
  const results = [], errors = [];
  for (const setting of ["sky-airship", "japanese-ship", "ship"]) {
    for (const [aspect, width, height] of [["wide", 1600, 700], ["square", 1000, 1000], ["tall-narrow", 650, 1500]]) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1,
        reducedMotion: mode === "still" ? "reduce" : "no-preference", timezoneId: "UTC" });
      try {
        const view = await context.newPage();
        view.on("pageerror", (error) => errors.push(error.message));
        const noon = Date.parse("2026-10-16T12:00:00Z");
        await view.clock.install({ time: noon });
        await view.goto(`${origin}/?tree=branch&theme=dark&working=12&setting=${setting}`);
        await view.getByRole("button", { name: "Open Deck", exact: true }).waitFor();
        await view.clock.pauseAt(noon + 20000);
        await view.getByRole("button", { name: "Open Deck", exact: true }).click();
        const canvas = view.locator("canvas[data-firstmate-deck]");
        for (let i = 0; i < 200 && !(await canvas.count()); i++) {
          await view.clock.runFor(100);
          await view.waitForTimeout(50);
        }
        assert.equal(await canvas.count(), 1);
        await view.clock.runFor(18000);
        assert.equal(await canvas.getAttribute("data-firstmate-deck-setting"), setting);
        assert.equal(await canvas.getAttribute("data-firstmate-deck-motion"), mode);
        const weather = await canvas.getAttribute("data-firstmate-deck-weather");
        if (mode === "still") assert.equal(weather, "still");
        else assert.ok(Number(weather) > 0.95, `storm intensity: ${weather}`);
        await view.mouse.move(0, 0);
        await canvas.screenshot({ path: resolve(out, `${setting}-${aspect}-${mode}.png`) });
        results.push({ setting, aspect, mode, viewport: { width, height }, canvas: await canvas.boundingBox(), weather,
          flash: await canvas.getAttribute("data-firstmate-deck-flash") });
        if (mode !== "full") assert.equal(results.at(-1).flash, "");
      } finally { await context.close(); }
    }
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(out, `${mode}.json`), JSON.stringify({ results, errors }, null, 2) + "\n");
  console.log(JSON.stringify({ version, mode, captures: results.length, errors }));
}
