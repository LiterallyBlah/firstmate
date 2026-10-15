/** Actual compiled client/RPC/art: crowded hull targets must focus 24 distinct workers. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export async function checkIdle(view, manifest) {
  assert.equal(manifest.id, "ship");
  const canvas = view.locator("canvas[data-firstmate-deck]");
  const panel = view.getByTestId("firstmate-deck-focus");
  const refresh = async () => {
    await view.getByRole("button", { name: "Refresh", exact: true }).click();
    await view.waitForTimeout(350);
  };
  const cards = await view.evaluate(() => {
    const fleet = window.fixtureFleet;
    const template = fleet.cards.find(card => card.agent !== null && card.agent.status !== "closed");
    return Array.from({ length: 24 }, (_, i) => {
      const id = String(i).padStart(2, "0");
      return { ...structuredClone(template), key: `idle-check-${id}`, title: `Below-deck worker ${id}`,
        column: "idle", note: null, agent: { ...structuredClone(template.agent), id: `idle-check-${id}`, status: "finished" } };
    });
  });
  await view.evaluate(cards => window.changeFleet(fleet => { fleet.cards = cards; }), cards);
  await refresh();
  const { fit } = await view.evaluate(manifest => {
    const drawn = window.drawOverlay(manifest);
    document.querySelector("[data-firstmate-deck-overlay]").remove();
    return drawn;
  }, manifest);
  const box = await canvas.boundingBox();
  const click = async x => view.mouse.click(box.x + fit.x + x * fit.scale, box.y + fit.y + 138 * fit.scale);
  const close = async () => {
    await view.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });
  };
  await view.mouse.move(5, 895);
  await view.screenshot({ path: join(here, "below-deck-crowd.png"), clip: box });
  const names = [];
  const xs = [...Array.from({ length: 13 }, (_, i) => 80 + i * 12), ...Array.from({ length: 11 }, (_, i) => 272 + i * 12)];
  for (const x of xs) {
    await click(x);
    await panel.waitFor({ state: "visible" });
    names.push(await panel.getAttribute("aria-label"));
    await close();
  }
  assert.equal(new Set(names).size, 24, "every porthole focuses a different worker");
  assert.deepEqual([...names].sort(), Array.from({ length: 24 }, (_, i) => `Below-deck worker ${String(i).padStart(2, "0")}: details and actions`));
  await view.evaluate(() => window.changeFleet(fleet => { fleet.cards[0].column = "working"; }));
  await refresh();
  await click(128);
  assert.equal(await panel.count(), 0, "returning to work vacates the porthole");
  await view.evaluate(() => window.changeFleet(fleet => { fleet.cards[0].column = "idle"; }));
  await refresh();
  await click(128);
  await panel.waitFor({ state: "visible" });
  assert.equal(await panel.getAttribute("aria-label"), "Below-deck worker 00: details and actions");
  await view.evaluate(() => window.changeFleet(fleet => { fleet.cards.shift(); }));
  await refresh();
  await panel.waitFor({ state: "hidden" });
  await click(128);
  assert.equal(await panel.count(), 0, "removed workers leave no clickable ghost");
  await view.evaluate(cards => window.changeFleet(fleet => {
    fleet.cards = cards.map(card => ({ ...card, key: `replacement-${card.key}`, agent: { ...card.agent, id: `replacement-${card.agent.id}` } }));
  }), cards);
  await refresh();
  const replaced = [];
  for (const x of xs) {
    await click(x);
    await panel.waitFor({ state: "visible" });
    replaced.push(await panel.getAttribute("aria-label"));
    await close();
  }
  assert.deepEqual(replaced, names, "batch replacement reuses released posts at regular spacing");
  const evidence = { checks: ["24 distinct hull targets focus 24 worker cards", "working state vacates the below-deck target", "resting again preserves worker identity", "removal closes focus and removes the target", "batch replacement releases old reservations before assigning new workers"], focused: names, errors: [] };
  await writeFile(join(here, "below-deck-interactions.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence));
}
