import assert from "node:assert/strict";
import { join } from "node:path";

/** Real drawer/send gate with synthetic RPCs; accepted answers leave the source hold intact. */
export async function checkAnswers(pageAt, output) {
  const results = [];
  const button = (page, name) => page.getByRole("button", { name, exact: true });
  const heading = (page, name) => page.getByRole("heading", { name, exact: true });
  const drawer = page => page.getByLabel("FirstMate decisions", { exact: true });
  const answer = async page => {
    await page.getByRole("textbox", { name: "Answer the first mate", exact: true }).fill("Choose the cautious option.");
    await button(page, "Send answer").click();
  };
  for (const width of [390, 1440]) for (const light of [false, true]) {
    const suffix = `${width}-${light ? "light" : "dark"}`;
    const page = await pageAt(`view=crew${light ? "&light" : ""}`, width);
    await page.getByRole("button", { name: /^Needs you, 3 items/ }).click();
    await heading(page, "Decision a").waitFor();
    await button(page, "All decisions").click();
    await button(page, /^Answer: Decision b\./).first().click();
    await answer(page);
    await heading(page, "Decision seen").waitFor();
    await page.getByText("Answer sent.", { exact: true }).waitFor();
    assert.equal(await button(page, "View last decision").count(), 0);
    await page.screenshot({ path: join(output, `answer-from-all-${suffix}.png`) });
    await page.evaluate(async () => { await window.refreshDecisions(); });
    // Seen acknowledgement cannot reorder the session, and the unchanged hold cannot bring b back.
    await button(page, "Previous decision").click();
    await heading(page, "Decision a").waitFor();
    await button(page, "Next decision").click();
    await heading(page, "Decision seen").waitFor();
    await answer(page);
    await heading(page, "Decision a").waitFor();
    assert.equal(await button(page, "Next decision").isDisabled(), true);
    await answer(page);
    await drawer(page).waitFor({ state: "detached" });
    await heading(page, "List").waitFor();
    await page.waitForFunction(() => document.activeElement?.id.startsWith("needs-you-"));
    await page.screenshot({ path: join(output, `last-answer-${suffix}.png`) });
    const sent = await page.evaluate(() => window.fixtureCalls.filter(c => c.name.endsWith(".answer")));
    assert.deepEqual(sent.map(call => call.input.requestId), ["b", "seen", "a"]);
    assert.equal(await page.evaluate(() => window.attentionSnapshot.requests.find(r => r.id === "a").source.ask.length > 0), true);
    await page.evaluate(async () => { await window.refreshDecisions(); });
    await page.getByRole("button", { name: /^Needs you, 0 items/ }).click();
    assert.equal(await heading(page, "Decision a").count(), 0);
    assert.equal(await heading(page, "Decision b").count(), 0);
    assert.equal(await page.getByRole("textbox", { name: "Answer the first mate", exact: true }).count(), 0);
    await button(page, "All decisions").click();
    await heading(page, "Answered · waiting for the first mate").waitFor();
    await page.screenshot({ path: join(output, `lingering-holds-${suffix}.png`) });
    await page.close();

    const last = await pageAt(`view=board${light ? "&light" : ""}`, width);
    await last.evaluate(async () => {
      const s = window.attentionSnapshot;
      s.requests = s.requests.filter(r => r.id === "a");
      s.actionCount = s.newCount = 1; s.pendingAnswerCount = s.snoozedCount = 0;
      s.version++; await window.refreshDecisions();
    });
    await last.getByRole("button", { name: /^Needs you, 1 items/ }).click();
    await heading(last, "Decision a").waitFor();
    await button(last, "All decisions").click();
    await button(last, /^Answer: Decision a\./).first().click();
    await answer(last);
    await drawer(last).waitFor({ state: "detached" });
    await heading(last, "Board").waitFor();
    await last.screenshot({ path: join(output, `last-from-all-${suffix}.png`) });
    await last.close();

    const failed = await pageAt(`view=crew${light ? "&light" : ""}`, width);
    await failed.getByRole("button", { name: /^Needs you, 3 items/ }).click();
    await heading(failed, "Decision a").waitFor();
    await failed.evaluate(() => { window.attentionRefuse = true; });
    await answer(failed);
    await failed.getByText("Could not confirm this submission.", { exact: false }).waitFor();
    await heading(failed, "Decision a").waitFor();
    assert.equal(await failed.getByRole("textbox", { name: "Answer the first mate", exact: true }).inputValue(), "Choose the cautious option.");
    await failed.screenshot({ path: join(output, `failed-answer-${suffix}.png`) });
    await failed.close();
    results.push({ width, light, passed: true });
  }
  return results;
}
