/** Opt-in native-web capture against real registered handlers; no live daemon or native effects. */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
export async function capturePlanHelp(call: (name: string, input?: any) => Promise<any>, prepare?: () => Promise<void>) {
  const out = resolve(".local/smooth-pr9/production"); await mkdir(out, { recursive: true });
  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/rpc") {
        let body = ""; for await (const part of req) body += part;
        const { name, input } = JSON.parse(body); res.setHeader("Content-Type", "application/json");
        try { res.end(JSON.stringify({ ok: true, value: await call(name, input) })); }
        catch (error: any) { res.end(JSON.stringify({ ok: false, error: { message: error.message, code: error.code } })); }
      } else if (req.url?.endsWith(".js")) { res.setHeader("Content-Type", "application/javascript"); res.end(await readFile(join(out, req.url.includes("before") ? "before.js" : "after.js"))); }
      else {
        const stage = req.url?.includes("before") ? "before" : "after";
        res.setHeader("Content-Type", "text/html"); res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;font-family:system-ui}#root{display:flex;flex-direction:column}*{box-sizing:border-box}button,input,select{font:inherit}button{min-height:44px;min-width:44px}:focus-visible{outline:2px solid currentColor;outline-offset:2px}</style><div id="root"></div><script src="/${stage}.js"></script>`);
      }
    } catch (e: any) { res.statusCode = 500; res.end(e.message); }
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const local = createRequire(resolve("docs/board-list/package.json")), browser = await local("playwright").chromium.launch({ ...(process.platform === "win32" ? { channel: "msedge" } : {}), headless: true, args: ["--disable-gpu"] });
  const results = [];
  try {
    for (const theme of ["light", "dark"]) for (const [device, width, height] of [["desktop", 1440, 1000], ["phone", 390, 844]] as const) for (const stage of ["before", "after"]) {
      const page = await browser.newPage({ viewport: { width, height } }), errors: string[] = [];
      page.on("pageerror", (e: any) => errors.push(e.message)); page.setDefaultTimeout(10000);
      await page.goto(`http://127.0.0.1:${(server.address() as any).port}/?theme=${theme}&stage=${stage}`, { waitUntil: "networkidle" });
      const entry = page.getByTestId("workflow-plan-scheduler").getByRole("button", { name: "Review plan help", exact: true });
      await entry.click();
      if (stage === "before") await page.getByText("This review couldn't be checked. Your saved work is kept. Refresh to try again.", { exact: true }).waitFor();
      else await page.getByText(/^Current owner:/).waitFor();
      await page.screenshot({ path: join(out, `${theme}-${device}-review-${stage}.png`) });
      if (stage === "before") { await page.getByRole("button", { name: "Handover evidence", exact: true }).click(); await page.getByLabel("Compatible rollback build", { exact: true }).scrollIntoViewIfNeeded(); }
      else {
        await page.getByRole("button", { name: "Check handover evidence", exact: true }).click();
        await page.getByText("2 saved items checked before handover.", { exact: true }).waitFor();
        const ordinary = await page.locator("body").innerText();
        assert.match(ordinary, /Wait for FirstMate to confirm that “Database trial” has finished/);
        assert.match(ordinary, /Your saved plan choice for “Scheduler”/);
        assert.doesNotMatch(ordinary, /plan-action|worker-callback|scoped owner|quiescent|native callback|[0-9a-f]{8}-[0-9a-f]{4}-/i);
        await page.getByText("Pending deliveries", { exact: true }).evaluate((el: any) => el.scrollIntoView({ block: "start" }));
        await page.screenshot({ path: join(out, `${theme}-${device}-ordinary-after.png`) });
        const beforeDisclosure = await page.evaluate(() => (globalThis as any).review.calls.length);
        await page.getByRole("button", { name: "Technical details", exact: true }).click();
        const technical = await page.locator("body").innerText();
        assert.match(technical, /plan-action/); assert.match(technical, /worker-callback/);
        assert.match(technical, /scoped owner/); assert.match(technical, /quiescent/);
        assert.match(technical, /[0-9a-f]{8}-[0-9a-f]{4}-/i);
        await page.getByRole("button", { name: "Hide technical details", exact: true }).evaluate((el: any) => el.scrollIntoView({ block: "start" }));
        await page.screenshot({ path: join(out, `${theme}-${device}-technical-after.png`) });
        await page.getByRole("button", { name: "Hide technical details", exact: true }).click();
        assert.equal(await page.evaluate(() => (globalThis as any).review.calls.length), beforeDisclosure);
        assert.doesNotMatch(await page.locator("body").innerText(), /worker-callback|scoped owner|quiescent|[0-9a-f]{8}-[0-9a-f]{4}-/i);
        await page.getByRole("button", { name: "I reviewed pending deliveries", exact: true }).click();
        await page.getByRole("button", { name: "I reviewed accepted permissions", exact: true }).click();
        await page.getByRole("button", { name: "Read rollback.md", exact: true }).click();
        await page.getByRole("button", { name: "Use this rollback report", exact: true }).click();
        await page.getByRole("button", { name: "Use reviewed evidence", exact: true }).scrollIntoViewIfNeeded();
      }
      await page.screenshot({ path: join(out, `${theme}-${device}-evidence-${stage}.png`) });
      if (stage === "after") {
        await page.getByRole("button", { name: "Use reviewed evidence", exact: true }).click();
        assert.equal(await page.getByRole("button", { name: "Review handover", exact: true }).isDisabled(), false);
        await page.getByRole("button", { name: "Review handover", exact: true }).click();
        await page.getByRole("button", { name: "Keep current owner", exact: true }).click();
        await page.keyboard.press("Escape"); assert.equal(await entry.evaluate((el: any) => el === (globalThis as any).document.activeElement), true);
      }
      const state = await page.evaluate(() => { const browser = globalThis as any; return { text: browser.document.body.innerText, calls: browser.review.calls, overflow: browser.document.documentElement.scrollWidth > browser.innerWidth }; });
      assert.equal(state.overflow, false); assert.deepEqual(errors, []);
      assert.equal(state.calls.some((c: any) => /\.(set|migrate|attach-ui)$/.test(c.name)), false);
      if (stage === "after") assert.equal(state.calls.some((c: any) => !c.result.ok), false);
      results.push({ theme, device, stage, ...state }); await page.close();
    }
    if (prepare) {
      await prepare(); // Explicit test action through the existing production migration handler.
      for (const theme of ["light", "dark"]) for (const [device, width, height] of [["desktop", 1440, 1000], ["phone", 390, 844]] as const) {
        const page = await browser.newPage({ viewport: { width, height } });
        await page.goto(`http://127.0.0.1:${(server.address() as any).port}/?theme=${theme}&stage=after`, { waitUntil: "networkidle" });
        // A prepared imported plan remains in Plans; a freeze before its receipt uses Continue handover.
        const retained = page.getByRole("button", { name: "Continue handover: Scheduler", exact: true });
        if (await retained.count()) await retained.click();
        else await page.getByTestId("workflow-plan-scheduler").getByRole("button", { name: "Review plan help", exact: true }).click();
        await page.getByText("Handover is saved. Check pending deliveries before changing ownership.", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Check handover deliveries", exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(out, `${theme}-${device}-retained-handover.png`) });
        const calls = await page.evaluate(() => (globalThis as any).review.calls);
        assert.equal(calls.some((c: any) => !c.result.ok || /\.(set|migrate|attach-ui)$/.test(c.name)), false);
        results.push({ theme, device, stage: "retained-handover", calls }); await page.close();
      }
    }
    await writeFile(join(out, "results.json"), JSON.stringify(results, null, 2));
  } finally { await browser.close(); await new Promise<void>(done => server.close(() => done())); }
}
