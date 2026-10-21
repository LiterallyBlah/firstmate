/** Adapted from plans-view/render.mjs: actual registrations and views, synthetic host APIs. */
import { createRequire } from "node:module";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../.."), local = createRequire(resolve(root, "docs/board-list/package.json")), repo = createRequire(resolve(root, "package.json"));
const { build } = local("esbuild"), { chromium } = local("playwright");
const out = resolve(root, ".local/plans-panel"), baseline = "200e73e05da3293718d41db95298b07634403d28";
await mkdir(out, { recursive: true });
for (const mode of ["before", "after"]) await build({ entryPoints: [resolve(here, "panel.jsx")], outfile: resolve(out, `${mode}.js`), bundle: true, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning", plugins: [{ name: "host-fixtures-and-baseline", setup(b) {
  b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(root, "docs/board-list/contracts.js") }));
  b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(root, "docs/plans-view/stubs.jsx") }));
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
  else { res.setHeader("Content-Type", "text/html"); res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;height:100%;overflow:hidden;font-family:system-ui}*{box-sizing:border-box}</style><div id="root" style="display:flex"></div><script src="/${req.url.startsWith('/before') ? 'before' : 'after'}.js"></script>`); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--disable-gpu"] }), results = [];
const origin = `http://127.0.0.1:${server.address().port}`;
const titles = ["Finish the Starpath scheduler: slices 10 to 16", "Build the reader pass into chapter-making and roll it out"];
const errors = [];
async function pageAt(path, width = 1440, height = 1000) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.setDefaultTimeout(15000); page.on("pageerror", e => errors.push(e.message));
  await page.goto(origin + path); return page;
}
async function inlinePlans(page, width) {
  if (width >= 638 && width < 1000) await page.getByRole("button", { name: "List view", exact: true }).click();
  await page.getByRole("tab", { name: "Plans", exact: true }).click();
  await page.getByTestId("workflow-plans-view").waitFor();
}
async function shot(page, name) {
  await page.mouse.move(1, 1);
  await page.evaluate(() => document.activeElement?.blur());
  await page.screenshot({ path: resolve(out, `${name}.png`) });
}
try {
  for (const theme of ["light", "dark"]) for (const [device, width, height] of [["desktop", 1440, 1000], ["narrow", 900, 1000], ["phone", 390, 844]]) {
    console.log(`Rendering ${theme} ${device}`);
    const page = await pageAt(`/before?theme=${theme}`, width, height);
    await page.getByRole("button", { name: "New workspace tab", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "New tab: Plans", exact: true }).count(), 0);
    await shot(page, `${theme}-${device}-menu-before`);
    await page.getByRole("button", { name: "New workspace tab", exact: true }).click();
    await inlinePlans(page, width);
    await shot(page, `${theme}-${device}-header-before`);
    if (device === "narrow") {
      await page.getByRole("button", { name: "Plans view", exact: true }).click();
      await shot(page, `${theme}-${device}-header-menu-before`); await page.keyboard.press("Escape");
    }
    for (const [name, title] of [["starpath", titles[0]], ["reader-pass", titles[1]]]) {
      await page.getByRole("textbox", { name: "Search plans" }).fill(title);
      await page.getByRole("button", { name: `Open plan: ${title}`, exact: true }).waitFor();
      await shot(page, `${theme}-${device}-${name}-before`);
    }
    await page.goto(`${origin}/after?theme=${theme}&view=plans`);
    const view = page.getByTestId("workflow-plans-view"); await view.waitFor();
    assert.equal(await page.locator("#firstmate-chat-pane").count(), 0);
    assert.equal(await page.evaluate(() => window.fixtureCalls.filter(c => c.name === "firstmate.mate.seen").length), 0);
    assert.equal(await page.evaluate(() => window.navigationCalls.length), 0);
    assert.deepEqual(await page.evaluate(() => window.panelDescriptors.find(p => p.id === "firstmate-plans")), { id: "firstmate-plans", title: "Plans", icon: "ListTodo", context: "workspace", locations: ["workspace"] });
    assert.equal(await view.locator('[data-testid^="workflow-step-"]').count(), 0);
    await shot(page, `${theme}-${device}-summaries-after`);
    await page.getByRole("button", { name: "New workspace tab", exact: true }).click();
    await shot(page, `${theme}-${device}-menu-after`);
    await page.getByRole("button", { name: "New tab: Plans", exact: true }).click();
    for (const [name, title, count] of [["starpath", titles[0], 8], ["reader-pass", titles[1], 8]]) {
      await view.getByRole("textbox", { name: "Search plans" }).fill(title);
      await shot(page, `${theme}-${device}-${name}-after`);
      await view.getByRole("button", { name: `Expand plan: ${title}`, exact: true }).click();
      assert.equal(await view.locator('[data-testid^="workflow-step-"]').count(), count);
      assert.equal(await view.locator('[data-testid^="workflow-step-"][data-testid*="review-"]').count(), 0);
      assert.equal(await view.getByText(/unassigned/).count(), 0);
      await shot(page, `${theme}-${device}-${name}-expanded`);
      await view.getByRole("button", { name: `Open plan: ${title}`, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: title, exact: true }); await dialog.waitFor();
      await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
    }
    await view.getByRole("textbox", { name: "Search plans" }).fill("ariadne-reader-pass-s4");
    assert.equal(await view.getByTestId("workflow-plan-ariadne-reader-pass-s4").count(), 0);
    await page.getByRole("button", { name: "FirstMate Home", exact: true }).click(); await inlinePlans(page, width);
    await shot(page, `${theme}-${device}-header-after`);
    if (device === "narrow") await page.getByRole("button", { name: "Plans view", exact: true }).click();
    assert.deepEqual(await page.getByRole("tablist").filter({ has: page.getByRole("tab", { name: "List", exact: true }) }).getByRole("tab").allTextContents(), ["List", "Board", "Deck"]);
    assert.deepEqual(await page.getByRole("tablist").filter({ has: page.getByRole("tab", { name: "Plans", exact: true }) }).getByRole("tab").allTextContents(), [device === "phone" ? "Files" : "Home files", "Plans"]);
    if (device === "narrow") { await shot(page, `${theme}-${device}-header-menu-after`); await page.keyboard.press("Escape"); }
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.getByRole("button", { name: "Open Plans", exact: true }).click();
    await page.getByRole("button", { name: "FirstMate Home", exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.navigationCalls.at(-1)), { id: "firstmate-plans", workspaceId: "sample", location: "workspace" });
    assert.equal(await page.evaluate(() => window.planActions.length), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    results.push({ theme, device, registration: true, standalone: true, inline: true, groupedHeader: true, collapsed: true, groupedReviews: true, noDuplicates: true, noBrowseActions: true, noAttentionCleared: true });
    await page.close();
  }
  for (const query of ["workspace=other", "adopted=1"]) {
    const page = await pageAt(`/after?view=plans&${query}`);
    await page.getByText(query.startsWith("workspace") ? "This fleet view belongs to the FirstMate home workspace." : "Launch a first mate in its home to use this view.", { exact: true }).waitFor();
    if (query.startsWith("workspace")) { await page.getByRole("button", { name: "Open Plans in FirstMate", exact: true }).click(); await page.getByTestId("workflow-plans-view").waitFor(); }
    await shot(page, `guard-${query.split("=")[0]}`); await page.close(); results.push({ guard: query, passed: true });
  }
  for (const scenario of ["empty", "error", "partial"]) {
    const page = await pageAt(`/after?view=plans&scenario=${scenario}`), view = page.getByTestId("workflow-plans-view");
    await view.getByText(scenario === "empty" ? /No plans yet/ : scenario === "error" ? /Plans could not be refreshed/ : /Some plans are unavailable/).waitFor();
    if (scenario === "error") { const before = await page.evaluate(() => window.planReads); await view.getByRole("button", { name: "Refresh plans", exact: true }).click(); await page.waitForFunction(n => window.planReads > n, before); }
    await shot(page, scenario); await page.close(); results.push({ scenario, passed: true });
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(out, "checks.json"), JSON.stringify({ baseline, results, errors }, null, 2));
  console.log("Plans panel and compact browser checks passed", results.length);
} finally { await browser.close(); server.close(); }
