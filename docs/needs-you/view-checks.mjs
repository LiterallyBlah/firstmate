import assert from "node:assert/strict";
import { join } from "node:path";
export async function checkTaskViews(pageAt, generated) {
  const evidence = [];
  for (const view of ["crew", "board"])
    for (const width of [1440, 390, 320]) {
      const page = await pageAt(`views&view=${view}${width === 390 ? "&light" : ""}`, width);
      const surface = page.getByTestId(view === "crew" ? "firstmate-task-list" : "firstmate-task-board");
      await surface.waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.deepEqual(await page.evaluate(() => window.fixtureSettingSaves), []);
      if (width < 638)
        await page.waitForFunction(
          () => document.querySelector('[id^="needs-you-"]').getBoundingClientRect().width === innerWidth - 24,
        );
      const decisions = surface.getByRole("button", { name: /^Open decision:/ });
      assert.equal(await decisions.count(), 3);
      assert.equal(
        await surface.getByText("Across all machines · task filters do not hide decisions", { exact: true }).count(),
        1,
      );
      const name = await decisions.first().getAttribute("aria-label");
      assert.ok(name.includes("run the local smoke check"));
      for (const button of await decisions.all()) {
        const box = await button.boundingBox();
        assert.ok(box.width >= 44 && box.height >= 44);
      }
      assert.equal(await surface.getByText("private-model-detail", { exact: false }).count(), 0);
      assert.equal(
        await surface.getByText("Exact failure: validation exited with code 17", { exact: true }).count(),
        0,
      );
      if (view === "board") {
        const ids = await surface
          .locator('[data-testid^="task-column-"]')
          .evaluateAll((nodes) => nodes.map((n) => n.dataset.testid));
        assert.deepEqual(ids, [
          "task-column-needs-you",
          "task-column-in-hand",
          "task-column-later",
          "task-column-done",
        ]);
        assert.equal(await surface.getByRole("button", { name: /^Move Needs you/ }).count(), 0);
        for (const title of ["Later", "Done"])
          assert.equal(
            await surface.getByRole("button", { name: new RegExp(`^Unfold ${title}`) }).getAttribute("aria-expanded"),
            "false",
          );
        if (width < 638) {
          const columns = await surface.locator('[data-testid^="task-column-"]').evaluateAll((nodes) =>
            nodes.map((n) => {
              const r = n.getBoundingClientRect();
              return { x: r.x, y: r.y, bottom: r.bottom, width: r.width };
            }),
          );
          for (let i = 1; i < columns.length; i++) {
            assert.equal(columns[i].x, columns[0].x);
            assert.ok(columns[i].y >= columns[i - 1].bottom);
            assert.ok(columns[i].width <= width - 24);
          }
        }
        await surface.getByRole("button", { name: "Fold Needs you · 3", exact: true }).click();
        await surface.getByRole("button", { name: "Unfold Needs you · 3", exact: true }).waitFor();
        const foldedInk = await surface
          .getByTestId("task-column-needs-you")
          .getByText("3 · +", { exact: true })
          .evaluate((node) => getComputedStyle(node).color);
        assert.equal(foldedInk, "rgb(192, 150, 100)");
        await surface.getByRole("button", { name: "Unfold Needs you · 3", exact: true }).click();
      } else {
        assert.equal(
          await surface.getByRole("button", { name: /^Later .*Show tasks$/ }).getAttribute("aria-expanded"),
          "false",
        );
        assert.equal(
          await surface.getByRole("button", { name: /^Done .*Show tasks$/ }).getAttribute("aria-expanded"),
          "false",
        );
        assert.equal(await surface.locator('[data-testid="firstmate-task-list"]').count(), 0);
      }
      await surface.evaluate((node) => {
        node.scrollTop = 0;
      });
      await page.screenshot({ path: join(generated, `views-${view}-${width}.png`) });
      await decisions.first().focus();
      await page.keyboard.press("Enter");
      await page
        .getByRole("heading", { name: "Install the merged board changes and check the live panel", exact: true })
        .waitFor();
      assert.equal(
        await page.evaluate(
          () => window.fixtureCalls.filter((c) => /needs-you\.(snooze|answer)/.test(c.name)).length,
        ),
        0,
      );
      await page
        .getByRole("textbox", { name: "Answer the first mate", exact: true })
        .fill("Preserve this decision draft");
      await page.evaluate(async () => {
        // A worker moving while an answer is being composed cannot replace the ledger request or its draft.
        window.fixtureFleet.cards.find((card) => card.key === "block-0").column = "ready";
        await window.queryClient.invalidateQueries({ queryKey: ["firstmate", "fleet"] });
      });
      assert.equal(
        await page.getByRole("textbox", { name: "Answer the first mate", exact: true }).inputValue(),
        "Preserve this decision draft",
      );
      await page.getByRole("button", { name: "Close decisions" }).focus();
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => document.activeElement?.id.startsWith("decision-task-"));
      await page.getByRole("button", { name: /^Open decision: Install the merged board changes and check the live panel\./ }).click();
      assert.equal(
        await page.getByRole("textbox", { name: "Answer the first mate", exact: true }).inputValue(),
        "Preserve this decision draft",
      );
      await page.getByRole("button", { name: "Close decisions" }).click();
      // Diagnostics are one tap away, while the ordinary summary is neutral ownership text.
      const failure = surface.getByRole("button", { name: /^Recover the failed validation run\./ });
      await failure.click();
      await surface.getByText("Exact failure: validation exited with code 17", { exact: true }).waitFor();
      assert.equal(await surface.getByText("builder · failure-example", { exact: false }).count(), 1);
      assert.equal(await surface.getByText("private-model-detail", { exact: false }).count(), 1);
      await page.screenshot({ path: join(generated, `views-details-${view}-${width}.png`) });
      await surface
        .getByRole("button", { name: /^Review the workstation setup before the worker continues\./ })
        .click();
      await surface.getByText("waiting on a permission", { exact: true }).waitFor();
      await surface
        .getByRole("button", {
          name: "Details for decision Install the merged board changes and check the live panel",
          exact: true,
        })
        .click();
      await surface.getByText("A worker error must not replace the recorded question", { exact: true }).waitFor();
      await surface.getByText("The second worker's full diagnostic is also retained", { exact: true }).waitFor();
      evidence.push({ view, width, decisions: 3, passed: true });
      await page.close();
    }
  for (const view of ["crew", "board"]) {
    const page = await pageAt(`views&filtered&view=${view}`, 320);
    await page.getByText("No items match the selected tags on this host.").waitFor();
    assert.equal(await page.getByRole("button", { name: /^Open decision:/ }).count(), 3);
    const before = await page.evaluate(() => window.fixtureDocuments.display);
    if (view === "board") {
      await page.getByRole("button", { name: "Detailed columns", exact: true }).click();
      await page.getByRole("button", { name: "Summary columns", exact: true }).waitFor();
      await page.getByRole("button", { name: "Summary columns", exact: true }).click();
      await page.getByTestId("firstmate-task-board").waitFor();
    }
    assert.deepEqual(await page.evaluate(() => window.fixtureDocuments.display), before);
    await page.close();
  }
  const legacy = await pageAt("views&view=board");
  const old = await legacy.evaluate(() => window.fixtureDocuments.display);
  await legacy.getByRole("button", { name: "Detailed columns", exact: true }).click();
  await legacy.getByTestId("firstmate-board").waitFor();
  await legacy.getByRole("button", { name: "Unfold Blocked", exact: true }).waitFor();
  await legacy.getByRole("button", { name: "Unfold Blocked", exact: true }).click();
  const legacyDecision = legacy
    .getByRole("button", {
      name: "Open decision: Install the merged board changes and check the live panel",
      exact: true,
    })
    .first();
  await legacyDecision.focus();
  await legacy.keyboard.press("Enter");
  await legacy
    .getByRole("heading", { name: "Install the merged board changes and check the live panel", exact: true })
    .waitFor();
  await legacy.getByRole("button", { name: "Close decisions" }).focus();
  await legacy.keyboard.press("Escape");
  await legacy.waitForFunction(() => document.activeElement?.id.startsWith("card-decision-"));
  // Restore the legacy fold before checking that summary saves never reinterpret it.
  await legacy.getByRole("button", { name: "Fold Blocked", exact: true }).click();
  await legacy.waitForFunction(() => JSON.parse(localStorage.getItem("view-settings-display") ?? "{}").collapsedColumns?.includes("blocked"));
  await legacy.reload();
  await legacy.getByRole("button", { name: "Summary columns", exact: true }).waitFor();
  await legacy.getByRole("button", { name: "Summary columns", exact: true }).click();
  await legacy.getByTestId("firstmate-task-board").waitFor();
  await legacy.getByRole("button", { name: "Move In hand right", exact: true }).click();
  await legacy.getByRole("button", { name: "Fold Needs you · 3", exact: true }).click();
  await legacy.getByRole("button", { name: "Unfold Needs you · 3", exact: true }).waitFor();
  await legacy.reload();
  await legacy.getByRole("button", { name: "Unfold Needs you · 3", exact: true }).waitFor();
  assert.deepEqual(
    await legacy
      .getByTestId("firstmate-task-board")
      .locator('[data-testid^="task-column-"]')
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.testid)),
    ["task-column-needs-you", "task-column-later", "task-column-in-hand", "task-column-done"],
  );
  assert.deepEqual(await legacy.evaluate(() => window.fixtureDocuments.display), old);
  await legacy.close();
  const many = await pageAt("views&many&view=crew", 320);
  await many.getByTestId("firstmate-task-list").waitFor();
  assert.equal(await many.getByRole("button", { name: /^Open decision:/ }).count(), 35);
  const last = many.getByRole("button", { name: /^Open decision: Decision 31:/ });
  await last.focus();
  const scrolled = await many.getByTestId("firstmate-task-list").evaluate((node) => node.scrollTop);
  assert.ok(scrolled > 0);
  await many.keyboard.press("Enter");
  await many.getByRole("heading", { name: /^Decision 31:/ }).waitFor();
  await many.getByRole("button", { name: "Close decisions" }).focus();
  await many.keyboard.press("Escape");
  await many.waitForFunction(() =>
    document.activeElement?.getAttribute("aria-label")?.startsWith("Open decision: Decision 31:"),
  );
  assert.equal(await many.getByTestId("firstmate-task-list").evaluate((node) => node.scrollTop), scrolled);
  await many.close();
  for (const view of ["crew", "board"]) {
    const page = await pageAt(`views&dense&view=${view}`, 320);
    await page.getByTestId(view === "crew" ? "firstmate-task-list" : "firstmate-task-board").waitFor();
    await page.addStyleTag({ content: '[dir="auto"]{font-size:20px!important;line-height:28px!important}' });
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const decisions = page.getByRole("button", { name: /^Open decision:/ });
    for (const button of await decisions.all()) {
      const box = await button.boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= 320);
    }
    await page.screenshot({ path: join(generated, `views-scaled-${view}-320.png`) });
    await page.close();
  }
  for (const view of ["crew", "board"]) {
    const page = await pageAt(`views&remote&view=${view}`, 390);
    await page.getByRole("button", { name: "Machines: Light", exact: true }).waitFor();
    const surface = page.getByTestId(view === "crew" ? "firstmate-task-list" : "firstmate-task-board");
    await surface.waitFor();
    assert.equal(await page.evaluate(() => window.fixtureDocuments.display.hostTab), "sample-light");
    assert.equal(await surface.getByRole("button", { name: /^Open decision:/ }).count(), 3);
    assert.equal(await surface.getByRole("button", { name: /^Recover the failed validation run\./ }).count(), 0);
    assert.ok((await surface.getByRole("button", { name: /^Build the chapter-craft plan/ }).count()) > 0);
    await page.close();
  }
  const invalid = await pageAt("views&invalid&view=board", 320);
  await invalid
    .getByText("Task layout settings could not be read. Saved settings have not been changed.", { exact: true })
    .waitFor();
  assert.equal(await invalid.getByRole("button", { name: "Detailed columns", exact: true }).isDisabled(), true);
  assert.equal(await invalid.getByRole("button", { name: "Fold Needs you · 3", exact: true }).isDisabled(), true);
  assert.deepEqual(await invalid.evaluate(() => window.fixtureSettingSaves), []);
  assert.equal(await invalid.getByRole("button", { name: /^Open decision:/ }).count(), 3);
  await invalid.close();
  return evidence;
}
