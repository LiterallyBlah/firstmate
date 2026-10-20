/** Full FleetSurface/List/Needs-you fixture, using real server-produced plan counts and cards. */
import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile, mkdtemp } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../.."), out = resolve(root, ".local/workflows/integrated"), local = createRequire(resolve(here, "package.json")), repo = createRequire(resolve(root, "package.json"));
await mkdir(out, { recursive: true });
const scratch = await mkdtemp(resolve(out, "fixture-"));
Object.assign(process.env, { PASEO_HOME: scratch, FIRSTMATE_RECEIPT_JOURNAL: "0", FIRSTMATE_ATTENTION_OBSERVE: "0", FIRSTMATE_NEEDS_YOU: "0" });
await build({ entryPoints: [resolve(here, "workflows-source.ts")], outfile: resolve(out, "source.mjs"), bundle: true, platform: "node", format: "esm", packages: "external", plugins: [{ name: "source-template-location", setup(b) {
  b.onLoad({ filter: /server[\\/]templates\.ts$/ }, async a => ({ contents: (await readFile(a.path, "utf8")).replaceAll("import.meta.url", JSON.stringify(pathToFileURL(a.path).href)), loader: "ts", resolveDir: dirname(a.path) }));
} }] });
const { produce } = await import(pathToFileURL(resolve(out, "source.mjs")).href), fixture = await produce(resolve(scratch, "home"));
await writeFile(resolve(out, "fixture.json"), JSON.stringify(fixture));
await build({ entryPoints: [resolve(here, "workflows.jsx")], outfile: resolve(out, "panel.js"), bundle: true, format: "esm", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning", plugins: [{ name: "host-fixtures", setup(b) {
  b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(here, "contracts.js") }));
  b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, "workflows-stubs.jsx") }));
  b.onResolve({ filter: /^react($|\/)/ }, a => ({ path: repo.resolve(a.path) }));
  b.onResolve({ filter: /^react-dom($|\/)/ }, a => ({ path: local.resolve(a.path) }));
  b.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: local.resolve("react-native-web") }));
} }] });
const server = createServer(async (req, res) => {
  if (req.url === "/panel.js" || req.url === "/fixture.json") { res.setHeader("Content-Type", req.url.endsWith("json") ? "application/json" : "application/javascript"); res.end(await readFile(resolve(out, req.url.slice(1)))); }
  else { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;height:100%;font-family:system-ui}*{box-sizing:border-box}</style><div id="root"></div><script type="module" src="/panel.js"></script>'); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ channel: "msedge", headless: true }), results = [];
try {
  for (const theme of ["light", "dark"]) for (const [device, width, height] of [["desktop", 1440, 1000], ["phone", 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } }), errors = [];
    page.on("pageerror", e => errors.push(e.stack ?? e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?theme=${theme}`);
    try { await page.getByTestId("firstmate-task-list").waitFor(); }
    catch (error) { await page.screenshot({ path: resolve(out, "failure.png") }); console.log(JSON.stringify({ errors, text: await page.locator("body").innerText() })); throw error; }
    const now = await page.evaluate(() => window.integratedWorkflow.plans.now.length);
    assert.equal(fixture.needs.actionCount, now); assert.equal((await page.getByTestId("integrated-workflow-badge").innerText()).trim(), String(now));
    await page.getByRole("button", { name: /^Needs you,/ }).click();
    const decisions = page.getByLabel("FirstMate decisions", { exact: true });
    await decisions.getByTestId("workflow-now").waitFor(); await decisions.getByTestId("workflow-coming-up").waitFor();
    assert.equal(await decisions.getByTestId("workflow-now").getByRole("button").count(), now);
    await page.screenshot({ path: resolve(out, `${theme}-${device}-needs.png`) });
    await decisions.getByRole("button", { name: /^Back to / }).click();
    await page.getByRole("button", { name: "Plans", exact: true }).click(); await page.getByRole("button", { name: "Filter: Scheduler", exact: true }).click();
    const list = page.getByTestId("firstmate-task-list");
    const later = list.getByTestId("task-group-later");
    if (await later.count()) await later.getByRole("button").first().click();
    await list.getByText("Database trial", { exact: true }).waitFor();
    assert.equal(await list.getByText("Unrelated build", { exact: true }).count(), 0);
    await list.getByRole("button", { name: "Scheduler · 0 of 3 · awaiting approval", exact: true }).first().click();
    await page.getByRole("dialog", { name: "Scheduler", exact: true }).waitFor();
    await page.screenshot({ path: resolve(out, `${theme}-${device}-plan.png`) }); await page.keyboard.press("Escape");
    assert.deepEqual(errors, []); results.push({ theme, device, now, badge: fixture.needs.actionCount, errors }); await page.close();
  }
  await writeFile(resolve(out, "checks.json"), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results));
} finally { await browser.close(); server.close(); }
