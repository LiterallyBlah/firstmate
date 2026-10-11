import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { installedRuntime } from "./installed-runtime.mjs";

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../..");
const rootRequire = createRequire(resolve(root, "package.json"));
const fixtureRequire = createRequire(resolve(here, "../board-list/package.json"));
const { build } = fixtureRequire("esbuild"), { chromium } = fixtureRequire("playwright");
const generated = resolve(here, ".generated");
await mkdir(generated, { recursive: true });
const runtime = await installedRuntime(process.argv[2] ?? "C:/Users/micha/AppData/Local/Programs/Paseo/resources/app-dist/_expo/static/js/web");
await writeFile(resolve(generated, "native-runtime.js"), runtime.moduleSource);
await build({
  entryPoints: [resolve(here, "panel.jsx")], outfile: resolve(generated, "panel.js"), bundle: true, jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning",
  plugins: [{ name: "isolated-renderer", setup(builder) {
    builder.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(here, "../board-list/contracts.js") }));
    builder.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, "../board-list/stubs.jsx") }));
    builder.onResolve({ filter: /^react($|\/)/ }, args => ({ path: rootRequire.resolve(args.path) }));
    builder.onResolve({ filter: /^react-dom($|\/)/ }, args => ({ path: fixtureRequire.resolve(args.path) }));
    builder.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: fixtureRequire.resolve("react-native-web") }));
  } }],
});
const server = createServer(async (req, res) => {
  if (req.url === "/panel.js") { res.setHeader("Content-Type", "application/javascript"); res.end(await readFile(resolve(generated, "panel.js"))); }
  else { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}*{box-sizing:border-box}</style><div id="root"></div><script src="/panel.js"></script>'); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const errors = [], results = [];
let browser;
try {
  browser = await chromium.launch({ ...(process.platform === "win32" ? { channel: "msedge" } : {}), headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const firstmate = page.locator("section").nth(0), native = page.locator("section").nth(1);
  for (const host of ["local-fixture", "remote-fixture"]) {
    await page.getByLabel("Conversation host").selectOption(host);
    await firstmate.getByRole("link", { name: "Workspace report", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "No workspace or file tab opened" }).waitFor();
    await page.screenshot({ path: resolve(here, `${host}-firstmate.png`) });
    await native.getByRole("link", { name: "Workspace report", exact: true }).click();
    await page.getByRole("status").filter({ hasText: `Native callback fixture: ${host}` }).waitFor();
    await page.screenshot({ path: resolve(here, `${host}-native-callback.png`) });
    for (const name of ["Workspace image", "Encoded report"]) {
      await firstmate.getByRole("link", { name, exact: true }).click();
      await page.getByRole("status").filter({ hasText: "No workspace or file tab opened" }).waitFor();
      await native.getByRole("link", { name, exact: true }).click();
      await page.getByRole("status").filter({ hasText: `Native callback fixture: ${host}` }).waitFor();
    }
    await page.getByRole("button", { name: "Probe supported workspace navigation" }).click();
    await page.getByRole("status").filter({ hasText: '"workspaceId":"workspace-fixture"' }).waitFor();
  }
  await firstmate.getByRole("link", { name: "Home backlog", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Home Files callback" }).waitFor();
  await firstmate.getByRole("link", { name: "HTTPS docs", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "External HTTP(S) opener" }).waitFor();
  const observed = await page.evaluate(() => window.linkEvidence);
  assert.deepEqual(observed.external, ["https://paseo.sh/docs"]);
  assert.deepEqual(observed.home, ["data/backlog.md"]);
  assert.equal(observed.observations.filter(item => !item.opened).length, 6);
  assert.deepEqual(observed.pluginNavigation, ["local-fixture", "remote-fixture"].map(serverId => ({ serverId, workspaceId: "workspace-fixture" })));
  assert.equal(observed.native.length, 6);
  for (const [index, target] of observed.native.entries()) {
    assert.equal(target.serverId, index < 3 ? "local-fixture" : "remote-fixture");
    assert.equal(target.target.path, ["C:/repo/reports/report.md", "C:/repo/reports/screen.png", "C:/repo/reports/report one.md"][index % 3]);
    assert.equal(target.target.lineStart, index % 3 === 1 ? undefined : 12);
  }
  assert.deepEqual(errors, []);
  results.push(observed);
  await writeFile(resolve(here, "verification.json"), JSON.stringify({ evidenceKind: "isolated-renderer-and-installed-callback-fixtures", liveDaemon: false, nativePaneRendered: false, publicFileRoutingAvailable: false, bundle: runtime.bundle, bundleSha256: runtime.sha256, modules: runtime.evidence, errors, results }, null, 2) + "\n");
  console.log("Reproduced: workspace file URLs ignored by FirstMate; installed native callback carries file targets; public workspace bridge drops targets (local and remote fixtures).");
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
