/** Real Deck view + shipped Pixi, synthetic ledger and host RPCs. No daemon or installation. */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../..");
const requireRoot = createRequire(join(root, "package.json")), harness = createRequire(join(root, "docs/board-list/package.json"));
const { build } = harness("esbuild"), { chromium } = harness("playwright");
const out = join(root, ".local/attention-deck"); mkdirSync(out, { recursive: true });
const baseline = process.env.ATTENTION_BASELINE ?? "2519564";
const git = path => execFileSync("git", ["show", `${baseline}:${path}`], { cwd: root, maxBuffer: 10_000_000 });
for (const tree of ["before", "after", "drawer"]) await build({ entryPoints: [join(here, tree === "drawer" ? "drawer-host.jsx" : "host.jsx")], outfile: join(out, `${tree}.js`), bundle: true, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning", plugins: [{ name: "fixture-host", setup(b) {
  b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: join(root, "docs/board-list/contracts.js") }));
  b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: tree === "drawer" ? join(here, "drawer-stubs.jsx") : join(root, "docs/deck-settings/stubs.jsx") }));
  b.onResolve({ filter: /^(react|zod|@tanstack\/react-query)($|\/)/ }, args => ({ path: requireRoot.resolve(args.path) }));
  b.onResolve({ filter: /^react-dom($|\/)/ }, args => ({ path: harness.resolve(args.path) }));
  b.onResolve({ filter: /^react-native(-web)?$/ }, () => ({ path: harness.resolve("react-native-web") }));
  if (tree === "before") b.onLoad({ filter: /[/\\](client|shared)[/\\].*\.(ts|tsx)$/ }, args => ({ contents: git(relative(root, args.path).replaceAll("\\", "/")).toString(), loader: args.path.endsWith("tsx") ? "tsx" : "ts" }));
} }] });
const html = tree => `<!doctype html><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}#root{display:flex}*{box-sizing:border-box}</style><div id="root"></div><script src="/${tree}.js"></script>`;
const engine = readFileSync(join(root, "vendor/pixi.min.js"), "utf8") + '\n;const originalInit=PIXI.Application.prototype.init;PIXI.Application.prototype.init=async function(...args){await originalInit.apply(this,args);globalThis.reviewApp=this;};';
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://fixture");
    if (url.pathname.endsWith(".js")) { res.setHeader("Content-Type", "application/javascript"); res.end(readFileSync(join(out, url.pathname.slice(1)))); return; }
    if (url.pathname.includes("/rpc/")) {
      const [, , tree, name] = url.pathname.split("/"); let body = ""; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body || "{}");
      res.setHeader("Content-Type", "application/json");
      if (name === "firstmate.deck.engine") { res.end(JSON.stringify({ version: "8.22.0", source: engine })); return; }
      if (name === "firstmate.deck.settings") {
        res.end(JSON.stringify(["ship", "japanese-ship", "ghost-ship", "sky-airship"].map(id => {
          const manifest = JSON.parse(readFileSync(join(root, "art/settings", id, "setting.json")));
          return { id, name: manifest.name, version: manifest.version, formatVersion: manifest.formatVersion,
            compatible: true, reason: null, preview: null,
            bytes: Object.values(manifest.images).reduce((bytes, image) => bytes + readFileSync(join(root, "art/settings", id, image.path)).length, 0) };
        }))); return;
      }
      if (name !== "firstmate.deck.setting" || !["ship", "japanese-ship", "ghost-ship", "sky-airship"].includes(input.id)) throw new Error(`Unexpected RPC ${name}`);
      const manifestPath = `art/settings/${input.id}/setting.json`;
      const manifest = JSON.parse(tree === "before" ? git(manifestPath) : readFileSync(join(root, manifestPath)));
      const images = Object.fromEntries(Object.entries(manifest.images).map(([id, image]) => [id, readFileSync(join(root, "art/settings", input.id, image.path)).toString("base64")]));
      res.end(JSON.stringify({ manifest, images })); return;
    }
    res.setHeader("Content-Type", "text/html"); res.end(html(url.searchParams.get("tree") ?? "after"));
  } catch (e) { res.statusCode = 500; res.end(String(e.stack)); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [];
try {
  for (const setting of ["ship", "japanese-ship", "ghost-ship", "sky-airship"]) for (const tree of ["before", "after"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce", timezoneId: "UTC" });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.clock.setFixedTime(new Date("2026-10-19T12:00:00Z"));
    await page.goto(`http://127.0.0.1:${server.address().port}/?tree=${tree}&setting=${setting}`);
    await page.waitForSelector(`canvas[data-firstmate-deck-setting="${setting}"][data-firstmate-deck-motion="still"]`);
    await page.screenshot({ path: join(out, `${tree}-${setting}.png`) });
    if (tree === "after") {
      assert.equal(await page.getByRole("button", { name: /^Needs you, 2 decisions, 1 new/ }).count(), 1);
      const tag = page.getByTestId("firstmate-deck-decision-tag"); await tag.click();
      assert.deepEqual(await page.evaluate(() => window.decisionActions.at(-1)), { requestId: "local:Pick the next project", homeId: "sample-home", recordRevision: 1 });
      await page.getByRole("button", { name: "1 more for you with the first mate at the wheel", exact: true }).press("Enter");
      assert.deepEqual(await page.evaluate(() => window.decisionActions.at(-1)), { requestId: "local:Pick the next project", homeId: "sample-home", recordRevision: 1 });
      // Hit the real canvas badge for both the officer and a held worker, using its drawn bounds.
      for (const [key, decision] of [["@first-mate", "local:Pick the next project"], ["Choose the release", "local:Choose the release"]]) {
        const point = await page.evaluate(key => {
          const find = node => node.label === key ? node : node.children?.map(find).find(Boolean);
          const figure = find(window.reviewApp.stage), badge = figure.children.find(child => child.label === "badge");
          const bounds = badge.getBounds(), canvas = window.reviewApp.canvas.getBoundingClientRect();
          return { x: canvas.left + bounds.x + bounds.width / 2, y: canvas.top + bounds.y + bounds.height / 2 };
        }, key);
        await page.mouse.click(point.x, point.y);
        assert.deepEqual(await page.evaluate(() => window.decisionActions.at(-1)), { requestId: decision, homeId: "sample-home", recordRevision: 1 });
      }
      await page.mouse.move(0, 0);
      const canvas = page.locator("canvas[data-firstmate-deck]");
      const calm = await canvas.screenshot();
      await page.waitForTimeout(180);
      assert((await canvas.screenshot()).equals(calm), "reduced motion changed pixels");
      for (const status of ["unknown", "stale"]) {
        await page.evaluate(status => window.setDecisionSnapshot(snapshot => ({ ...snapshot,
          actionCount: status === "unknown" ? null : 6,
          requests: [],
          freshness: { ...snapshot.freshness, status, problems: ["Backlog source is unreadable."] },
        })), status);
        await page.getByRole("button", { name: status === "unknown" ? /^Needs you · unavailable ·/ : /^Needs you · 6 · stale ·/ }).waitFor();
        assert.equal(await page.getByText(/^0 needs you/).count(), 0);
        if (setting === "ship") await page.screenshot({ path: join(out, `legend-${status}.png`) });
      }
    }
    assert.deepEqual(errors, []);
    results.push({ setting, tree, width: 1440, height: 900, reducedMotion: true, errors, actions: await page.evaluate(() => window.decisionActions) });
    await context.close();
  }
  // Exercise the actual FleetSurface context action and shared drawer, not an action spy.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.clock.setFixedTime(new Date("2026-10-19T12:00:00Z"));
  await page.goto(`http://127.0.0.1:${server.address().port}/?tree=drawer&setting=ship`);
  await page.waitForSelector('canvas[data-firstmate-deck-setting="ship"]');
  const drawer = page.getByLabel("FirstMate decisions", { exact: true });
  async function checkDrawer(title, ask, capture) {
    await drawer.getByText(title, { exact: true }).waitFor();
    await drawer.getByText(ask, { exact: true }).waitFor();
    await page.screenshot({ path: join(out, `drawer-${capture}.png`) });
    await drawer.getByRole("button", { name: "Close decisions", exact: true }).click();
    await drawer.waitFor({ state: "detached" });
  }
  const point = await page.evaluate(() => {
    const find = node => node.label === "Choose the release" ? node : node.children?.map(find).find(Boolean);
    const figure = find(window.reviewApp.stage), badge = figure.children.find(child => child.label === "badge");
    const bounds = badge.getBounds(), canvas = window.reviewApp.canvas.getBoundingClientRect();
    return { x: canvas.left + bounds.x + bounds.width / 2, y: canvas.top + bounds.y + bounds.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
  await checkDrawer("Choose the release", "Which release should sail?", "bow");
  await page.getByTestId("firstmate-deck-decision-tag").click();
  await checkDrawer("Pick the next project", "Which project should the first mate start next?", "first-mate");
  await page.getByRole("button", { name: /^Needs you · 2 ·/ }).click();
  await checkDrawer("Choose the release", "Which release should sail?", "legend");
  assert.deepEqual(errors, []);
  assert.equal(await page.evaluate(() => window.fixtureCalls.filter(call => call.name.startsWith("firstmate.needs-you.")).length), 0, "opening a drawer mutated a decision");
  results.push({ tree: "drawer", setting: "ship", bow: "local:Choose the release", firstMate: "local:Pick the next project", legend: "local:Choose the release", errors });
  await context.close();
} finally { await browser.close(); server.close(); }
writeFileSync(join(out, "results.json"), JSON.stringify({ baseline, results }, null, 2) + "\n");
console.log(JSON.stringify({ output: out, captures: results.length, errors: [] }));
