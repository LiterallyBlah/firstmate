import assert from "node:assert/strict";
import { join } from "node:path";

/** A decision raised mid-conversation shows once in the chat, as a card from the snapshot. */
export async function checkRaised(pageAt, output) {
  const results = [];
  const button = (page, name) => page.getByRole("button", { name, exact: true });
  const card = (page) => page.getByTestId("decision-raised");
  for (const width of [390, 1440])
    for (const light of [false, true]) {
      const theme = light ? "light" : "dark";
      const page = await pageAt(`view=chat&raised-chat${light ? "&light" : ""}`, width);
      await card(page).getByText("Decision needs you", { exact: true }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await card(page).count(), 1);
      for (const text of ["Choose the Windows host", "Which machine should run the Windows build: Light or Atlas?", "Recommendation"])
        await card(page).getByText(text, { exact: true }).waitFor();
      await card(page).getByText("Atlas, so Light stays free for Ariadne.", { exact: false }).waitFor();
      // Placed where it was raised: after the brief was written, before the one-line reply.
      const order = await page.evaluate(() => {
        const text = document.body.innerText;
        return ["Write data/host/decision.md", "Decision needs you", "Captain, one call for you on the Windows host."].map((t) => text.indexOf(t));
      });
      assert.ok(order.every((at) => at >= 0) && order[0] < order[1] && order[1] < order[2], `order ${order}`);
      await page.screenshot({ path: join(output, `raised-${width}-${theme}.png`) });

      await button(page, "Choose: Atlas").click();
      await card(page).getByText("Answered · waiting for the first mate", { exact: true }).waitFor();
      const answers = await page.evaluate(() => window.fixtureCalls.filter((c) => c.name === "firstmate.needs-you.answer"));
      assert.equal(answers.length, 1);
      assert.deepEqual(
        { text: answers[0].input.text, actionId: answers[0].input.suggestion.actionId, requestId: answers[0].input.requestId },
        { text: "For host: I choose option 1.", actionId: "brief:1", requestId: "host" },
      );
      assert.equal(await button(page, "Choose: Light").count(), 0);
      await page.screenshot({ path: join(output, `raised-answered-${width}-${theme}.png`) });

      await page.evaluate(() => {
        const request = window.attentionSnapshot.requests[0];
        request.state = "resolved";
        request.resolution = { reason: "answered", at: Date.now() };
        window.attentionSnapshot.version++;
        window.attentionSnapshot.freshness.checkedAt = Date.now();
        return window.refreshDecisions();
      });
      await card(page).getByText("Settled · hold lifted", { exact: true }).waitFor();
      assert.equal(await card(page).count(), 1);
      await page.screenshot({ path: join(output, `raised-settled-${width}-${theme}.png`) });

      await card(page).getByRole("button", { name: "Open the decision", exact: true }).click();
      await page.getByRole("heading", { name: "Choose the Windows host (waiting for the captain)", exact: true }).waitFor();
      results.push({ width, theme });
      await page.close();
    }
  return results;
}
