import assert from "node:assert/strict";
import { join } from "node:path";

export async function checkDrawer(pageAt, output) {
  const evidence = [];
  const drawerFor = (page) =>
    page.getByLabel("FirstMate decisions", { exact: true });
  const heading = (page, name) =>
    page.getByRole("heading", { name, exact: true });
  const button = (page, name) =>
    page.getByRole("button", { name, exact: true });
  const input = (page) =>
    page.getByRole("textbox", { name: "Answer the first mate", exact: true });
  const calls = (page, suffix) =>
    page.evaluate(
      (suffix) =>
        window.fixtureCalls.filter(
          (c) => c.name === `firstmate.needs-you.${suffix}`,
        ),
      suffix,
    );
  for (const width of [320, 390, 637, 638, 900, 1440, 1680])
    for (const light of [false, true]) {
      const page = await pageAt(`view=crew${light ? "&light" : ""}`, width);
      const indicator = page.getByRole("button", {
        name: /^Needs you, 3 decisions/,
      });
      await page.evaluate(() => document.fonts.ready);
      if (width < 638)
        await page.waitForFunction(
          () =>
            Math.abs(
              document
                .querySelector('[id^="needs-you-"]')
                .getBoundingClientRect().width -
                (innerWidth - 24),
            ) < 1,
        );
      const rect = await indicator.boundingBox();
      assert.ok(rect.height >= (width < 638 ? 44 : 28));
      await page.screenshot({
        path: join(
          output,
          `indicator-${width}-${light ? "light" : "dark"}.png`,
        ),
      });
      await indicator.click();
      await heading(page, "Decision a").waitFor();
      await page.waitForFunction(() =>
        window.fixtureCalls.some((c) => c.name === "firstmate.needs-you.seen"),
      );
      assert.deepEqual((await calls(page, "seen"))[0].input, {
        homeId: "fixture-home",
        id: "a",
        revision: 1,
      });
      assert.equal(
        await page.evaluate(() => window.attentionSnapshot.actionCount),
        3,
      );
      await page.waitForFunction(() =>
        document.activeElement?.id.startsWith("decision-heading-"),
      );
      assert.equal(await button(page, "Use the cautious option").count(), 1);
      assert.equal(await button(page, "General action").count(), 0);
      const drawer = drawerFor(page);
      const box = await drawer.boundingBox();
      if (width < 1600) assert.equal(box.width, width);
      else assert.equal(box.width, 440);
      for (const b of await drawer.getByRole("button").all())
        if (await b.isVisible()) {
          assert.ok(
            (await b.boundingBox()).height >= (width < 638 ? 43.5 : 27.5),
            await b.getAttribute("aria-label"),
          );
        }
      await input(page).fill("Retained typed answer");
      if (width < 638) {
        const send = await button(page, "Send answer").boundingBox();
        assert.ok(
          send.y + send.height <= 844,
          "phone answer bar stays in the viewport",
        );
        await button(page, /^Back to (?:List|Board)$/).focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        assert.equal(
          await button(page, /^Back to (?:List|Board)$/).evaluate(
            (node) => node === document.activeElement,
          ),
          true,
        );
      }
      await page.evaluate(async () => {
        const next = structuredClone(window.attentionSnapshot.requests[0]);
        next.id = "arrival";
        next.detectedAt = 0;
        window.attentionSnapshot.requests.push(next);
        window.attentionSnapshot.version++;
        window.attentionSnapshot.freshness.checkedAt = Date.now();
        await window.refreshDecisions();
      });
      await heading(page, "Decision a").waitFor();
      await button(page, "Next decision").click();
      await heading(page, "Decision b").waitFor();
      await button(page, "Previous decision").click();
      await heading(page, "Decision a").waitFor();
      assert.equal(await input(page).inputValue(), "Retained typed answer");
      await page.screenshot({
        path: join(output, `drawer-${width}-${light ? "light" : "dark"}.png`),
      });
      await button(page, /^Back to (?:List|Board)$/).focus();
      await page.keyboard.press("Escape");
      await page.waitForFunction(() =>
        document.activeElement?.id.startsWith("needs-you-"),
      );
      assert.equal((await calls(page, "answer")).length, 0);
      evidence.push({ width, light, passed: true });
      await page.close();
    }
  // Home keeps the header and chat width while covering only the task pane at 1440.
  const home = await pageAt("", 1440);
  const chatBefore = await home.locator("#firstmate-chat-pane").boundingBox();
  await home.getByRole("button", { name: /^Needs you, 3 decisions/ }).click();
  await heading(home, "Decision a").waitFor();
  const chatAfter = await home.locator("#firstmate-chat-pane").boundingBox();
  const homeDrawer = await drawerFor(home).boundingBox();
  assert.equal(chatAfter.width, chatBefore.width);
  assert.ok(homeDrawer.x >= chatAfter.x + chatAfter.width);
  await home.screenshot({ path: join(output, "home-task-pane-cover.png") });
  await home.close();

  for (const width of [390, 1440])
    for (const light of [false, true]) {
      const page = await pageAt(
        `decision=a&revision=99${light ? "&light" : ""}`,
        width,
      );
      await page
        .getByText("The question changed since you opened it.", {
          exact: false,
        })
        .waitFor();
      await input(page).fill("A deliberate answer");
      await button(page, "Send answer").click();
      await heading(page, "Decision b").waitFor();
      await page
        .getByText("Answer sent on Decision a.", { exact: false })
        .waitFor();
      assert.equal(await button(page, "Next decision").isDisabled(), false);
      const sent = await calls(page, "answer");
      assert.equal(sent.length, 1);
      assert.equal(sent[0].input.recordRevision, 1);
      assert.equal(sent[0].input.requestId, "a");
      await page.screenshot({
        path: join(output, `answered-${width}-${light ? "light" : "dark"}.png`),
      });
      await button(page, "Snooze ▾").click();
      await button(page, "Pick a time…").click();
      await button(page, "Snooze until selected time").waitFor();
      assert.equal(await page.getByPlaceholder("YYYY-MM-DD HH:mm").count(), 0);
      await page.screenshot({
        path: join(
          output,
          `snooze-picker-${width}-${light ? "light" : "dark"}.png`,
        ),
      });
      await button(page, "Snooze until selected time").click();
      await heading(page, "Decision seen").waitFor();
      assert.equal((await calls(page, "snooze"))[0].input.id, "b");
      assert.equal(await button(page, "Next decision").isDisabled(), false);
      await button(page, "All decisions").click();
      for (const label of [
        "Waiting for you",
        "Answered · waiting for the first mate",
        "Snoozed",
      ])
        await page.getByText(label, { exact: false }).first().waitFor();
      await page.screenshot({
        path: join(output, `all-${width}-${light ? "light" : "dark"}.png`),
      });
      await page.close();

      const uncertain = await pageAt(
        `decision=a${light ? "&light" : ""}`,
        width,
      );
      await uncertain.evaluate(() => {
        window.attentionUncertain = true;
      });
      await button(uncertain, "Use the cautious option").click();
      await uncertain
        .getByText("Delivery not confirmed", { exact: true })
        .waitFor();
      for (const name of [
        "Open the first mate’s chat",
        "It arrived",
        "Send again…",
      ])
        assert.equal(await button(uncertain, name).isDisabled(), false);
      await button(uncertain, "Send again…").click();
      assert.equal((await calls(uncertain, "answer")).length, 1);
      await button(uncertain, "Cancel").click();
      assert.equal((await calls(uncertain, "record-answer")).length, 0);
      await uncertain.screenshot({
        path: join(
          output,
          `uncertain-${width}-${light ? "light" : "dark"}.png`,
        ),
      });
      await button(uncertain, "It arrived").click();
      await heading(uncertain, "Decision b").waitFor();
      assert.equal(
        (await calls(uncertain, "record-answer"))[0].input.outcome,
        "accepted",
      );
      assert.equal((await calls(uncertain, "answer")).length, 1);
      await uncertain.close();
    }
  const retry = await pageAt("decision=a", 390);
  await retry.evaluate(() => {
    window.attentionUncertain = true;
  });
  await input(retry).fill("Retry these exact words");
  await button(retry, "Send answer").click();
  await button(retry, "Send again…").click();
  await retry.evaluate(() => {
    window.attentionUncertain = false;
  });
  await button(retry, "Confirm and send again").click();
  await heading(retry, "Decision b").waitFor();
  const resent = await calls(retry, "answer");
  assert.equal(resent.length, 2);
  assert.notEqual(resent[0].input.submissionId, resent[1].input.submissionId);
  assert.equal(resent[1].input.text, "Retry these exact words");
  assert.equal(
    (await calls(retry, "record-answer"))[0].input.outcome,
    "failed",
  );
  await retry.close();

  const mark = await pageAt("decision=a", 390);
  await mark.waitForFunction(
    () =>
      window.attentionSnapshot.requests.find((r) => r.id === "a").state ===
      "seen",
  );
  await button(mark, "Decision actions").click();
  await button(mark, "Mark as new").click();
  await mark.waitForFunction(
    () =>
      window.attentionSnapshot.requests.find((r) => r.id === "a").state ===
      "new",
  );
  assert.equal((await calls(mark, "new"))[0].input.revision, 1);
  await button(mark, "More answer actions").click();
  await button(mark, "I answered in chat").click();
  await heading(mark, "Decision b").waitFor();
  assert.equal((await calls(mark, "answer")).length, 0);
  await mark.close();

  for (const light of [false, true])
    for (const state of ["new", "seen", "clear", "stale", "unknown"]) {
      const page = await pageAt(
        `view=crew&sidebar${light ? "&light" : ""}`,
        1440,
      );
      await page.evaluate(async (state) => {
        const s = window.attentionSnapshot;
        s.version++;
        s.freshness.checkedAt = Date.now();
        if (state === "seen" || state === "clear") {
          s.newCount = 0;
          s.requests.forEach((r) => {
            if (r.state === "new") r.state = "seen";
          });
        }
        if (state === "clear") {
          s.actionCount = 0;
          s.requests = [];
        }
        if (state === "stale") {
          s.freshness.status = "stale";
          s.freshness.problems = ["Could not read data/backlog.md."];
        }
        if (state === "unknown") {
          s.actionCount = null;
          s.freshness.status = "unknown";
          s.freshness.problems = [
            "Backlog must contain In flight, Queued and Done sections.",
          ];
        }
        await window.refreshDecisions();
      }, state);
      const indicator = page.locator('[id^="needs-you-"]');
      await page.waitForFunction((state) => {
        const text = document.querySelector('[id^="needs-you-"]').textContent;
        return state === "unknown"
          ? text.includes("Can't read decisions")
          : state === "clear"
            ? text.includes("Nothing needs you")
            : state === "stale"
              ? text.includes("as of")
              : state === "new"
                ? text.includes("new")
                : !text.includes("new");
      }, state);
      const style = await indicator.evaluate((n) => ({
        border: getComputedStyle(n).borderColor,
        background: getComputedStyle(n).backgroundColor,
        dashed: getComputedStyle(n).borderStyle,
      }));
      if (state === "seen") {
        assert.equal(style.border, "rgb(192, 150, 100)");
        assert.notEqual(style.background, style.border);
      }
      if (state === "stale") assert.equal(style.dashed, "dashed");
      await page.screenshot({
        path: join(output, `signal-${state}-${light ? "light" : "dark"}.png`),
      });
      await page.close();
    }
  for (const width of [390, 1440])
    for (const light of [false, true]) {
      const page = await pageAt(
        `view=chat&answer-chat${light ? "&light" : ""}`,
        width,
      );
      await page
        .getByText("Your answer to «Choose the Windows host»", { exact: true })
        .waitFor();
      await page
        .getByText("Atlas. Keep Light for Ariadne.", { exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByText("<firstmate-decision-answer>", { exact: false })
          .count(),
        0,
      );
      await page.screenshot({
        path: join(
          output,
          `chat-answer-${width}-${light ? "light" : "dark"}.png`,
        ),
      });
      await button(page, "Show what was sent").click();
      await page
        .getByText("<firstmate-decision-answer>", { exact: false })
        .waitFor();
      await button(page, "Open the decision").click();
      await heading(page, "Decision a").waitFor();
      await page.close();
    }
  return evidence;
}
