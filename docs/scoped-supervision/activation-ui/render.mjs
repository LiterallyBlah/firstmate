/** Actual attach UI in both themes and widths, with inert RPC fixtures. Writes only ignored .local/. */
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../../.."), out = resolve(root, ".local/activation-ui");
const repo = createRequire(resolve(root, "package.json")), local = createRequire(resolve(root, "docs/board-list/package.json"));
const { build } = local("esbuild"), { chromium } = local("playwright");
await mkdir(out, { recursive: true });
await build({ entryPoints: [resolve(here, "panel.jsx")], outfile: resolve(out, "fixture.js"), bundle: true, jsx: "automatic", logLevel: "warning",
  define: { "process.env.NODE_ENV": '"development"' }, plugins: [{ name: "isolated-host", setup(b) {
    b.onResolve({ filter: /workflow-plans$/ }, a => a.importer.replaceAll("\\", "/").endsWith("/client/supervision-activation.tsx") ? { path: resolve(here, "workflow.jsx") } : undefined);
    b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(root, "docs/board-list/contracts.js") }));
    b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, "stubs.jsx") }));
    b.onResolve({ filter: /^react($|\/)/ }, a => ({ path: repo.resolve(a.path) }));
    b.onResolve({ filter: /^react-dom($|\/)/ }, a => ({ path: local.resolve(a.path) }));
    b.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: local.resolve("react-native-web") }));
  } }] });
const server = createServer(async (req, res) => {
  if (req.url.startsWith("/fixture.js")) { res.setHeader("Content-Type", "application/javascript"); res.end(await readFile(resolve(out, "fixture.js"))); }
  else { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;min-height:100%;font-family:system-ui}*{box-sizing:border-box}</style><div id="root"></div><script src="/fixture.js"></script>'); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ ...(process.platform === "win32" ? { channel: "msedge" } : {}), headless: true, args: ["--disable-gpu"], timeout: 20000 });
const origin = `http://127.0.0.1:${server.address().port}`, results = [];
try {
  for (const theme of ["dark", "light"]) for (const [device, width, height] of [["desktop", 1440, 900], ["phone", 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } }), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/?${theme}&off`);
    await page.waitForTimeout(100);
    assert.equal(await page.getByTestId("supervision-activation-board").count(), 0);
    assert.equal(await page.evaluate(() => window.attachCalls.length), 0);
    await page.goto(`${origin}/?${theme}`);
    await page.getByText("Attachment history · by convention, not verified", { exact: true }).waitFor();
    await page.screenshot({ path: resolve(out, `${theme}-${device}-board.png`) });
    await page.getByRole("button", { name: "Attach supervisor to Scheduler", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Attach supervisor to Scheduler?" });
    await dialog.waitFor(); assert.match(await dialog.innerText(), /Plan: Scheduler \(scheduler\)/);
    assert.match(await dialog.innerText(), /00000000-0000-4000-8000-000000000002/);
    await page.getByRole("button", { name: /^Supervisor model:/ }).click();
    await page.getByRole("dialog", { name: "Supervisor model", exact: true }).getByRole("button", { name: /Test supervisor/ }).click();
    await page.getByRole("button", { name: /^Permission mode:/ }).click();
    await page.getByRole("dialog", { name: "Supervisor permission mode", exact: true }).getByRole("button", { name: /Read only/ }).click();
    await page.getByRole("textbox", { name: "Opening for this supervisor" }).fill("Read the Scheduler plan and report its current evidence. Do not invoke attach.");
    assert.equal(await page.evaluate(() => window.attachCalls.length), 0);
    await page.screenshot({ path: resolve(out, `${theme}-${device}-confirmation.png`) });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await page.evaluate(() => window.attachCalls.length), 0);
    assert.deepEqual(errors, []);
    results.push({ theme, device, disabledViewWrites: 0, confirmationNamesBoth: true, cancelWrites: 0, errors });
    await page.close();
  }
  await writeFile(resolve(out, "results.json"), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results));
} finally { await browser.close(); server.close(); }
