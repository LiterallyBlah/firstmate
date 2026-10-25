import assert from "node:assert/strict";
import { checkPanelReturn } from "./panel-return-check.mjs";

/** Delayed real graphics RPC, with a settled Deck as the positive control. */
export async function checkDeckStartup(pageAt) {
  const results = [];
  for (const delayed of [true, false]) {
    let release, timer;
    const gate = new Promise(resolve => { release = resolve; });
    const page = await pageAt("view=deck", 1440, async page => {
      await page.route("**/rpc/firstmate.deck.engine", async route => {
        // Inject fixture latency, bounded by the unchanged 10s action limit.
        timer = setTimeout(release, 1200);
        await gate;
        await route.continue();
      });
      await page.exposeFunction("releaseStartupEngine", release);
      await page.addInitScript(() => {
        window.startupPresses = [];
        document.addEventListener("pointerdown", event => {
          if (!event.target.closest('[data-testid="firstmate-deck-decision-legend"]')) return;
          window.startupPresses.push({ drawing: document.body.innerText.includes("Drawn with WebGL"), y: event.clientY });
          window.releaseStartupEngine();
        }, true);
      });
    });
    try {
      if (!delayed) {
        release();
        await page.getByText("Drawn with WebGL", { exact: false }).waitFor();
      }
      // A held mouse press makes a startup layout change deterministic on the old path.
      // This is an input fixture; the ordinary polish check uses a normal click.
      await checkPanelReturn(page, "deck", target => target.click({ delay: 1500 }));
      const presses = await page.evaluate(() => window.startupPresses);
      assert.equal(presses.length, 1);
      assert.equal(presses[0].drawing, true, "the rendered-Deck check must wait for graphics before pressing its moving legend");
      results.push({ delayed, presses, passed: true });
    } finally {
      clearTimeout(timer);
      release();
      await page.close();
    }
  }
  return results;
}
