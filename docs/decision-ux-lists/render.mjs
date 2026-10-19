/** Synthetic host, shipped views. No installation or live daemon. */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, "../.."), here = import.meta.dirname;
const harness = createRequire(join(root, "docs/board-list/package.json")), local = createRequire(join(root, "package.json"));
const { build } = harness("esbuild"), { chromium } = harness("playwright");
const output = join(root, ".local/decision-ux-lists");
await mkdir(output, { recursive: true });
for (const [id, entry] of [["views", "docs/needs-you/panel.jsx"], ["context", "docs/decision-ux-lists/context.jsx"]]) {
  await build({ entryPoints: [join(root, entry)], outfile: join(output, `${id}.js`), bundle: true, jsx: "automatic", logLevel: "warning",
    define: { "process.env.NODE_ENV": '"development"' }, plugins: [{ name: "fixture", setup(b) {
      b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: join(root, "docs/board-list/contracts.js") }));
      b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: join(here, "stubs.jsx") }));
      b.onResolve({ filter: /^(react|zod|@tanstack\/react-query)($|\/)/ }, a => ({ path: local.resolve(a.path) }));
      b.onResolve({ filter: /^react-dom($|\/)/ }, a => ({ path: harness.resolve(a.path) }));
      b.onResolve({ filter: /^react-native(-web)?$/ }, () => ({ path: harness.resolve("react-native-web") }));
    } }] });
}
const server = createServer(async (req, res) => {
  if (req.url === "/views.js" || req.url === "/context.js") { res.setHeader("Content-Type", "text/javascript"); res.end(await readFile(join(output, req.url.slice(1)))); }
  else res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:Segoe UI,sans-serif;background:#151915}#root{display:flex;flex-direction:column}*{box-sizing:border-box}</style><div id="root"></div><script src="/${req.url.includes("context") ? "context" : "views"}.js"></script>`);
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
const errors = [], results = [], base = `http://127.0.0.1:${server.address().port}`;
try {
  for (const view of ["crew", "board"]) for (const width of [1440, 390, 320]) for (const light of [false, true]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
    page.on("pageerror", e => errors.push(String(e)));
    await page.goto(`${base}/?views&six&view=${view}${light ? "&light" : ""}`);
    await page.locator('[id^="decision-task-"]').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('[id^="decision-task-"]').count(), 6);
    const height = view === "crew" ? (await page.getByTestId("task-group-needs-you").boundingBox()).height : null;
    if (width === 1440 && height !== null) assert.ok(height <= 350, `six decisions occupy ${height}px`);
    for (const button of await page.locator('[id^="decision-task-"]').all()) {
      const box = await button.boundingBox();
      assert.ok(box.width >= 44 && box.height >= (width < 638 ? 44 : 28));
      assert.ok(box.x >= 0 && box.x + box.width <= width);
    }
    await page.screenshot({ path: join(output, `${view}-${width}-${light ? "light" : "dark"}.png`) });
    results.push({ view, width, light, decisionGroupHeight: height });
    await page.close();
  }
  for (const width of [620, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 700 } });
    page.on("pageerror", e => errors.push(String(e)));
    await page.goto(`${base}/?context`);
    await page.getByRole("link", { name: "Read the whole draft", exact: true }).waitFor();
    await page.getByText("Thanks for reviewing the proposal.", { exact: false }).waitFor();
    assert.equal(await page.getByText("This fifth line must stay out", { exact: false }).count(), 0);
    await page.getByRole("link", { name: "data/review/spec.md", exact: true }).click();
    assert.equal(await page.evaluate(() => window.openedFile), "data/review/spec.md");
    await page.getByRole("link", { name: "Read the whole draft", exact: true }).click();
    assert.equal(await page.evaluate(() => window.openedFile), "data/review/draft-reply.md");
    assert.equal(await page.getByRole("button", { name: "Discussion #42", exact: true }).count(), 1);
    await page.screenshot({ path: join(output, `context-${width}.png`) });
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(join(output, "results.json"), JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ output, layouts: results.length, context: 2, errors }));
} finally { await browser.close(); await new Promise(done => server.close(done)); }
