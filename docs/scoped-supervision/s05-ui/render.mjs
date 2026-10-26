/** Actual S05 components; synthetic host RPCs only. All evidence stays in ignored .local/s05-ui. */
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../../.."), out = resolve(root, ".local/s05-ui");
const repo = createRequire(resolve(root, "package.json")), local = createRequire(resolve(root, "docs/board-list/package.json"));
const { build } = local("esbuild"), { chromium } = local("playwright");
await mkdir(out, { recursive: true });
await build({ entryPoints: [resolve(here, "panel.jsx")], outfile: resolve(out, "fixture.js"), bundle: true, jsx: "automatic", logLevel: "warning",
  define: { "process.env.NODE_ENV": '"development"' }, plugins: [{ name: "isolated-host", setup(b) {
    b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(root, "docs/board-list/contracts.js") }));
    b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, "stubs.jsx") }));
    b.onResolve({ filter: /^react($|\/)/ }, a => ({ path: repo.resolve(a.path) }));
    b.onResolve({ filter: /^react-dom($|\/)/ }, a => ({ path: local.resolve(a.path) }));
    b.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: local.resolve("react-native-web") }));
  } }] });
const server = createServer(async (req, res) => {
  if (req.url.startsWith("/fixture.js")) { res.setHeader("Content-Type", "application/javascript"); res.end(await readFile(resolve(out, "fixture.js"))); }
  else { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;font-family:system-ui}*{box-sizing:border-box}</style><div id="root"></div><script src="/fixture.js"></script>'); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ ...(process.platform === "win32" ? { channel: "msedge" } : {}), headless: true, args: ["--disable-gpu"], timeout: 20000 });
const origin = `http://127.0.0.1:${server.address().port}`, results = [];
async function choose(page, label) {
  await page.getByRole("button", { name: /^Discussion scope:/ }).click();
  await page.getByRole("dialog", { name: "Choose a discussion" }).getByRole("button", { name: new RegExp(`^${label},`) }).click();
}
try {
  for (const theme of ["light", "dark"]) for (const [device, width, height] of [["wide", 1440, 1000], ["phone", 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } }), errors = [];
    page.setDefaultTimeout(15000); page.on("pageerror", e => errors.push(e.message));
    await page.goto(`${origin}/?before&theme=${theme}`); await page.getByRole("textbox", { name: "Message the first mate" }).waitFor();
    await page.screenshot({ path: resolve(out, `${theme}-${device}-before.png`) });
    await page.goto(`${origin}/?theme=${theme}`); await page.getByTestId("scope-discussion").waitFor();
    const composer = page.getByRole("textbox", { name: "Message recipient" });
    await composer.fill("#reader Explain the next step");
    await page.getByText("To FirstMate · project context: reader", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.scopeActions.filter(a => /discuss|answer|activate|navigation/.test(a.name)).length), 0);
    await page.screenshot({ path: resolve(out, `${theme}-${device}-shared.png`) });
    await composer.fill("x".repeat(16001)); await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByText("The message or its address is outside the supported limits. Shorten it or refresh its scope.", { exact: true }).waitFor();
    assert.equal((await composer.inputValue()).length, 16001);
    assert.equal(await page.evaluate(() => window.scopeActions.filter(a => a.name === "firstmate.scope.discuss").length), 0);
    await composer.fill("@unknown Explain"); await page.getByText(/Unknown recipient @unknown/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Send", exact: true }).isDisabled(), true);
    await choose(page, "Reader project"); await composer.fill("Project draft");
    await choose(page, "Reader pass"); await composer.fill("Plan draft");
    await page.evaluate(() => window.remountScope()); await composer.waitFor(); assert.equal(await composer.inputValue(), "Plan draft");
    await choose(page, "Reader project"); assert.equal(await composer.inputValue(), "Project draft");
    await page.evaluate(() => { window.holdSend = true; }); await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByRole("button", { name: "Activating or sending…", exact: true }).waitFor();
    await choose(page, "Reader pass"); assert.equal(await composer.inputValue(), "Plan draft");
    await page.getByText("Sending to Reader project: Project draft", { exact: true }).waitFor();
    await page.evaluate(() => { window.releaseSend(); window.holdSend = false; });
    await page.waitForFunction(() => window.scopeActions.filter(a => a.name === "firstmate.scope.discuss").length === 1);
    const delivered = await page.evaluate(() => window.scopeActions.find(a => a.name === "firstmate.scope.discuss").input);
    assert.equal(delivered.route.target.scopeId, "00000000-0000-4000-8000-000000000201");
    assert.equal(delivered.text, "Project draft");
    await page.getByRole("button", { name: "Show stored status", exact: true }).click();
    await page.getByText(/0 tracked workers/).waitFor(); await page.getByText(/Review accepted; the outcome still needs a follow-up task/).waitFor();
    await page.screenshot({ path: resolve(out, `${theme}-${device}-status.png`) });
    await page.getByRole("button", { name: "Open Reader pass conversation", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.scopeActions.filter(a => a.name === "navigation.openAgent").at(-1).input), { agentId: "plan-session" });
    await page.evaluate(() => { window.refuseNext = true; }); await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByText("The captured binding changed. Preserve this draft and refresh.", { exact: true }).waitFor();
    assert.equal(await composer.inputValue(), "Plan draft");
    await choose(page, "New trial"); await composer.fill("Discuss the trial");
    await page.getByText("First Send creates a persistent discussion session. Reading does not.", { exact: true }).waitFor();
    await page.screenshot({ path: resolve(out, `${theme}-${device}-activation.png`) });
    await page.goto(`${origin}/?absent&theme=${theme}`); await page.getByTestId("scope-discussion").waitFor();
    await page.getByRole("button", { name: "Show stored status", exact: true }).click();
    await page.getByText(/Reader project · dormant/).waitFor();
    assert.equal(await page.evaluate(() => window.scopeActions.filter(a => /discuss|answer|activate|navigation/.test(a.name)).length), 0);
    await page.screenshot({ path: resolve(out, `${theme}-${device}-absent.png`) });
    await page.goto(`${origin}/?decisions&theme=${theme}`); await page.getByTestId("scoped-needs").waitFor();
    await page.getByRole("button", { name: /^Answer: Choose the follow-up/ }).last().click();
    await page.getByRole("button", { name: "Both layouts", exact: true }).click();
    await page.getByRole("textbox", { name: "Answer notes: Choose the follow-up" }).fill("Cover both within the current grant.");
    await page.screenshot({ path: resolve(out, `${theme}-${device}-decision.png`) });
    await page.evaluate(() => { window.holdRead = true; });
    await page.getByRole("button", { name: "Submit scoped answer", exact: true }).click();
    await page.getByText("Combined decision read unavailable", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Answer unconfirmed · original submission retained", exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.scopeActions.filter(a => a.name === "firstmate.scope.answer").length), 1);
    await page.evaluate(() => { window.holdRead = false; }); await page.getByRole("button", { name: "Refresh scoped decisions", exact: true }).click();
    await page.getByRole("button", { name: "Answer committed", exact: true }).waitFor();
    assert.deepEqual(errors, []); results.push({ theme, device, width, height, capturedScope: delivered.route.target.scopeId, resourceCallsOnRead: 0, scopedAnswers: 1, errors }); await page.close();
  }
  await writeFile(resolve(out, "results.json"), JSON.stringify({ passed: true, results }, null, 2));
  console.log(JSON.stringify({ passed: true, cases: results.length, output: out }));
} finally { await browser.close(); await new Promise(done => server.close(done)); }
