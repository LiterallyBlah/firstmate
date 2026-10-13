/** Synthetic host, actual components. No daemon connections or plugin operations. */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../..");
const req = createRequire(resolve(root, "package.json")), fixture = createRequire(resolve(here, "../board-list/package.json"));
const { build } = fixture("esbuild"), { chromium } = fixture("playwright");
await mkdir(resolve(here, ".generated"), { recursive: true });
await build({ entryPoints: [resolve(here, "panel.jsx")], outfile: resolve(here, ".generated/panel.js"), bundle: true, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, plugins: [{ name: "host", setup(b) {
  b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(here, "../board-list/contracts.js") }));
  b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, "stubs.jsx") }));
  b.onResolve({ filter: /^react($|\/)/ }, a => ({ path: req.resolve(a.path) }));
  b.onResolve({ filter: /^react-dom($|\/)/ }, a => ({ path: fixture.resolve(a.path) }));
  b.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: fixture.resolve("react-native-web") }));
} }], logLevel: "warning" });
const server = createServer(async (request, response) => {
  if (request.url === "/panel.js") { response.setHeader("Content-Type", "application/javascript"); response.end(await readFile(resolve(here, ".generated/panel.js"))); }
  else response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:Segoe UI,sans-serif}*{box-sizing:border-box}</style><div id="root"></div><script src="/panel.js"></script>');
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [], errors = [];
const fleetGuestLabel = "1: A guest conversation abo…";
try {
  for (const width of [1440, 390]) for (const theme of ["dark", "light"]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 1000 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?theme=${theme}`);
    await page.getByText(/other chats are open in the FirstMate home/).waitFor();
    const button = page.getByRole("button", { name: fleetGuestLabel, exact: true });
    await button.click();
    assert.equal(await page.evaluate(() => window.openedGuest), "guest-1");
    const overflow = await page.evaluate(() => document.body.scrollWidth > innerWidth);
    assert.equal(overflow, false);
    for (const guest of await page.getByRole("button", { name: /^[12]: / }).all()) {
      const box = await guest.boundingBox();
      assert(box.x >= 0 && box.x + box.width <= width, "Guest action must stay inside the viewport");
    }
    await page.screenshot({ path: resolve(here, `guests-${width}-${theme}.png`) });
    await page.goto(`http://127.0.0.1:${server.address().port}/?theme=${theme}&panel=guest`);
    await page.getByText(/This is a guest chat/).waitFor();
    await page.screenshot({ path: resolve(here, `identity-${width}-${theme}.png`) });
    results.push({ width, theme, opensCorrectGuest: true, overflow }); await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(here, "render-results.json"), JSON.stringify(results, null, 2) + "\n");
} finally { await browser.close(); await new Promise(done => server.close(done)); }
