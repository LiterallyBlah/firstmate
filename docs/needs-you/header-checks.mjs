import assert from "node:assert/strict";
import { join } from "node:path";

/** Real view headers: Deck has no pill; every other view keeps both signal states. */
export async function checkHeaders(pageAt, output) {
  const results = [];
  const headerBox = heading => heading.locator("..").evaluate(row => {
    const box = row.getBoundingClientRect(), header = row.parentElement.getBoundingClientRect();
    return { x: box.x - header.x, y: box.y - header.y, width: box.width, height: box.height };
  });
  for (const view of ["deck", "home", "board", "crew", "chat"])
    for (const width of [390, 1440])
      for (const light of [false, true]) {
        const page = await pageAt(`sidebar${view === "home" ? "" : `&view=${view}`}${light ? "&light" : ""}`, width);
        const sidebar = page.getByRole("button", { name: "FirstMate sidebar", exact: true });
        await sidebar.getByText("3", { exact: true }).waitFor();
        await page.evaluate(() => document.fonts.ready);
        const pill = page.locator('[id^="needs-you-"]');
        const heading = page.getByRole("heading", { name: "Deck", exact: true });
        let deckBox;
        if (view === "deck") {
          await page.locator("canvas[data-firstmate-deck-setting=ship]").waitFor();
          deckBox = await headerBox(heading);
        }
        await page.evaluate(() => { window.headerSnapshot = structuredClone(window.attentionSnapshot); });
        for (const state of ["nonempty", "empty", "restored"]) {
          if (state !== "nonempty") {
            await page.evaluate(async state => {
              const version = window.attentionSnapshot.version + 1;
              window.attentionSnapshot = structuredClone(window.headerSnapshot);
              const s = window.attentionSnapshot;
              s.version = version;
              s.freshness.checkedAt = Date.now();
              if (state === "empty") {
                s.requests = [];
                s.actionCount = s.newCount = s.pendingAnswerCount = s.snoozedCount = 0;
              }
              await window.refreshDecisions();
            }, state);
            await page.waitForFunction(state => {
              const badge = document.querySelector('[aria-label="FirstMate sidebar"] [aria-label^="Needs you,"]');
              return state === "empty" ? !badge : badge?.textContent === "3";
            }, state);
          }
          if (view === "deck") {
            assert.equal(await pill.count(), 0, `Deck ${state} has no header pill`);
            assert.deepEqual(await headerBox(heading), deckBox, "Deck header stays fixed as decisions change");
            assert.equal(await page.evaluate(() => window.decisionSurfaceVisible()), true, "visible Deck still suppresses duplicate toasts");
            assert.equal(await page.evaluate(() => {
              const root = document.getElementById("root");
              root.style.display = "none";
              try { return window.decisionSurfaceVisible(); }
              finally { root.style.display = ""; }
            }), false, "a retained hidden Deck does not suppress toasts");
            const legend = page.getByTestId("firstmate-deck-decision-legend");
            await legend.getByText(state === "empty" ? "Nothing needs you ·" : "3 need you ·", { exact: true }).waitFor();
          } else {
            assert.equal(await pill.count(), 1, `${view} keeps its header pill`);
            await pill.getByText(state === "empty" ? "Nothing needs you" : "Needs you · 3 · 2 new", { exact: true }).waitFor();
          }
          if (state !== "restored") {
            await page.screenshot({ path: join(output, `header-${view}-${state}-${width}-${light ? "light" : "dark"}.png`) });
            results.push({ view, state, width, theme: light ? "light" : "dark" });
          }
          if (view === "deck" && state !== "restored") {
            await page.getByTestId("firstmate-deck-decision-legend")
              .getByRole("button", { name: state === "empty" ? "Open decisions" : "Answer the next", exact: true }).click();
            const drawer = page.getByLabel("FirstMate decisions", { exact: true });
            await drawer.waitFor();
            await drawer.getByRole("button", { name: "Back to Deck", exact: true }).click();
          }
        }
        await page.close();
      }
  return results;
}
