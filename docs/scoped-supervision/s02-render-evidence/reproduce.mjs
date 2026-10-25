/** Real FirstMate components, synthetic host APIs. No plugin installation, daemon or real sends. */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { checkTaskViews } from "../../needs-you/view-checks.mjs";
import { checkResilience } from "../../needs-you/resilience-checks.mjs";
import { checkPolish } from "../../needs-you/polish-checks.mjs";
import { checkHeaders } from "../../needs-you/header-checks.mjs";
import { checkAnswers } from "../../needs-you/answer-checks.mjs";
import { checkRaised } from "../../needs-you/raised-checks.mjs";
const here = resolve(dirname(fileURLToPath(import.meta.url)), "../../needs-you"),
  root = resolve(here, "../..");
const harness = createRequire(join(root, "docs/board-list/package.json")),
  local = createRequire(join(root, "package.json"));
const { build } = harness("esbuild"),
  { chromium } = harness("playwright");
const generated = join(here, ".generated");
await mkdir(generated, { recursive: true });
await build({
  entryPoints: [join(here, "panel.jsx")],
  outfile: join(generated, "panel.js"),
  bundle: true,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "warning",
  plugins: [
    {
      name: "host-fixtures",
      setup(builder) {
        builder.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({
          path: join(root, "docs/board-list/contracts.js"),
        }));
        builder.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({
          path: join(here, "stubs.jsx"),
        }));
        builder.onResolve(
          { filter: /^(react|zod|@tanstack\/react-query)($|\/)/ },
          (args) => ({ path: local.resolve(args.path) }),
        );
        builder.onResolve({ filter: /^react-dom($|\/)/ }, (args) => ({
          path: harness.resolve(args.path),
        }));
        builder.onResolve({ filter: /^react-native(-web)?$/ }, () => ({
          path: harness.resolve("react-native-web"),
        }));
      },
    },
  ],
});
const server = createServer(async (request, response) => {
  if (request.url?.startsWith("/rpc/")) {
    try {
      let body = ""; for await (const chunk of request) body += chunk;
      const name = request.url.slice(5), input = JSON.parse(body || "{}");
      const manifest = JSON.parse(await readFile(join(root, "art/settings/ship/setting.json"), "utf8"));
      let result;
      if (name === "firstmate.deck.engine") result = { version: "8.22.0", source: await readFile(join(root, "vendor/pixi.min.js"), "utf8") };
      else if (name === "firstmate.deck.settings") result = [{ id: "ship", name: manifest.name, version: manifest.version,
        formatVersion: manifest.formatVersion, compatible: true, reason: null, preview: null, bytes: 0 }];
      else if (name === "firstmate.deck.setting" && input.id === "ship") result = { manifest, images: Object.fromEntries(await Promise.all(
        Object.entries(manifest.images).map(async ([id, image]) => [id, (await readFile(join(root, "art/settings/ship", image.path))).toString("base64")]))) };
      else throw new Error(`Unexpected fixture RPC: ${name}`);
      response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(result));
    } catch (error) { response.statusCode = 500; response.end(String(error)); }
    return;
  }
  response.setHeader(
    "Content-Type",
    request.url === "/panel.js" ? "text/javascript" : "text/html",
  );
  response.end(
    request.url === "/panel.js"
      ? await readFile(join(generated, "panel.js"))
      : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:Segoe UI,sans-serif}#root{display:flex;flex-direction:column}*{box-sizing:border-box}</style><div id="root"></div><script src="/panel.js"></script>',
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({
  channel:
    process.platform === "win32" && !process.env.CI ? "msedge" : "chromium",
  headless: true,
});
const errors = [],
  output = join(root, ".local/s02-render/reproduction");
await mkdir(output, { recursive: true });
const base = `http://127.0.0.1:${server.address().port}`;

const observations = [];
function instrument() {
  const selector = '[data-testid="firstmate-deck-decision-legend"] [role="button"]';
  window.probe = { events: [], positions: [] };
  const box = () => {
    const e = document.querySelector(selector);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return [r.x, r.y, r.width, r.height];
  };
  let previous;
  const sample = () => {
    const current = JSON.stringify(box());
    if (current !== previous) { window.probe.positions.push({ at: performance.now(), box: JSON.parse(current) }); previous = current; }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  for (const type of ['pointerdown','pointerup','mousedown','mouseup','click'])
    document.addEventListener(type, event => {
      const e = event.target;
      window.probe.events.push({ type, at: performance.now(), x: event.clientX, y: event.clientY,
        target: e?.outerHTML?.slice(0, 500), legendTarget: !!e?.closest?.(selector),
        box: box(), drawer: !!document.querySelector('[aria-label="FirstMate decisions"]') });
    }, true);
}

try {
  for (const mode of ['cold-held-control', 'release-during-press', 'settled-control', 'locator-release-during-press']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(10000);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/rpc/firstmate.deck.engine', async route => { await gate; await route.continue(); });
    await page.exposeFunction('releaseDeck', release);
    await page.addInitScript(instrument);
    page.on('pageerror', error => errors.push(String(error)));
    await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
    await page.goto(base + '/?view=deck');
    await page.getByRole('heading', { name: 'Deck', exact: true }).waitFor();
    const drawn = page.getByText('Drawn with WebGL', { exact: false });
    const legend = page.getByTestId('firstmate-deck-decision-legend').getByRole('button', { name: 'Answer the next', exact: true });
    if (mode === 'settled-control') { release(); await drawn.waitFor(); }
    let failure = null;
    if (mode === 'release-during-press') {
      await legend.hover();
      await page.mouse.down();
      release();
      await drawn.waitFor();
      await page.mouse.up();
    } else if (mode === 'locator-release-during-press') {
      await page.evaluate(() => document.addEventListener('pointerdown', () => window.releaseDeck(), { once: true }));
      await legend.click({ delay: 1500 });
    } else await legend.click();
    const back = page.getByLabel('FirstMate decisions', { exact: true }).getByRole('button', { name: 'Back to Deck', exact: true });
    try { await back.waitFor(); } catch (error) { failure = String(error); }
    release();
    observations.push({ mode, failure, ...await page.evaluate(() => window.probe), body: await page.locator('body').innerText() });
    await page.screenshot({ path: join(output, mode + '.png') });
    await page.context().tracing.stop({ path: join(output, mode + '.zip') });
    console.log(JSON.stringify({ mode, failure }));
    await page.close();
  }
  await writeFile(join(output, 'observations.json'), JSON.stringify({ observations, errors }, null, 2));
} finally { await browser.close(); await new Promise(done => server.close(done)); }
