/** Real plan components, synthetic host APIs. Writes evidence only below ignored .local/. */
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../.."), local = createRequire(resolve(root, "docs/board-list/package.json")), repo = createRequire(resolve(root, "package.json"));
const { build } = local("esbuild"), { chromium } = local("playwright");
const out = resolve(root, ".local/workflows"); await mkdir(out, { recursive: true });
await build({ entryPoints: [resolve(here, "panel.jsx")], outfile: resolve(out, "panel.js"), bundle: true, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning", plugins: [{ name: "host-fixtures", setup(b) {
  b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(root, "docs/board-list/contracts.js") }));
  b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, "stubs.jsx") }));
  b.onResolve({ filter: /^react($|\/)/ }, a => ({ path: repo.resolve(a.path) }));
  b.onResolve({ filter: /^react-dom($|\/)/ }, a => ({ path: local.resolve(a.path) }));
  b.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: local.resolve("react-native-web") }));
} }] });
const server = createServer(async (req, res) => {
  if (req.url === "/panel.js") { res.setHeader("Content-Type", "application/javascript"); res.end(await readFile(resolve(out, "panel.js"))); }
  else { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body,#root{margin:0;height:100%;font-family:system-ui}*{box-sizing:border-box}</style><div id="root"></div><script src="/panel.js"></script>'); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ channel: "msedge", headless: true }), results = [];
try {
  for (const theme of ["light", "dark"]) for (const [device, width, height] of [["desktop", 1440, 1000], ["phone", 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } }), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?theme=${theme}`);
    await page.getByRole("button", { name: "Scheduler · 0 of 3 · awaiting approval", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.workflowActions.length), 0);
    await page.screenshot({ path: resolve(out, `${theme}-${device}-coming-up.png`) });
    assert.equal(await page.getByTestId("workflow-coming-up").count(), 1);
    await page.getByRole("button", { name: "Plans", exact: true }).click();
    await page.getByRole("button", { name: "Filter: Scheduler", exact: true }).click();
    await page.getByText("Current filter: scheduler", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Scheduler · 0 of 3 · awaiting approval", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Scheduler", exact: true }); await dialog.waitFor();
    assert.equal(await page.evaluate(() => window.workflowActions.length), 0);
    await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => window.workflowActions.length), 0);
    await page.getByRole("button", { name: "Scheduler · 0 of 3 · awaiting approval", exact: true }).click(); await dialog.waitFor();
    await page.screenshot({ path: resolve(out, `${theme}-${device}-plan.png`) });
    await dialog.getByRole("button", { name: "Ask for changes", exact: true }).scrollIntoViewIfNeeded();
    await dialog.getByRole("button", { name: "Ask for changes", exact: true }).click();
    await page.getByRole("textbox", { name: "Requested plan changes" }).fill("Keep the trial read-only.");
    await dialog.getByRole("button", { name: "Send changes to first mate", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => window.workflowActions[0].command.action), "changes");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []); results.push({ theme, device, width, height, errors }); await page.close();
  }
  await writeFile(resolve(out, "checks.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); server.close(); }
