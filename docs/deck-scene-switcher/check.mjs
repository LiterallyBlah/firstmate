/** Real compiled client, real deck RPCs and art; only the host settings API is stubbed. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export async function checkSwitcher(view) {
  const canvas = view.locator("canvas[data-firstmate-deck]");
  const actual = (id) =>
    view.waitForFunction((id) => {
      const canvases = document.querySelectorAll("canvas[data-firstmate-deck]");
      return (
        canvases.length === 1 &&
        canvases[0].getAttribute("data-firstmate-deck-setting") === id &&
        canvases[0].hasAttribute("data-firstmate-deck-motion")
      );
    }, id);
  const choose = async (name) => {
    await view.getByRole("button", { name: /^Scene:/ }).click();
    await view.getByRole("button", { name: new RegExp(`^${name}, `) }).click();
  };
  const saved = (id) => view.waitForFunction((id) => window.fixtureSettings?.deckSetting === id, id);
  const evidence = { checks: [], screenshots: [] };

  await actual("ship");
  const shipBox = await canvas.boundingBox();
  // A failed save must not silently switch the scene or claim it survived reload.
  await view.evaluate(() => {
    window.failSceneSave = true;
  });
  await choose("The office");
  await view.waitForFunction(() => window.fixtureErrors.includes("The scene was not saved. Please try again."));
  assert.equal(await canvas.getAttribute("data-firstmate-deck-setting"), "ship");
  await view.evaluate(() => {
    window.failSceneSave = false;
    window.fixtureErrors = [];
  });
  evidence.checks.push("failed save keeps ship and reports an error");

  await view.getByRole("button", { name: /^Scene:/ }).click();
  await view.screenshot({ path: join(here, "scene-picker.png") });
  evidence.screenshots.push("scene-picker.png");
  await view.getByRole("button", { name: /^The office, / }).click();
  await saved("office");
  await actual("office");
  await view.waitForTimeout(300);
  await view.screenshot({ path: join(here, "office.png") });
  evidence.screenshots.push("office.png");
  evidence.checks.push("ship to office through the visible scene picker; one office canvas");

  await view.reload();
  await view.getByRole("button", { name: "Open Deck", exact: true }).click();
  await actual("office");
  assert.match(await view.getByRole("button", { name: /^Scene:/ }).innerText(), /The office/);
  evidence.checks.push("office survives a full page reload via the host settings stub");

  await choose("Ship's deck");
  await saved("ship");
  await actual("ship");
  assert.deepEqual(await canvas.boundingBox(), shipBox, "switching back preserves ship canvas geometry");
  await view.mouse.move(5, 895);
  await view.waitForTimeout(300);
  await view.screenshot({ path: join(here, "ship.png") });
  evidence.screenshots.push("ship.png");
  evidence.checks.push("office to ship through the picker; original canvas geometry restored");

  await view.reload();
  await view.getByRole("button", { name: "Open Deck", exact: true }).click();
  await actual("ship");
  evidence.checks.push("ship survives a full page reload");
  // A separate client changing the shared settings document reaches both toolbar and engine.
  await view.evaluate(() => window.selectDeckSetting("office"));
  await actual("office");
  assert.match(await view.getByRole("button", { name: /^Scene:/ }).innerText(), /The office/);
  evidence.checks.push("external global setting changes update the toolbar and scene together");
  for (const width of [1100, 1440]) {
    await view.setViewportSize({ width, height: 900 });
    const button = view.getByRole("button", { name: /^Scene:/ });
    assert(await button.isVisible());
    const box = await button.boundingBox();
    assert(box.x >= 0 && box.x + box.width <= width, "scene control stays within the viewport");
  }
  assert.deepEqual(await view.evaluate(() => window.fixtureErrors), []);
  evidence.checks.push("scene control is visible at 1100 and 1440 pixels; no unexpected errors");
  await writeFile(join(here, "results.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence));
}
