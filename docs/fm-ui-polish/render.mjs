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
const out = join(root, ".local/fm-ui-polish"); mkdirSync(out, { recursive: true });
const baseline = process.env.FM_UI_BASELINE ?? "3afaacd33185c3eb9916d1077d497dec529c59df";
const git = path => execFileSync("git", ["show", `${baseline}:${path}`], { cwd: root, maxBuffer: 10_000_000 });
for (const tree of ["before", "after"]) await build({ entryPoints: [join(here, "host.jsx")], outfile: join(out, `${tree}.js`), bundle: true, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning", plugins: [{ name: "fixture-host", setup(b) {
  b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: join(root, "docs/board-list/contracts.js") }));
  b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: join(here, "stubs.jsx") }));
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
const browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
const base = `http://127.0.0.1:${server.address().port}`, results = [];
async function open(tree, theme, view, setting = "ship", width = 1440, scenario = "") {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: "reduce", timezoneId: "UTC" });
  page.setDefaultTimeout(15000);
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.clock.setFixedTime(new Date(`2026-10-22T${theme === "light" ? "12" : "23"}:00:00Z`));
  await page.goto(`${base}/?tree=${tree}&theme=${theme}&view=${view}&setting=${setting}&scenario=${scenario}`);
  return { page, errors };
}
async function point(page, key) {
  return page.evaluate(key => {
    const find = node => node.label === key ? node : node.children?.map(find).find(Boolean);
    const figure = find(window.reviewApp.stage), badge = figure.children.find(child => child.label === "badge");
    const box = badge.getBounds(), canvas = window.reviewApp.canvas.getBoundingClientRect();
    return { x: canvas.left + box.x + box.width / 2, y: canvas.top + box.y + box.height / 2 };
  }, key);
}
async function clickMate(page) { const at = await point(page, "@first-mate"); await page.mouse.click(at.x, at.y); }
try {
  for (const theme of ["light", "dark"]) {
    for (const tree of ["before", "after"]) {
      const { page, errors } = await open(tree, theme, "toolbar");
      const toolbar = page.getByTestId("firstmate-task-toolbar"), plans = toolbar.getByRole("button", { name: "Plans", exact: true });
      await plans.waitFor();
      await toolbar.screenshot({ path: join(out, `${tree}-toolbar-${theme}.png`) });
      if (tree === "after") {
        assert.equal(await plans.locator("svg.lucide-list-todo").count(), 1);
        const suggestions = toolbar.getByRole("button", { name: /^Suggestions/ });
        const style = locator => locator.evaluate(el => { const s = getComputedStyle(el); return [s.borderWidth, s.borderRadius, s.padding, s.backgroundColor, s.fontSize]; });
        assert.deepEqual(await style(plans), await style(suggestions));
        assert.equal(await plans.getAttribute("aria-expanded"), "false");
        await plans.click();
        assert.equal(await plans.getAttribute("aria-expanded"), "true");
        const modal = page.getByRole("dialog", { name: "Plans", exact: true });
        await modal.getByRole("button", { name: "Filter: Release voyage", exact: true }).click();
        const selected = toolbar.getByRole("button", { name: "Plans: Release voyage", exact: true });
        await selected.waitFor();
        assert.equal(await selected.evaluate(el => getComputedStyle(el).borderColor), "rgb(32, 116, 74)");
        await selected.click();
        await modal.getByRole("button", { name: "All plans and tasks", exact: true }).click();
        await plans.waitFor();
      }
      assert.deepEqual(errors, []); await page.close();
    }
    for (const tree of ["before", "after"]) {
      const { page, errors } = await open(tree, theme, "deck");
      await page.waitForSelector('canvas[data-firstmate-deck-setting="ship"]');
      const tag = page.getByTestId("firstmate-deck-decision-tag"); await tag.waitFor();
      await page.screenshot({ path: join(out, `${tree}-deck-${theme}.png`) });
      if (tree === "before") {
        const worker = await point(page, "Choose the release");
        await page.mouse.move(worker.x, worker.y);
        await page.screenshot({ path: join(out, `before-worker-hover-${theme}.png`) });
        await clickMate(page);
        await page.getByLabel("FirstMate decisions", { exact: true }).waitFor();
        await page.screenshot({ path: join(out, `before-mate-click-${theme}.png`) });
      } else {
        assert.equal(await tag.textContent(), "2");
        await clickMate(page);
        const popover = page.getByRole("dialog", { name: "First mate needs you", exact: true }); await popover.waitFor();
        assert.equal(await page.getByLabel("FirstMate decisions", { exact: true }).count(), 0);
        assert.equal(await page.evaluate(() => window.fixtureCalls.filter(c => c.name.startsWith("firstmate.needs-you.")).length), 0);
        assert.equal(await popover.getByRole("button", { name: /^Open decision:/ }).count(), 2);
        await page.screenshot({ path: join(out, `after-needs-popover-${theme}.png`) });
        await page.keyboard.press("Escape"); await popover.waitFor({ state: "detached" });
        assert.equal(await tag.evaluate(el => el === document.activeElement), true);
        await page.keyboard.press("Enter"); await popover.waitFor();
        await popover.getByRole("button", { name: "Open decision: Pick the next project", exact: true }).click();
        const drawer = page.getByLabel("FirstMate decisions", { exact: true }); await drawer.waitFor();
        await drawer.getByText("Which project should the first mate start next?", { exact: true }).waitFor();
        await page.screenshot({ path: join(out, `after-selected-item-${theme}.png`) });
        await drawer.getByRole("button", { name: "Back to Deck", exact: true }).click();
        await drawer.waitFor({ state: "detached" });
        await clickMate(page); await popover.waitFor();
        await clickMate(page); await popover.waitFor({ state: "detached" });
        await tag.click(); await popover.waitFor();
        await page.mouse.click(2, 2); await popover.waitFor({ state: "detached" });
        await tag.click();
        await popover.getByRole("button", { name: "Open decision: Choose the release", exact: true }).click();
        await drawer.getByText("Which release should sail?", { exact: true }).waitFor();
        await drawer.getByRole("button", { name: "Back to Deck", exact: true }).click();
        for (const key of ["Choose the release", "Review the patch", "Answer a permission", "Build the feature"]) {
          const worker = await point(page, key); await page.mouse.move(worker.x, worker.y);
          assert.equal(await page.getByTestId("firstmate-deck-bubble").count(), 0);
        }
        assert.equal(await page.evaluate(() => {
          const visible = node => (node.label === "ask" && node.visible ? 1 : 0) + (node.children?.reduce((sum, child) => sum + visible(child), 0) ?? 0);
          return visible(window.reviewApp.stage);
        }), 0);
        await page.mouse.move(1, 1);
        await page.evaluate(() => window.setDecisionCount(12));
        await tag.getByText("12", { exact: true }).waitFor();
        await tag.click(); await popover.getByRole("button", { name: "Open decision: Choice 12", exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(out, `after-many-items-${theme}.png`) });
        await page.evaluate(() => window.setDecisionCount(0));
        await tag.waitFor({ state: "detached" }); await popover.waitFor({ state: "detached" });
        await clickMate(page);
        assert.equal(await drawer.count(), 0); assert.equal(await popover.count(), 0);
        await page.screenshot({ path: join(out, `after-zero-${theme}.png`) });
      }
      assert.deepEqual(errors, []); results.push({ theme, tree, errors }); await page.close();
    }
  }
  // Counted unreadable holds still lead to the existing repair UI, even with no ordinary requests.
  for (const theme of ["light", "dark"]) {
    const { page, errors } = await open("after", theme, "deck", "ship", 1440, "unreadable");
    await page.waitForSelector('canvas[data-firstmate-deck-setting="ship"]');
    const tag = page.getByTestId("firstmate-deck-decision-tag"); await tag.waitFor();
    assert.equal(await tag.textContent(), "1");
    await clickMate(page);
    const popover = page.getByRole("dialog", { name: "First mate needs you", exact: true }); await popover.waitFor();
    assert.equal(await popover.getByText("Nothing needs you right now.", { exact: true }).count(), 0);
    await page.screenshot({ path: join(out, `after-unreadable-popover-${theme}.png`) });
    await popover.getByRole("button", { name: "Open Needs you: 1 more item", exact: true }).click();
    const drawer = page.getByLabel("FirstMate decisions", { exact: true });
    await drawer.getByText("Couldn't read this task: damaged-task. Check the Board and data/backlog.md, line 5.", { exact: true }).waitFor();
    await drawer.getByRole("button", { name: "Ask the first mate to fix it", exact: true }).waitFor();
    await page.screenshot({ path: join(out, `after-unreadable-repair-${theme}.png`) });
    assert.equal(await page.evaluate(() => window.fixtureCalls.filter(call => call.name === "firstmate.mate.ask" || call.name.startsWith("firstmate.needs-you.")).length), 0);
    assert.deepEqual(errors, []); results.push({ theme, scenario: "unreadable-held-task-only", errors }); await page.close();
  }
  // The same first-mate anchor and popup work in every shipped scene, including a narrowed pane.
  for (const setting of ["japanese-ship", "ghost-ship", "sky-airship"]) {
    const { page, errors } = await open("after", "dark", "deck", setting, 900);
    await page.waitForSelector(`canvas[data-firstmate-deck-setting="${setting}"]`);
    await page.getByTestId("firstmate-deck-decision-tag").waitFor();
    await clickMate(page);
    await page.getByRole("dialog", { name: "First mate needs you", exact: true }).waitFor();
    await page.screenshot({ path: join(out, `after-${setting}-narrow.png`) });
    assert.deepEqual(errors, []); results.push({ setting, width: 900, errors }); await page.close();
  }
  writeFileSync(join(out, "results.json"), JSON.stringify({ baseline, results }, null, 2) + "\n");
  console.log(JSON.stringify({ output: out, results }, null, 2));
} finally { await browser.close(); server.close(); }
