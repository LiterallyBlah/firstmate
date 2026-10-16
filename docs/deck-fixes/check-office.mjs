import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function checkOffice(view) {
  await view.getByRole("button", { name: /^Scene:/ }).click();
  await view.getByRole("button", { name: /^Ship's deck, / }).waitFor();
  assert.equal(await view.getByRole("button", { name: /^The office, / }).count(), 0);
  await view.screenshot({ path: fileURLToPath(new URL("office-withdrawn-picker.png", import.meta.url)) });
  await view.getByRole("button", { name: /^Ship's deck, / }).click();
  await view.evaluate(() => window.selectDeckSetting("office"));
  await view.getByRole("alert").filter({ hasText: 'The setting "office" is not installed.' }).waitFor();
  await view.waitForSelector('canvas[data-firstmate-deck-setting="ship"][data-firstmate-deck-motion]');
  assert.equal(await view.locator("canvas[data-firstmate-deck]").count(), 1);
  await view.screenshot({ path: fileURLToPath(new URL("office-withdrawn-fallback.png", import.meta.url)) });
  await writeFile(new URL("office-interactions.json", import.meta.url), JSON.stringify({
    checks: ["Office absent from the real scene picker", "saved Office selection falls back to one Ship canvas with a notice"],
  }, null, 2) + "\n");
}
