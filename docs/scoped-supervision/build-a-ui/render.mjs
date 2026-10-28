/** Pure ownership view, synthetic host. Evidence stays in ignored .local/project-ownership/. */
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../../.."), local = createRequire(resolve(root, "docs/board-list/package.json")), repo = createRequire(resolve(root, "package.json"));
const { build } = local("esbuild"), { chromium } = local("playwright"), out = resolve(root, ".local/project-ownership");
await mkdir(out, { recursive: true });
await build({ entryPoints: [resolve(here, "panel.jsx")], outfile: resolve(out, "panel.js"), bundle: true, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning", plugins: [{ name: "host-fixtures", setup(b) {
  b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(root, "docs/board-list/contracts.js") }));
  b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, "stubs.jsx") }));
  b.onResolve({ filter: /^react($|\/)/ }, a => ({ path: repo.resolve(a.path) }));
  b.onResolve({ filter: /^react-dom($|\/)/ }, a => ({ path: local.resolve(a.path) }));
  b.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: local.resolve("react-native-web") }));
} }] });
const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", req.url.startsWith("/panel.js") ? "text/javascript" : "text/html");
  res.end(req.url.startsWith("/panel.js") ? await readFile(resolve(out, "panel.js")) : '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/panel.js"></script>');
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ channel: "msedge", headless: true }), results = [];
try {
  for (const theme of ["light", "dark"]) for (const [device, width, height] of [["desktop", 1440, 1000], ["phone", 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } }), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?theme=${theme}`);
    await page.getByRole("button", { name: "Project mates and plans", exact: true }).click();
    await page.getByText("Pending migration; project oversight only", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.projectActions.length), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: resolve(out, `${theme}-${device}-ownership.png`) });
    await page.getByRole("button", { name: "Read FirstMate memory (1 proposals)", exact: true }).click();
    await page.getByText("Use isolated homes and preserve uncertain effects.", { exact: true }).waitFor();
    await page.screenshot({ path: resolve(out, `${theme}-${device}-memory.png`) });
    assert.equal(await page.evaluate(() => window.projectActions.length), 0); assert.deepEqual(errors, []);
    await page.goto(`http://127.0.0.1:${server.address().port}/?theme=${theme}&mode=recovery`);
    await page.getByRole("button", { name: "Project mates and plans", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Recover project records", exact: true }).isEnabled(), true);
    assert.equal(await page.evaluate(() => window.projectActions.length), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: resolve(out, `${theme}-${device}-recovery.png`) });
    assert.deepEqual(errors, []);
    results.push({ theme, device, recoveryVisible: true, noOverflow: true, actionsOnRead: 0, errors }); await page.close();
  }
} finally { await browser.close(); await new Promise(done => server.close(done)); }
await writeFile(resolve(out, "results.json"), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results));
