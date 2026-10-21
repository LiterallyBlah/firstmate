/** Adapted from docs/workflows/render.mjs. Real Home, both themes/widths, isolated fixtures. */
import { createRequire } from "node:module";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../.."), local = createRequire(resolve(root, "docs/board-list/package.json")), repo = createRequire(resolve(root, "package.json"));
const { build } = local("esbuild"), { chromium } = local("playwright");
const out = resolve(root, ".local/plans-view"), baseline = "1685ff6";
await mkdir(out, { recursive: true });
for (const mode of ["before", "after"]) await build({ entryPoints: [resolve(here, "panel.jsx")], outfile: resolve(out, `${mode}.js`), bundle: true, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning", plugins: [{ name: "host-fixtures-and-baseline", setup(b) {
  b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(root, "docs/board-list/contracts.js") }));
  b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, "stubs.jsx") }));
  b.onResolve({ filter: /^react($|\/)/ }, a => ({ path: repo.resolve(a.path) }));
  b.onResolve({ filter: /^react-dom($|\/)/ }, a => ({ path: local.resolve(a.path) }));
  b.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: local.resolve("react-native-web") }));
  if (mode === "before") b.onLoad({ filter: /\.(ts|tsx)$/ }, a => {
    const path = relative(root, a.path).split(sep).join("/");
    if (!/^(client|shared)\//.test(path)) return;
    return { contents: execFileSync("git", ["show", `${baseline}:${path}`], { cwd: root, encoding: "utf8" }), loader: path.endsWith("tsx") ? "tsx" : "ts", resolveDir: dirname(a.path) };
  });
} }] });
const server = createServer(async (req, res) => {
  if (req.url === "/before.js" || req.url === "/after.js") { res.setHeader("Content-Type", "application/javascript"); res.end(await readFile(resolve(out, req.url.slice(1)))); }
  else { res.setHeader("Content-Type", "text/html"); res.end(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body,#root{margin:0;height:100%;overflow:hidden;font-family:system-ui}*{box-sizing:border-box}</style><div id="root" style="display:flex"></div><script src="/${req.url.startsWith('/before') ? 'before' : 'after'}.js"></script>`); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
console.log("Plans fixture bundles built; launching browser");
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--disable-gpu"], timeout: 20000 }), results = [];
console.log("Browser launched");
const origin = `http://127.0.0.1:${server.address().port}`;
async function selectPlans(page, width) {
  if (width >= 638 && width < 1000) await page.getByRole("button", { name: "List view", exact: true }).click();
  await page.getByRole("tab", { name: "Plans", exact: true }).click();
  await page.getByTestId("workflow-plans-view").waitFor();
}
try {
  for (const theme of ["light", "dark"]) for (const [device, width, height] of [["desktop", 1440, 1000], ["narrow", 900, 1000], ["phone", 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } }), errors = [];
    page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(15000);
    console.log(`Rendering ${theme} ${device}`);
    page.on("pageerror", e => { errors.push(e.message); console.error(e.message); });
    await page.goto(`${origin}/before?theme=${theme}`, { waitUntil: "domcontentloaded" });
    if (device === "phone") await page.getByRole("tab", { name: "List", exact: true }).click();
    await page.getByTestId("firstmate-task-list").waitFor({ state: "attached" });
    assert.equal(await page.getByRole("tab", { name: "Plans", exact: true }).count(), 0);
    await page.screenshot({ path: resolve(out, `${theme}-${device}-before.png`) });
    await page.goto(`${origin}/after?theme=${theme}`);
    await selectPlans(page, width);
    const view = page.getByTestId("workflow-plans-view");
    await view.getByRole("button", { name: "Open plan: Scheduler", exact: true }).waitFor();
    await page.mouse.move(1, 1);
    assert.equal(await page.evaluate(() => window.planActions.length), 0);
    const headings = await view.getByRole("heading").allTextContents();
    assert(headings.findIndex(t => t.startsWith("Open plans")) < headings.findIndex(t => t.startsWith("Recently finished")));
    assert.equal(await view.getByTestId("workflow-plan-automatic-00").count(), 0);
    await page.screenshot({ path: resolve(out, `${theme}-${device}-after.png`) });
    await view.getByRole("button", { name: "Automatic one-run plans (26)", exact: true }).click();
    assert.equal(await view.locator('[data-testid^="workflow-plan-automatic-"]').count(), 10);
    await view.getByRole("button", { name: "Show 10 more plans (16 remaining)", exact: true }).click();
    assert.equal(await view.locator('[data-testid^="workflow-plan-automatic-"]').count(), 20);
    await view.getByRole("textbox", { name: "Search plans" }).fill("Engineer automatic-25");
    await view.getByTestId("workflow-plan-automatic-25").waitFor();
    await page.screenshot({ path: resolve(out, `${theme}-${device}-search.png`) });
    await view.getByRole("textbox", { name: "Search plans" }).fill("");
    await view.getByRole("button", { name: "Open plan: Scheduler", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Scheduler", exact: true }); await dialog.waitFor();
    assert.equal(await page.evaluate(() => window.planActions.length), 0);
    await page.screenshot({ path: resolve(out, `${theme}-${device}-plan.png`) });
    await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => window.planActions.length), 0);
    await view.getByRole("button", { name: "Open plan: Scheduler", exact: true }).click(); await dialog.waitFor();
    await dialog.getByRole("button", { name: "Ask for changes", exact: true }).click();
    await dialog.getByRole("textbox", { name: "Requested plan changes" }).fill("Keep the trial read-only.");
    await dialog.getByRole("button", { name: "Send changes to first mate", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => window.planActions[0].command.action), "changes");
    await view.getByRole("button", { name: "Open plan: Scheduler", exact: true }).click(); await dialog.waitFor();
    await dialog.getByRole("button", { name: "Approve", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => window.planActions[1].command.action), "approve");
    // The choice is saved in the existing host display document.
    await page.waitForFunction(() => window.fixtureSettings?.homePane === "plans");
    assert.deepEqual(errors, []); results.push({ theme, device, grouping: true, paging: true, search: true, openWithoutAction: true, requestChanges: true, approve: true, savedPane: true, errors });
    await page.close();
  }
  for (const scenario of ["empty", "error", "partial"]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(15000);
    await page.goto(`${origin}/after?theme=dark&scenario=${scenario}`); await selectPlans(page, 1440);
    const view = page.getByTestId("workflow-plans-view");
    await view.getByText(scenario === "empty" ? /No plans yet/ : scenario === "error" ? /Plans could not be refreshed/ : /Some plans are unavailable/).waitFor();
    if (scenario === "error") { const before = await page.evaluate(() => window.planReads); await view.getByRole("button", { name: "Refresh plans", exact: true }).click(); await page.waitForFunction(n => window.planReads > n, before); }
    await page.screenshot({ path: resolve(out, `${scenario}.png`) }); results.push({ scenario, passed: true }); await page.close();
  }
  await writeFile(resolve(out, "checks.json"), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results));
} finally { await browser.close(); server.close(); }
