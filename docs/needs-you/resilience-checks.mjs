/** Real drawer/indicator regression checks with synthetic observation failures. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export async function checkResilience(pageAt, output) {
  await mkdir(output, { recursive: true });
  for (const width of [390, 1440]) {
    const page = await pageAt(`view=crew${width === 390 ? "&light" : ""}`, width);
    const problem = "Line 12, task a: Could not read metadata; check parentheses.";
    await page.evaluate(async problem => {
      const snapshot = window.attentionSnapshot;
      snapshot.version++;
      snapshot.freshness.checkedAt++;
      snapshot.freshness.problems = [problem];
      snapshot.quarantined = [{ line: 12, taskId: "a", key: "a", hasHold: true, problem }];
      await window.refreshDecisions();
    }, problem);
    const indicator = page.getByRole("button", { name: /Needs you, 3 decisions.*Line 12, task a/ });
    await indicator.waitFor();
    assert.ok((await indicator.getAttribute("title")).includes(problem));
    await indicator.click();
    const drawer = page.getByLabel("FirstMate decisions", { exact: true });
    await drawer.getByText(problem, { exact: true }).waitFor();
    await drawer.getByText(/Couldn't read this task: a.*Board.*line 12/).waitFor();
    assert.equal(await drawer.getByRole("button", { name: "Mark seen", exact: true }).isDisabled(), true);
    assert.equal(await drawer.getByRole("button", { name: "Answer: Use the cautious option", exact: true }).isDisabled(), true);
    await page.screenshot({ path: join(output, `quarantined-${width}.png`) });
    await drawer.getByRole("button", { name: "Next decision", exact: true }).click();
    await drawer.getByRole("heading", { name: "Decision b", exact: true }).waitFor();
    assert.equal(await drawer.getByRole("button", { name: "Mark seen", exact: true }).isDisabled(), false);
    await drawer.getByRole("button", { name: "Open Board", exact: true }).click();
    await page.getByRole("heading", { name: "Board", exact: true }).waitFor();
    await page.evaluate(async () => {
      const snapshot = window.attentionSnapshot;
      snapshot.version++;
      snapshot.actionCount = null;
      snapshot.requests = [];
      snapshot.quarantined = [];
      snapshot.freshness = { status: "unknown", asOf: null, checkedAt: Date.now() + 1000,
        problems: ["Backlog must contain In flight, Queued and Done sections."] };
      await window.refreshDecisions();
    });
    await page.getByRole("button", { name: /^Needs you, count unavailable/ }).click();
    await drawer.getByText("Backlog must contain In flight, Queued and Done sections.", { exact: true }).waitFor();
    assert.equal(await drawer.getByRole("button", { name: "Mark seen", exact: true }).count(), 0);
    await page.screenshot({ path: join(output, `unavailable-${width}.png`) });
    assert.equal(await page.evaluate(() => window.fixtureCalls.filter(c => /needs-you\.(seen|snooze|answer)/.test(c.name)).length), 0);
    await page.close();
  }
}
