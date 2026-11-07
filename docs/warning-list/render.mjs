/** Real production projections and Home, before/after, with synthetic records and no daemon. */
import { createRequire } from "node:module";
import { dirname, resolve, relative, sep, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../.."), out = resolve(root, ".local/warning-list");
const local = createRequire(resolve(root, "docs/board-list/package.json")), repo = createRequire(resolve(root, "package.json"));
const { build } = local("esbuild"), { chromium } = local("playwright"), baseline = "dfc12c2";
await mkdir(out, { recursive: true });
const fixtures = {};
for (const mode of ["before", "after"]) {
  const baselinePlugin = { name: "baseline", setup(b) {
    if (mode === "before") b.onLoad({ filter: /\.(ts|tsx)$/ }, a => {
      const path = relative(root, a.path).split(sep).join("/");
      if (!/^(server|client|shared)\//.test(path)) return;
      return { contents: execFileSync("git", ["show", `${baseline}:${path}`], { cwd: root, encoding: "utf8" }), loader: path.endsWith("tsx") ? "tsx" : "ts", resolveDir: dirname(a.path) };
    });
  } };
  const fixtureScript = resolve(out, `${mode}-fixture.mjs`);
  // Bundling otherwise relocates templates.ts and makes it try CLI discovery. Bind its local
  // template lookup to this checkout so even the fixture's template read needs no daemon.
  await build({ entryPoints: [resolve(here, "fixture.ts")], outfile: fixtureScript, bundle: true, platform: "node", format: "esm", packages: "external", define: { "import.meta.url": JSON.stringify(pathToFileURL(resolve(root, "server/templates.ts")).href) }, logLevel: "warning", plugins: [baselinePlugin] });
  for (const scenario of ["historical", "current", "clean"]) {
    const temporary = await mkdtemp(join(tmpdir(), "firstmate-warning-preview-"));
    try { fixtures[`${mode}-${scenario}`] = JSON.parse(execFileSync(process.execPath, [fixtureScript, scenario], { cwd: root, env: { ...process.env, PASEO_HOME: temporary }, encoding: "utf8" })); }
    finally { assert(resolve(temporary).startsWith(resolve(tmpdir()) + sep)); await rm(temporary, { recursive: true, force: true }); }
  }
  await build({ entryPoints: [resolve(here, "panel.jsx")], outfile: resolve(out, `${mode}.js`), bundle: true, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning", plugins: [baselinePlugin, { name: "isolated-host", setup(b) {
    b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(root, "docs/board-list/contracts.js") }));
    b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, "stubs.jsx") }));
    b.onResolve({ filter: /^react($|\/)/ }, a => ({ path: repo.resolve(a.path) }));
    b.onResolve({ filter: /^react-dom($|\/)/ }, a => ({ path: local.resolve(a.path) }));
    b.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: local.resolve("react-native-web") }));
  } }] });
}
assert.equal(fixtures["before-historical"].fleet.warnings.length, 7);
assert.equal(fixtures["after-historical"].fleet.warnings.length, 0);
assert.equal(fixtures["after-current"].fleet.warnings.length, 6);
assert.equal(fixtures["after-clean"].fleet.warnings.length, 0);
assert(fixtures["after-historical"].workflow.ruleRefusals.every(r => r.historical));
assert.equal(fixtures["after-historical"].workflow.plans[0].nodes.build.priorAttempts[0].state, "failed");
assert.equal(fixtures["before-historical"].fleet.cards.length, fixtures["after-historical"].fleet.cards.length);
await writeFile(resolve(out, "projection-fixtures.json"), JSON.stringify(fixtures, null, 2));
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture");
  if (url.pathname.endsWith(".js")) { res.setHeader("Content-Type", "application/javascript"); res.end(await readFile(resolve(out, url.pathname.slice(1)))); return; }
  const mode = url.pathname.startsWith("/before") ? "before" : "after", scenario = url.searchParams.get("scenario") ?? "historical";
  res.setHeader("Content-Type", "text/html");
  res.end(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body,#root{margin:0;height:100%;overflow:hidden;font-family:system-ui}*{box-sizing:border-box}</style><div id="root" style="display:flex"></div><script>window.warningFixture=${JSON.stringify(fixtures[`${mode}-${scenario}`]).replaceAll("<", "\\u003c")}</script><script src="/${mode}.js"></script>`);
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--disable-gpu"] }), checks = [];
try {
  for (const theme of ["dark", "light"]) for (const [device, width, height] of [["desktop", 1440, 1000], ["phone", 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } }), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    for (const scenario of ["historical", "current", "clean"]) for (const mode of ["before", "after"]) {
      await page.goto(`http://127.0.0.1:${server.address().port}/${mode}?theme=${theme}&scenario=${scenario}`);
      if (device === "phone") await page.getByRole("tab", { name: "List", exact: true }).click();
      await page.getByTestId("firstmate-task-list").waitFor({ state: "attached" });
      for (const warning of fixtures[`${mode}-${scenario}`].fleet.warnings) assert.equal(await page.getByText(warning, { exact: true }).count(), 1);
      assert.equal(await page.getByRole("button", { name: "Compare", exact: true }).count(), 1, "Captain's charter banner is untouched");
      await page.screenshot({ path: resolve(out, `${theme}-${device}-${scenario}-${mode}.png`) });
      checks.push({ theme, device, scenario, mode, globalWarnings: fixtures[`${mode}-${scenario}`].fleet.warnings.length });
      if (mode === "after" && scenario === "historical") {
        await page.getByRole("button", { name: /Remote Supervisors slice-2-prior.*Show details and actions/ }).click();
        const retainedReport = page.getByText(fixtures[`${mode}-${scenario}`].fleet.cards.find(c => c.agent?.id === "slice-2-prior").reportWarning, { exact: true });
        await retainedReport.waitFor(); await retainedReport.scrollIntoViewIfNeeded();
        await page.screenshot({ path: resolve(out, `${theme}-${device}-retained-report.png`) });
        await page.getByRole("tab", { name: "Plans", exact: true }).click();
        await page.getByRole("button", { name: "Open plan: Remote Supervisors reporting fixture", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Remote Supervisors reporting fixture", exact: true });
        await dialog.getByRole("button", { name: "Show recorded rule refusals (3)", exact: true }).click();
        assert.equal(await dialog.getByText(/Historical refusal; later accepted progress/).count(), 3);
        await page.screenshot({ path: resolve(out, `${theme}-${device}-retained-refusals.png`) });
      }
    }
    assert.deepEqual(errors, []); await page.close();
  }
  await writeFile(resolve(out, "visual-checks.json"), JSON.stringify(checks, null, 2));
  console.log(`Verified ${checks.length} Home previews, plus retained card/plan evidence, with no browser errors.`);
} finally { await browser.close(); server.close(); }
