/** Plans-panel render harness, with real views and isolated synthetic host/data fixtures. */
import { createRequire } from "node:module";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../..");
const local = createRequire(resolve(root, "docs/board-list/package.json")), repo = createRequire(resolve(root, "package.json"));
const { build } = local("esbuild"), { chromium } = local("playwright");
const out = resolve(root, ".local/plans-graph"), baseline = "3afaacd33185c3eb9916d1077d497dec529c59df";
await mkdir(out, { recursive: true });
for (const mode of ["before", "after"]) await build({
  entryPoints: [resolve(root, "docs/plans-panel/panel.jsx")], outfile: resolve(out, `${mode}.js`), bundle: true, jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning", plugins: [{ name: "host-fixtures-and-baseline", setup(b) {
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
  } }],
});
const server = createServer(async (req, res) => {
  if (req.url === "/before.js" || req.url === "/after.js") { res.setHeader("Content-Type", "application/javascript"); res.end(await readFile(resolve(out, req.url.slice(1)))); }
  else { res.setHeader("Content-Type", "text/html"); res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;height:100%;overflow:hidden;font-family:system-ui}*{box-sizing:border-box}</style><div id="root" style="display:flex"></div><script src="/${req.url.startsWith('/before') ? 'before' : 'after'}.js"></script>`); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--disable-gpu"] });
const origin = `http://127.0.0.1:${server.address().port}`, results = [], errors = [];
async function shot(page, name) {
  await page.mouse.move(1, 1); await page.evaluate(() => document.activeElement?.blur());
  await page.screenshot({ path: resolve(out, `${name}.png`) });
}
try {
  for (const theme of ["light", "dark"]) for (const [device, width, height] of [["desktop", 1440, 1100], ["phone", 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } }); page.setDefaultTimeout(15000);
    page.on("pageerror", e => errors.push(e.message));
    for (const [name, title] of [["starpath", "Finish the Starpath scheduler: slices 10 to 16"], ["reader-pass", "Build the reader pass into chapter-making and roll it out"]]) {
      console.log(`Rendering ${theme} ${device} ${name}`);
      const prefix = `${theme}-${device}-${name}`;
      await page.goto(`${origin}/before?theme=${theme}&view=plans`);
      await page.getByRole("textbox", { name: "Search plans" }).fill(title);
      await page.getByRole("button", { name: `Expand plan: ${title}`, exact: true }).click();
      await shot(page, `${prefix}-before-list`);
      await page.goto(`${origin}/after?theme=${theme}&view=plans`);
      await page.getByRole("textbox", { name: "Search plans" }).fill(title);
      await page.getByRole("button", { name: `Expand plan: ${title}`, exact: true }).click();
      const graph = page.getByTestId(`workflow-graph-${name === "starpath" ? "starpath-scheduler" : "ariadne-reader-pass"}`); await graph.waitFor();
      const expected = await page.evaluate(title => window.workflowFixture.plans.find(p => p.definition.title === title).definition.nodes.length, title);
      assert.equal(await graph.locator('[data-testid^="workflow-node-"]').filter({ hasText: /Other plan/ }).count() > 0, true);
      assert.equal(await graph.locator('[data-testid^="workflow-node-"]').count() - await graph.locator('[data-testid^="workflow-node-"]').filter({ hasText: /Other plan/ }).count(), expected);
      assert(await graph.getByText(/can run in parallel/).count() > 0);
      for (const reason of ["builds-on", "needs-evidence", "decision", "shared-state"]) assert.equal(await graph.getByText(reason, { exact: true }).count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await shot(page, `${prefix}-after-graph`);
      if (device === "phone") {
        await graph.evaluate(e => e.scrollIntoView({ block: "start" }));
        await shot(page, `${prefix}-graph-scrolled`);
      }
      if (device === "desktop") {
        const canvas = await graph.locator('[data-testid^="workflow-graph-canvas-"]').boundingBox();
        await page.setViewportSize({ width: Math.ceil(canvas.width) + 60, height: Math.ceil(canvas.height) + 600 }); await shot(page, `${prefix}-full-graph`);
        await page.setViewportSize({ width, height });
      }
      const first = graph.locator('[data-testid^="workflow-node-"]').first();
      await first.focus(); await page.keyboard.press("Enter");
      const detail = page.getByRole("dialog"); await detail.waitFor();
      assert(await detail.getByText("Prerequisites", { exact: true }).count() > 0);
      await shot(page, `${prefix}-step-details`);
      await detail.getByRole("button", { name: "Open plan details", exact: true }).click();
      const planDialog = page.getByRole("dialog", { name: title, exact: true }); await planDialog.waitFor();
      assert.equal(await page.evaluate(() => window.planActions.length), 0);
      await page.keyboard.press("Escape"); await planDialog.waitFor({ state: "hidden" });
      await page.getByRole("tab", { name: "List", exact: true }).click();
      assert.equal(await page.locator('[data-testid^="workflow-step-"]').count(), 8);
      await shot(page, `${prefix}-after-list`);
      await page.getByRole("tab", { name: "Graph", exact: true }).click(); await graph.waitFor();
      assert.equal(await page.evaluate(() => window.planActions.length), 0);
      results.push({ theme, device, name, expected, allNodes: true, externalPrerequisites: true, parallelLevels: true, edgeReasons: true, keyboardStepDetails: true, existingPlanDialog: true, listToggle: true, noBrowseActions: true, noPageOverflow: true });
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(out, "checks.json"), JSON.stringify({ baseline, results, errors }, null, 2));
  console.log("Plans graph checks passed", results.length);
} finally { await browser.close(); server.close(); }
