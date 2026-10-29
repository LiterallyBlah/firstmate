import assert from "node:assert/strict";
import { join } from "node:path";
import { checkPanelReturn } from "./panel-return-check.mjs";

const brief = `# Which pilot should run first?

**Background.** The engine works but has not completed a real job from start to finish.
A frozen public corpus lets reviewers verify every claim before trying a live environment.

**Options:**
1. **Public research pilot (recommended).** Start with a frozen public corpus.
   - No lab setup or live environment needed.
2. **Owned security lab.** Exercise the security profile after its lab VM and scope are ready.

**My recommendation:** Start with the public research pilot once model budgets are in place.
Keep the owned lab for the security profile's own proof.`;

export async function checkPolish(pageAt, output) {
  const results = [];
  const button = (page, name) => page.getByRole("button", { name, exact: true });
  const drawerFor = page => page.getByLabel("FirstMate decisions", { exact: true });
  for (const width of [390, 1440]) for (const light of [false, true]) {
    const page = await pageAt(`views${light ? "&light" : ""}`, width);
    await page.evaluate(async content => {
      const s = window.attentionSnapshot;
      const first = s.requests.find(r => r.id === "a");
      first.source.title = "Choose the first research pilot";
      first.source.ask = "Which pilot should prove the generic loop end to end? The scope must let reviewers verify the claims and show how the loop works before it touches any live environment.";
      s.briefs = [{ requestId: "a", recordRevision: 1, path: `data/${first.source.taskId}/decision.md`, content }];
      s.answerOptions = [{ label: "Public research pilot", prompt: "Choose the public research pilot", decision: {
        homeId: s.homeId, requestId: "a", recordRevision: 1, actionId: "brief:fixture" } }];
      s.parked = [{ ...first.source, key: "parked", taskId: "parked", disposition: "parked", blockedBy: "The public launch has finished",
        title: "Later talks: prepare a detailed conference proposal, collect lessons from the public launch, review the long-term research direction, and choose a venue after the current delivery and documentation work has finished" }];
      s.requests.push({ ...structuredClone(first), id: "settled", source: { ...first.source, title: "Agree on the review checklist" }, state: "resolved",
        resolution: { reason: "answered", at: Date.now() } });
      s.version++;
      await window.refreshDecisions();
    }, brief);
    if (width === 1440) {
      const header = page.locator("#firstmate-home-header");
      assert.ok((await header.boundingBox()).height < 65, "desktop Home header occupies one row");
      assert.equal(await button(page, "Open Deck").count(), 0);
      await button(page, "Open").click();
      for (const label of ["Open Deck", "Open Board", "Open List", "Open Chat", "Shared terminal", "New browser", "Terminal & browser"])
        await button(page, label).waitFor();
      await page.getByRole("dialog", { name: "FirstMate workspace" }).getByRole("button", { name: "Close", exact: true }).click();
    }
    await page.mouse.move(0, 0);
    await page.keyboard.press("Escape");
    await page.evaluate(() => document.activeElement?.blur());
    await page.screenshot({ path: join(output, `polish-home-${width}-${light ? "light" : "dark"}.png`) });
    if (width < 638) await page.getByRole("tab", { name: "List", exact: true }).click();
    await page.getByRole("button", { name: /^Needs you, 3 items/ }).click();
    const drawer = drawerFor(page);
    await button(drawer, "Back to List").waitFor();
    const rendered = drawer.getByTestId("decision-brief");
    await rendered.getByRole("heading", { name: "Background", exact: true }).waitFor();
    await rendered.getByText("Keep the owned lab", { exact: false }).waitFor();
    assert.equal(await button(rendered, "Choose: Public research pilot").count(), 1);
    assert.equal(await button(rendered, "Choose: Owned security lab").count(), 0, "unbound options remain readable, never fake a send");
    await page.screenshot({ path: join(output, `polish-brief-${width}-${light ? "light" : "dark"}.png`) });
    await rendered.getByRole("heading", { name: "My recommendation", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, `polish-recommendation-${width}-${light ? "light" : "dark"}.png`) });
    await button(drawer, "All decisions").click();
    for (const heading of ["Waiting for you", "Parked until something else happens", "Settled today"])
      await drawer.getByRole("heading", { name: heading, exact: true }).waitFor();
    const waiting = drawer.getByTestId("decision-group").filter({ has: page.getByRole("heading", { name: "Waiting for you", exact: true }) });
    await waiting.getByText("The scope must let reviewers", { exact: false }).waitFor();
    await waiting.getByText("Keep the owned lab", { exact: false }).waitFor();
    const parked = button(drawer, /^Full title: Later talks:/);
    await parked.scrollIntoViewIfNeeded();
    const before = (await parked.boundingBox()).height;
    await parked.click();
    assert.equal(await parked.getAttribute("aria-expanded"), "true");
    if (width < 638) assert.ok((await parked.boundingBox()).height > before, "parked title expands with one press");
    await parked.click();
    await page.screenshot({ path: join(output, `polish-all-${width}-${light ? "light" : "dark"}.png`) });
    await button(drawer, "Back to Needs you").click();
    const input = drawer.getByRole("textbox", { name: "Answer the first mate", exact: true });
    await input.fill("Keep this answer while its record is stale");
    await page.evaluate(async () => {
      const s = window.attentionSnapshot, r = s.requests.find(r => r.id === "a");
      s.quarantined = [{ line: 0, taskId: r.source.taskId, key: r.source.key, hasHold: true, problem: "Task is missing; restore its record." }];
      s.version++;
      await window.refreshDecisions();
    });
    await page.waitForFunction(() => document.querySelector('[aria-label="Send answer"]')?.getAttribute("aria-disabled") === "true");
    assert.equal(await input.inputValue(), "Keep this answer while its record is stale");
    await button(drawer, "Next decision").click();
    await input.fill("This independent task is ready");
    assert.equal(await button(drawer, "Send answer").isDisabled(), false);
    await button(drawer, "Previous decision").click();
    assert.equal(await input.inputValue(), "Keep this answer while its record is stale");
    await page.evaluate(async () => { window.attentionSnapshot.quarantined = []; window.attentionSnapshot.version++; await window.refreshDecisions(); });
    await page.waitForFunction(() => !document.querySelector('[aria-label="Send answer"]')?.hasAttribute("aria-disabled"));
    await button(drawer, "Back to List").click();
    assert.equal(await drawer.count(), 0);
    results.push({ width, light, passed: true });
    await page.close();
  }
  for (const view of ["deck", "board", "crew"]) {
    const page = await pageAt(`view=${view}`, 1440);
    await checkPanelReturn(page, view);
    await page.close();
  }
  for (const width of [638, 900]) {
    const page = await pageAt("views", width), header = page.locator("#firstmate-home-header");
    await button(header, "List view").waitFor();
    assert.ok((await header.boundingBox()).height < 65);
    const controls = await header.getByRole("button").all();
    let right = 0;
    for (const control of controls) {
      const box = await control.boundingBox();
      assert.ok(box.x >= right && box.x + box.width <= width, "narrow desktop header controls fit without overlap");
      right = box.x + box.width;
    }
    await button(header, "List view").click();
    await page.getByRole("dialog", { name: "Home view" }).getByRole("tab", { name: "Board", exact: true }).click();
    await button(header, "Board view").waitFor();
    await page.close();
  }
  for (const light of [false, true]) {
    const page = await pageAt(`view=deck${light ? "&light" : ""}`, 1440);
    await page.locator("canvas[data-firstmate-deck-setting=ship]").waitFor();
    await page.evaluate(async () => { const s = window.attentionSnapshot; s.freshness.status = "stale"; s.version++; await window.refreshDecisions(); });
    const legend = page.getByTestId("firstmate-deck-decision-legend");
    const asOf = await page.evaluate(() => [new Date(window.attentionSnapshot.freshness.asOf).getHours(), new Date(window.attentionSnapshot.freshness.asOf).getMinutes()].map(n => String(n).padStart(2, "0")).join(":"));
    await legend.getByText(`3 need you · Last updated ${asOf} ·`, { exact: true }).waitFor();
    assert.equal(await page.getByText("Decision data is stale", { exact: false }).count(), 0);
    assert.equal(await page.getByText("the first mate is waiting at the bow", { exact: false }).count(), 0);
    assert.equal(await page.getByText(/Last updated/).count(), 1);
    await page.getByTestId("firstmate-deck-decision-tag").click();
    assert.equal(await drawerFor(page).count(), 0);
    await page.getByRole("dialog", { name: "First mate needs you", exact: true })
      .getByRole("button", { name: "Open decision: Decision a", exact: true }).click();
    await button(drawerFor(page), "Back to Deck").click();
    await page.screenshot({ path: join(output, `polish-deck-stale-1440-${light ? "light" : "dark"}.png`) });
    await page.close();
  }
  return results;
}
