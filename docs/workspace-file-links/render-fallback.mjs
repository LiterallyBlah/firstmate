/** Real chat → parser → inventory fixtures → dialog → installed public workspace bridge. */
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
  entryPoints: [resolve(here, "fallback-panel.jsx")], outfile: resolve(generated, "fallback.js"), bundle: true, jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning",
  plugins: [{ name: "real-surface-with-host-fixtures", setup(builder) {
    builder.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(here, "../board-list/contracts.js") }));
    builder.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, "fallback-stubs.jsx") }));
    builder.onResolve({ filter: /^react($|\/)/ }, args => ({ path: rootRequire.resolve(args.path) }));
    builder.onResolve({ filter: /^react-dom($|\/)/ }, args => ({ path: fixtureRequire.resolve(args.path) }));
    builder.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: fixtureRequire.resolve("react-native-web") }));
  } }],
});
const server = createServer(async (req, res) => {
  if (req.url === "/fallback.js") { res.setHeader("Content-Type", "application/javascript"); res.end(await readFile(resolve(generated, "fallback.js"))); }
  else { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}*{box-sizing:border-box}</style><div id="root"></div><script src="/fallback.js"></script>'); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const errors = [], results = [];
let browser, page;
try {
  browser = await chromium.launch({ ...(process.platform === "win32" ? { channel: "msedge" } : {}), headless: true });
  for (const [size, width, height] of [["wide", 1400, 980], ["phone", 390, 844]]) {
    for (const theme of ["dark", "light"]) {
      page = await browser.newPage({ viewport: { width, height } });
      page.setDefaultTimeout(10000);
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/?${theme}`);
      const dialog = page.getByRole("dialog", { name: "Workspace file link" });
      const close = async () => { await dialog.getByRole("button", { name: "Close", exact: true }).click(); await dialog.waitFor({ state: "hidden" }); };
      const click = async name => { await page.getByRole("link", { name, exact: true }).click(); await dialog.waitFor(); };
      await page.getByRole("link", { name: "Home backlog", exact: true }).waitFor();
      // The home answer was asked only about explicitly home-provenanced references.
      const finds = await page.evaluate(() => window.fallbackEvidence.finds);
      assert.ok(finds.every(input => input.paths.every(path => path === "data/backlog.md" || path === "data/missing.md")));
      for (const [label, serverId, workspaceId, path, line] of [
        ["Local report", "local-fixture", "local-workspace", "reports/quality report.md", "Lines 12–18"],
        ["Remote image", "remote-fixture", "remote-workspace", "reports/preview image.png", null],
        ["Unique Unix report", "local-fixture", "unix-workspace", "report.md", "Line 7"],
        ["Encoded filename", "local-fixture", "unix-workspace", "reports/a#b?%(c).md", "Line 3"],
      ]) {
        await click(label);
        await dialog.getByText(path, { exact: true }).waitFor();
        assert.ok((await dialog.innerText()).includes(`(${serverId})`));
        assert.ok((await dialog.innerText()).includes(`(${workspaceId})`));
        if (line) await dialog.getByText(line, { exact: true }).waitFor();
        await dialog.getByText(/This opens the workspace only/).waitFor();
        if (["Local report", "Remote image"].includes(label)) await page.screenshot({ path: resolve(here, `fallback-${label === "Local report" ? "local" : "remote"}-${size}-${theme}.png`) });
        await dialog.getByRole("button", { name: "Copy file location", exact: true }).click();
        await dialog.getByRole("button", { name: "Open workspace", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
        const calls = await page.evaluate(() => window.fallbackEvidence.workspaceNavigation);
        assert.deepEqual(calls.at(-1), { serverId, workspaceId });
      }
      const opened = await page.evaluate(() => window.fallbackEvidence.workspaceNavigation.length);
      for (const [name, message] of [
        ["Ambiguous absolute", /multiple hosts or nested workspaces/],
        ["Nested absolute", /multiple hosts or nested workspaces/],
        ["No provenance", /relative workspace file needs/],
        ["Missing workspace", /workspace is missing, archived/],
        ["Outside root", /outside the named workspace/],
        ["Missing home", /missing, outside the confined home/],
      ]) {
        await click(name);
        await dialog.getByText(message).waitFor();
        assert.equal(await dialog.getByRole("button", { name: "Open workspace", exact: true }).count(), 0);
        if (name === "Ambiguous absolute" && theme === "dark") await page.screenshot({ path: resolve(here, `fallback-ambiguous-${size}.png`) });
        await close();
      }
      await page.evaluate(() => window.linkHosts([{ serverId: "local-fixture", label: "Desktop", status: "online" }, { serverId: "remote-fixture", label: "Remote Windows", status: "offline" }]));
      await click("Remote image"); await dialog.getByText(/offline or disconnected/).waitFor(); await close();
      await page.evaluate(() => window.resetLinkHosts());
      // A workspace removed after the first lookup is refused at the Open button.
      await click("Remote image"); await dialog.getByText("reports/preview image.png", { exact: true }).waitFor();
      await page.evaluate(() => { window.savedRemoteRoots = window.linkRoots["remote-fixture"]; window.linkRoots["remote-fixture"] = []; });
      await dialog.getByRole("button", { name: "Open workspace", exact: true }).click();
      await dialog.getByText(/workspace is missing, archived/).waitFor(); await close();
      await page.evaluate(() => { window.linkRoots["remote-fixture"] = window.savedRemoteRoots; });
      // Closing the dialog cancels routing; a home reference uses only its own Files callback.
      await click("Local report"); await dialog.getByText("reports/quality report.md", { exact: true }).waitFor(); await close();
      assert.equal(await page.evaluate(() => window.fallbackEvidence.workspaceNavigation.length), opened);
      await page.getByRole("link", { name: "HTTPS docs", exact: true }).click();
      await page.waitForFunction(() => window.fallbackEvidence.external.length === 1);
      await page.getByRole("link", { name: "HTTPS home title", exact: true }).click();
      await page.waitForFunction(() => window.fallbackEvidence.external.length === 2);
      const observed = await page.evaluate(() => window.fallbackEvidence);
      assert.deepEqual(observed.external, ["https://paseo.sh/docs?id=2#part", "https://paseo.sh/docs?id=3#part"]);
      assert.equal(observed.toasts.filter(toast => toast.options?.durationMs === 15000).length, 4);
      assert.equal(observed.copies[0], "reports/quality report.md#L12-L18");
      assert.equal(observed.copies[1], "reports/preview image.png");
      await page.getByRole("link", { name: "Home backlog", exact: true }).click();
      // The real surface switches its right pane / phone tab to the home Files view.
      await page.waitForFunction(() => window.fixtureCalls.some(call => call.name === "firstmate.files.list"));
      results.push({ size, theme, ...observed, homeFilesOpened: true });
      await page.close();
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(here, "fallback-verification.json"), JSON.stringify({ evidenceKind: "real-FleetSurface-and-installed-public-navigation-with-API-fixtures", liveDaemon: false, fileBytesRead: false, nativeFilePaneOpened: false, supportedNavigationFields: ["serverId", "workspaceId"], bundle: runtime.bundle, bundleSha256: runtime.sha256, errors, results }, null, 2) + "\n");
  console.log("Workspace-only fallback: 4 theme/size runs; explicit local/remote, unique absolute, encoding/lines, refusal, revalidation, home and HTTPS checks passed.");
} catch (error) { await page?.screenshot({ path: resolve(generated, "fallback-failure.png") }); throw error; }
finally { await browser?.close(); await new Promise(done => server.close(done)); }
