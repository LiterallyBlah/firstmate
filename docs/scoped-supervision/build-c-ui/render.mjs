/** Actual drawer/filter/shared decision components. Fixtures only; writes .local/build-c/ui. */
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../../.."), out = resolve(root, ".local/build-c/ui");
const repo = createRequire(resolve(root, "package.json")), local = createRequire(resolve(root, "docs/board-list/package.json"));
const { build } = local("esbuild"), { chromium } = local("playwright");
await mkdir(out, { recursive: true });
await build({ entryPoints: [resolve(here, "panel.jsx")], outfile: resolve(out, "panel.js"), bundle: true, jsx: "automatic", logLevel: "warning", define: { "process.env.NODE_ENV": '"development"' }, plugins: [{ name: "fixture-host", setup(b) {
  b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(root, "docs/board-list/contracts.js") }));
  b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, "../s05-ui/stubs.jsx") }));
  b.onResolve({ filter: /^react($|\/)/ }, a => ({ path: repo.resolve(a.path) }));
  b.onResolve({ filter: /^react-dom($|\/)/ }, a => ({ path: local.resolve(a.path) }));
  b.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: local.resolve("react-native-web") }));
} }] });
const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", req.url.startsWith("/panel.js") ? "text/javascript" : "text/html");
  res.end(req.url.startsWith("/panel.js") ? await readFile(resolve(out, "panel.js")) : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;font-family:system-ui}#root{display:flex;flex-direction:column}*{box-sizing:border-box}</style><div id="root"></div><script src="/panel.js"></script>');
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ ...(process.platform === "win32" ? { channel: "msedge" } : {}), headless: true, args: ["--disable-gpu"] });
const origin = `http://127.0.0.1:${server.address().port}`, results = [];
try {
  for (const theme of ["light", "dark"]) for (const [device, width, height] of [["desktop", 1440, 1000], ["phone", 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } }), errors = [];
    page.on("pageerror", error => errors.push(error.message)); page.setDefaultTimeout(10000);
    await page.goto(`${origin}/?theme=${theme}`); await page.getByTestId("scope-inbox-filters").waitFor();
    await page.getByText("Global Needs you: 2.", { exact: false }).waitFor();
    const choose = async label => {
      await page.getByRole("button", { name: /^Inbox scope:/ }).click();
      await page.getByRole("dialog", { name: "Filter Needs you" }).getByRole("button", { name: new RegExp(`^${label}(,|$)`) }).click();
    };
    for (const label of ["General", "Project", "Plan", "Maintenance", "Project: Reader project", "All scopes"]) {
      await choose(label);
      assert.equal(await page.getByText("Global Needs you: 2.", { exact: false }).count(), 1);
      await page.getByText("Unidentified task scope requires reconciliation.", { exact: true }).waitFor();
      const visible = await page.getByTestId("scoped-needs").count();
      assert.equal(visible, ["General", "Maintenance"].includes(label) ? 0 : 1);
      assert.equal(await page.evaluate(() => window.scopeActions.filter(a => /discuss|answer|activate/.test(a.name)).length), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: resolve(out, `${theme}-${device}-${label.replace(/[^a-z]+/gi, "-")}.png`) });
    }
    await page.goto(`${origin}/?origins&theme=${theme}`); await page.getByTestId("scoped-captain-decision").first().waitFor();
    assert.equal(await page.getByTestId("scoped-captain-decision").count(), 2);
    assert.equal(await page.getByRole("button", { name: "Keep the current bound", exact: true }).first().isDisabled(), true);
    await page.screenshot({ path: resolve(out, `${theme}-${device}-origins.png`) });
    assert.deepEqual(errors, []); results.push({ theme, device, filters: 6, resourcesOnRead: 0, errors }); await page.close();
  }
  await writeFile(resolve(out, "results.json"), JSON.stringify({ passed: true, results }, null, 2)); console.log(JSON.stringify({ passed: true, cases: results.length, out }));
} finally { await browser.close(); await new Promise(done => server.close(done)); }
