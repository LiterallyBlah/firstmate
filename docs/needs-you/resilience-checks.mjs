import assert from "node:assert/strict";
import { join } from "node:path";
export async function checkResilience(pageAt, output) {
  for (const width of [390, 1440])
    for (const light of [false, true]) {
      const page = await pageAt(`view=crew${light ? "&light" : ""}`, width);
      const problem =
        "Line 12, task a: Could not read metadata; check parentheses.";
      await page.evaluate(async (problem) => {
        const snapshot = window.attentionSnapshot;
        snapshot.version++;
        snapshot.freshness.checkedAt = Date.now();
        snapshot.freshness.problems = [problem];
        snapshot.quarantined = [
          { line: 12, taskId: "a", key: "a", hasHold: true, problem },
        ];
        await window.refreshDecisions();
      }, problem);
      await page
        .getByRole("button", {
          name: /Needs you, 3 decisions.*Line 12, task a/,
        })
        .click();
      const drawer = page.getByLabel("FirstMate decisions", { exact: true });
      await drawer.getByText(problem, { exact: true }).waitFor();
      await drawer
        .getByText(/Couldn't read this task: a.*Board.*line 12/)
        .waitFor();
      assert.equal(
        await drawer
          .getByRole("button", { name: "Snooze ▾", exact: true })
          .isDisabled(),
        true,
      );
      assert.equal(
        await drawer
          .getByRole("button", { name: "Use the cautious option", exact: true })
          .isDisabled(),
        true,
      );
      assert.equal(
        await page.evaluate(
          () =>
            window.fixtureCalls.filter(
              (c) => c.name === "firstmate.needs-you.seen",
            ).length,
        ),
        0,
      );
      await page.screenshot({
        path: join(
          output,
          `quarantined-${width}-${light ? "light" : "dark"}.png`,
        ),
      });
      await drawer
        .getByRole("button", { name: "Next decision", exact: true })
        .click();
      await drawer
        .getByRole("heading", { name: "Decision b", exact: true })
        .waitFor();
      assert.equal(
        await drawer
          .getByRole("button", { name: "Snooze ▾", exact: true })
          .isDisabled(),
        false,
      );
      await page.waitForFunction(() =>
        window.fixtureCalls.some(
          (c) => c.name === "firstmate.needs-you.seen" && c.input.id === "b",
        ),
      );
      await drawer
        .getByRole("button", { name: "Open Board", exact: true })
        .click();
      await page.getByRole("heading", { name: "Board", exact: true }).waitFor();
      await page.evaluate(async () => {
        const snapshot = window.attentionSnapshot;
        snapshot.version++;
        snapshot.actionCount = null;
        snapshot.requests = [];
        snapshot.quarantined = [];
        snapshot.freshness = {
          status: "unknown",
          asOf: null,
          checkedAt: Date.now(),
          problems: [
            "Backlog must contain In flight, Queued and Done sections.",
          ],
        };
        await window.refreshDecisions();
      });
      await page
        .getByRole("button", { name: /^Needs you, count unavailable/ })
        .click();
      await drawer
        .getByText(
          "Backlog must contain In flight, Queued and Done sections.",
          { exact: true },
        )
        .waitFor();
      await drawer
        .getByRole("button", { name: "Open backlog.md", exact: true })
        .waitFor();
      await drawer
        .getByRole("button", {
          name: "Ask the first mate to fix it",
          exact: true,
        })
        .click();
      assert.equal(
        await page.evaluate(
          () =>
            window.fixtureCalls.filter((c) =>
              /needs-you\.(snooze|answer)/.test(c.name),
            ).length,
        ),
        0,
      );
      await page.screenshot({
        path: join(
          output,
          `unavailable-${width}-${light ? "light" : "dark"}.png`,
        ),
      });
      await page.close();
    }
}
