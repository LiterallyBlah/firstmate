import assert from "node:assert/strict";

/** Exercise the view's own decision entry and its return destination. */
export async function checkPanelReturn(page, view, press = target => target.click()) {
  const label = view === "crew" ? "List" : view === "deck" ? "Deck" : "Board";
  if (view === "deck") {
    // Startup adds the scene footer, moving this legend. Exercise the rendered Deck,
    // as the header checks do, before a press can straddle that layout change.
    await page.getByText(/^Drawn with /).waitFor();
    await press(page.getByTestId("firstmate-deck-decision-legend")
      .getByRole("button", { name: "Answer the next", exact: true }));
  } else {
    await press(page.getByRole("button", { name: /^Needs you, 3 items/ }));
  }
  const drawer = page.getByLabel("FirstMate decisions", { exact: true });
  await drawer.getByRole("button", { name: `Back to ${label}`, exact: true }).click();
  assert.equal(await drawer.count(), 0);
}
