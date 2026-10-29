/** Real registered FleetSurface, picker, Pixi and pack RPCs; file-backed host settings fixture.
 * Never reads or writes installed settings. All generated evidence stays in .local/. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../..");
const requestedRevision = process.env.DECK_SCENE_REVISION;
const revision = requestedRevision ? execFileSync("git", ["rev-parse", "--verify", "--end-of-options", `${requestedRevision}^{commit}`],
  { cwd: root, encoding: "utf8" }).trim() : null;
const expectStale = process.argv.includes("--expect-stale");
const out = join(root, ".local/deck-scene-swap", revision?.slice(0, 8) ?? "worktree");
await mkdir(out, { recursive: true });
const harness = createRequire(join(root, "docs/board-list/package.json")), repo = createRequire(join(root, "package.json"));
const { build } = harness("esbuild"), { chromium } = harness("playwright");
await build({ entryPoints: [join(root, "docs/shell-phase1/panel.jsx")], outfile: join(out, "panel.js"),
  bundle: true, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning",
  plugins: [{ name: "host-fixtures", setup(b) {
    b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: join(root, "docs/board-list/contracts.js") }));
    b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: join(here, "stubs.jsx") }));
    b.onResolve({ filter: /^(react|zod|@tanstack\/react-query)($|\/)/ }, a => ({ path: repo.resolve(a.path) }));
    b.onResolve({ filter: /^react-dom($|\/)/ }, a => ({ path: harness.resolve(a.path) }));
    b.onResolve({ filter: /^react-native(-web)?$/ }, () => ({ path: harness.resolve("react-native-web") }));
    if (revision) b.onLoad({ filter: /[/\\](client|shared)[/\\].*\.(ts|tsx)$/ }, a => ({
      contents: execFileSync("git", ["show", `${revision}:${relative(root, a.path).replaceAll("\\", "/")}`],
        { cwd: root, encoding: "utf8", maxBuffer: 10_000_000 }), loader: a.path.endsWith("tsx") ? "tsx" : "ts",
    }));
  } }],
});
await build({ entryPoints: [join(root, "server/deck-settings.ts")], outfile: join(out, "packs.mjs"),
  bundle: true, platform: "node", format: "esm", logLevel: "warning" });
const packs = await import(pathToFileURL(join(out, "packs.mjs")).href);
const rpc = {
  "firstmate.deck.engine": () => packs.readDeckEngine(async () => root),
  "firstmate.deck.settings": () => packs.listDeckSettings(async () => root),
  "firstmate.deck.setting": input => packs.readDeckSetting(input.id, async () => root),
};
const file = join(out, "display.json"), log = [];
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
async function document(id) {
  const bytes = id === "display" ? await readFile(file) : Buffer.from("{}");
  return { status: "ready", values: JSON.parse(bytes), revision: digest(bytes) };
}
async function restore(values) { await writeFile(file, JSON.stringify(values)); }
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://fixture").pathname;
    if (path.startsWith("/rpc/") || path.startsWith("/settings/")) {
      let body = ""; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body || "{}"); let result;
      if (path.startsWith("/rpc/")) result = await rpc[path.slice(5)](input);
      else {
        const current = await document(input.id);
        if (path === "/settings/read") { result = current; log.push({ action: "read", id: input.id, revision: current.revision }); }
        else {
          const saved = input.revision === current.revision;
          log.push({ action: "write", ...input, saved });
          if (saved) await restore(input.values);
          result = saved ? { ...await document(input.id), status: "saved" }
            : { status: "conflict", error: "Settings changed. Reload and try again." };
        }
      }
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(result));
    } else if (path === "/panel.js") {
      res.setHeader("Content-Type", "application/javascript"); res.end(await readFile(join(out, "panel.js")));
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}#root{display:flex;flex-direction:column}*{box-sizing:border-box}</style><div id="root"></div><script src="/panel.js"></script>');
    }
  } catch (error) { res.statusCode = 500; res.end(String(error.stack ?? error)); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ ...(process.platform === "win32" ? { channel: "msedge" } : {}), headless: true });
const base = `http://127.0.0.1:${server.address().port}`, results = [], errors = [];
async function actual(page, id) {
  try { await page.waitForFunction(id => {
    const canvases = document.querySelectorAll("canvas[data-firstmate-deck]");
    return canvases.length === 1 && canvases[0].getAttribute("data-firstmate-deck-setting") === id
      && canvases[0].hasAttribute("data-firstmate-deck-motion");
  }, id); } catch (error) {
    console.error(JSON.stringify({ errors, ...await page.evaluate(() => ({ text: document.body.innerText,
      canvases: [...document.querySelectorAll("canvas")].map(canvas => ({ setting: canvas.getAttribute("data-firstmate-deck-setting"), motion: canvas.getAttribute("data-firstmate-deck-motion"), width: canvas.clientWidth, height: canvas.clientHeight })) })) }, null, 2));
    throw error;
  }
}
async function open(surface, light, pollSeconds = 120) {
  await restore({ deckSetting: "ship", pollSeconds, homePane: "deck" }); log.length = 0;
  const page = await browser.newPage({ viewport: surface === "compact" ? { width: 390, height: 844 }
    : { width: surface === "narrow-panel" ? 800 : 1440, height: 1000 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/?${surface.includes("panel") ? "view=deck&" : ""}${light ? "light=1" : ""}`);
  if (surface === "compact") {
    await page.getByRole("tab", { name: "Deck", exact: true }).click();
    // Home batches its pane preference. Let that independent save finish before
    // the external restore so the scene's two CAS attempts are isolated.
    await page.waitForFunction(() => window.fixtureSettingsCompleted > 0);
  }
  await actual(page, "ship"); return page;
}
async function choose(page, label) {
  await page.getByRole("button", { name: /^Scene:/ }).click();
  await page.getByRole("button", { name: new RegExp(`^${label}, `) }).click();
}
try {
  for (const light of [false, true]) for (const surface of ["panel", "narrow-panel", "home", "compact"]) {
    const page = await open(surface, light);
    // Backup restore changes both the scene and unrelated preferences, without notifying the client.
    const restored = { deckSetting: "sky-airship", pollSeconds: 120, homePane: "deck", density: "compact", hideDisconnectedWorkers: false };
    await restore(restored);
    assert.match(await page.getByRole("button", { name: /^Scene:/ }).innerText(), /Pirate voyage/);
    await choose(page, "Sakura coast");
    if (expectStale) {
      await page.waitForFunction(() => window.fixtureErrors.length > 0);
      await actual(page, "ship");
      const writes = log.filter(row => row.action === "write" && row.values.deckSetting === "japanese-ship");
      assert.equal(writes.length, 1);
      assert.equal(writes[0].saved, false);
      assert.deepEqual(JSON.parse(await readFile(file)), restored);
    } else {
      await actual(page, "japanese-ship");
      const writes = log.filter(row => row.action === "write" && row.values.deckSetting === "japanese-ship");
      assert.equal(writes.length, 2); assert.equal(writes[0].saved, false); assert.equal(writes[1].saved, true);
      assert.notEqual(writes[0].revision, writes[1].revision);
      const saved = JSON.parse(await readFile(file));
      for (const [key, value] of Object.entries({ ...restored, deckSetting: "japanese-ship" })) assert.deepEqual(saved[key], value);
      assert.deepEqual(await page.evaluate(() => window.fixtureErrors), []);
      await page.reload();
      if (surface === "compact") await page.getByRole("tab", { name: "Deck", exact: true }).click();
      await actual(page, "japanese-ship");
      await choose(page, "Pirate voyage"); await actual(page, "ship");
      // Adjacent Deck controls still work after recovery and a scene remount.
      await page.getByRole("button", { name: "Shark suggestions", exact: true }).click();
      await page.getByRole("dialog", { name: "Shark suggestions", exact: true }).waitFor();
      await page.keyboard.press("Escape");
    }
    await page.screenshot({ path: join(out, `${surface}-${light ? "light" : "dark"}.png`) });
    results.push({ surface, light, reproducedStale: expectStale, log: structuredClone(log) });
    await page.close(); console.log(`${surface} ${light ? "light" : "dark"}: ${expectStale ? "stale rejection reproduced" : "recovered, persisted, switched back, suggestions work"}`);
  }
  if (!expectStale) {
    for (const surface of ["home", "compact"]) {
      const page = await open(surface, false);
      let releaseRead;
      const delayed = new Promise(resolve => { releaseRead = resolve; });
      let intercept = true;
      await page.route("**/settings/read", async route => {
        if (route.request().postDataJSON().id !== "display" || !intercept) { await route.continue(); return; }
        intercept = false;
        await delayed;
        const response = await route.fetch();
        await route.fulfill({ response });
      });
      try {
        await restore({ deckSetting: "sky-airship", pollSeconds: 120, homePane: "deck", density: "comfortable" });
        log.length = 0;
        const reloadRequested = page.waitForRequest(request => request.url().endsWith("/settings/read") && request.postDataJSON().id === "display");
        await choose(page, "Sakura coast");
        await reloadRequested;
        await page.getByRole("tab", { name: "Board", exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll("canvas[data-firstmate-deck]").length === 0);
        await page.getByRole("tab", { name: "Deck", exact: true }).click();
        await actual(page, "ship");
        await restore({ deckSetting: "ghost-ship", pollSeconds: 120, homePane: "deck", density: "compact" });
        releaseRead();
        await actual(page, "ghost-ship");
        const writes = log.filter(row => row.action === "write" && row.values.deckSetting === "japanese-ship");
        assert.equal(writes.length, 1); assert.equal(writes[0].saved, false);
        const saved = JSON.parse(await readFile(file));
        assert.equal(saved.deckSetting, "ghost-ship"); assert.equal(saved.density, "compact");
        assert.deepEqual(await page.evaluate(() => window.fixtureErrors), []);
        // A new deliberate choice after returning is still usable.
        await choose(page, "Pirate voyage"); await actual(page, "ship");
        await page.screenshot({ path: join(out, `${surface}-navigation.png`) });
        results.push({ surface, cancelledAcrossNavigation: true, preservedRestore: "ghost-ship", log: structuredClone(log) });
        console.log(`${surface}: Deck -> Board -> Deck cancels the old choice and preserves the newer restore`);
      } finally { releaseRead(); await page.close(); }
    }
    const page = await open("panel", false, 1);
    await restore({ deckSetting: "sky-airship", pollSeconds: 1, density: "compact" });
    await actual(page, "sky-airship");
    assert.match(await page.getByRole("button", { name: /^Scene:/ }).innerText(), /Sky pirates/);
    assert.equal(log.filter(row => row.action === "write").length, 0);
    results.push({ externalChangeWithoutSelection: true, log: structuredClone(log) }); await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(join(out, "results.json"), JSON.stringify({ revision, expectStale, passed: true, results, errors }, null, 2));
} catch (error) {
  await writeFile(join(out, "failure.json"), JSON.stringify({ error: String(error), log, errors }, null, 2));
  throw error;
} finally { await browser.close(); await new Promise(done => server.close(done)); }
