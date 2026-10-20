/** Real Deck/pack/Pixi, synthetic workers and host RPCs. No daemon or installed plugin. */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../..");
const requireRoot = createRequire(join(root, "package.json")), harness = createRequire(join(root, "docs/board-list/package.json"));
const { build } = harness("esbuild"), { chromium } = harness("playwright");
const out = join(root, ".local/hide-offline-hosts"); mkdirSync(out, { recursive: true });
await build({ entryPoints: [join(here, "host.jsx")], outfile: join(out, "host.js"), bundle: true, jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning", plugins: [{ name: "fixture-host", setup(b) {
    b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: join(root, "docs/board-list/contracts.js") }));
    b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: join(root, "docs/deck-settings/stubs.jsx") }));
    b.onResolve({ filter: /^(react|zod|@tanstack\/react-query)($|\/)/ }, args => ({ path: requireRoot.resolve(args.path) }));
    b.onResolve({ filter: /^react-dom($|\/)/ }, args => ({ path: harness.resolve(args.path) }));
    b.onResolve({ filter: /^react-native(-web)?$/ }, () => ({ path: harness.resolve("react-native-web") }));
  } }] });
const engine = readFileSync(join(root, "vendor/pixi.min.js"), "utf8") + '\n;const init=PIXI.Application.prototype.init;PIXI.Application.prototype.init=async function(...args){await init.apply(this,args);window.reviewApp=this;};';
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://fixture");
    if (url.pathname === "/host.js") { res.setHeader("Content-Type", "application/javascript"); res.end(readFileSync(join(out, "host.js"))); return; }
    if (url.pathname.startsWith("/rpc/")) {
      const name = url.pathname.split("/").at(-1); let body = ""; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body || "{}"); res.setHeader("Content-Type", "application/json");
      if (name === "firstmate.deck.engine") { res.end(JSON.stringify({ version: "8.22.0", source: engine })); return; }
      assert.equal(name, "firstmate.deck.setting"); assert.ok(["ship", "japanese-ship"].includes(input.id));
      const manifest = JSON.parse(readFileSync(join(root, "art/settings", input.id, "setting.json")));
      const images = Object.fromEntries(Object.entries(manifest.images).map(([id, image]) => [id, readFileSync(join(root, "art/settings", input.id, image.path)).toString("base64")]));
      res.end(JSON.stringify({ manifest, images })); return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}#root{display:flex}*{box-sizing:border-box}</style><div id="root"></div><script src="/host.js"></script>');
  } catch (e) { res.statusCode = 500; res.end(String(e.stack)); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [];
const showName = "Show workers on disconnected hosts for this session";
async function waitDeck(page, setting = "ship") {
  await page.waitForSelector(`canvas[data-firstmate-deck-setting="${setting}"][data-firstmate-deck-motion="still"]`);
}
async function hasFigure(page, key) {
  return page.evaluate(key => {
    const find = node => node.label === key || node.children?.some(find);
    return !!find(window.reviewApp.stage);
  }, key);
}
try {
  for (const width of [1440, 390, 320]) for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width, height: width === 1440 ? 900 : 844 }, reducedMotion: "reduce", hasTouch: width < 500 });
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    const url = `http://127.0.0.1:${server.address().port}/?tree=after&theme=${theme}`;
    await page.clock.setFixedTime(new Date("2026-10-20T12:00:00Z"));
    await page.goto(url); await waitDeck(page);
    const line = page.getByTestId("firstmate-deck-hidden-workers"), show = page.getByRole("button", { name: showName });
    await line.getByText("12 workers hidden on 1 offline host ·", { exact: true }).waitFor();
    await page.getByText("Drawn with WebGL · 3 on deck", { exact: true }).waitFor();
    assert.equal(await hasFigure(page, "light-0"), false);
    assert.equal(await hasFigure(page, "@first-mate"), true);
    const lineBox = await line.boundingBox(), showBox = await show.boundingBox();
    assert.ok(lineBox.x >= 0 && lineBox.x + lineBox.width <= width + 1);
    assert.ok(showBox.width >= 44 && showBox.height >= 44);
    assert.ok(showBox.y + showBox.height <= 844);
    assert.ok((await page.getByRole("img").getAttribute("aria-label")).includes("12 workers hidden on 1 offline host"));
    await page.screenshot({ path: join(out, `hidden-${width}-${theme}.png`) });
    if (width < 500) await show.tap(); else { await show.focus(); await page.keyboard.press("Enter"); }
    await line.waitFor({ state: "detached" });
    await page.getByText("Drawn with WebGL · 15 on deck", { exact: true }).waitFor();
    await page.getByText("12 sailors' hosts are out of reach: greyed where last seen.", { exact: true }).waitFor();
    assert.equal(await hasFigure(page, "light-0"), true);
    assert.equal(await page.evaluate(() => window.fixtureSettings), undefined, "Show saved a settings document");
    await page.screenshot({ path: join(out, `shown-${width}-${theme}.png`) });
    await page.evaluate(() => window.setMounted(false)); await page.locator("canvas").waitFor({ state: "detached" });
    await page.evaluate(() => { window.setSetting("japanese-ship"); window.setMounted(true); }); await waitDeck(page, "japanese-ship");
    assert.equal(await page.getByRole("button", { name: showName }).count(), 0, "session reveal lost on remount/scene change");
    assert.equal(await hasFigure(page, "light-0"), true);
    await page.goto(url); await waitDeck(page); await line.waitFor();
    await page.evaluate(() => window.setOffline(false)); await line.waitFor({ state: "detached" });
    await page.getByText("Drawn with WebGL · 15 on deck", { exact: true }).waitFor();
    assert.equal(await page.getByText(/out of reach: greyed/).count(), 0);
    await page.goto(`${url}&hide=0`); await waitDeck(page);
    await page.getByText("12 sailors' hosts are out of reach: greyed where last seen.", { exact: true }).waitFor();
    assert.equal(await show.count(), 0);
    await page.goto(`${url}&offline=0`); await waitDeck(page);
    await page.getByText("Drawn with WebGL · 15 on deck", { exact: true }).waitFor();
    assert.equal(await show.count(), 0);
    assert.deepEqual(errors, []);
    results.push({ width, theme, hiddenWorkers: 12, offlineHosts: 1, visibleWorkers: 3, lineBox, showBox, errors,
      checks: ["hidden figures absent", "first mate retained", "keyboard/touch Show", "no settings write", "session remount/scene change", "new app session", "reconnection", "setting off", "all online"] });
    await page.close();
  }
} finally { await browser.close(); server.close(); }
writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify({ output: out, layouts: results.length, errors: [] }));
