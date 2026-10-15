/**
 * The debug overlay: the Deck drawn still by this checkout's compiled bundle, and over it what its setting pack
 * says — floor, obstacles, posts by zone, overflow areas, label floors, the entry, every exit's marks and the fit
 * box (`overlay-draw.mjs`) — so an author can see a pack's numbers against its own art. Writes `overlay-<id>.png`.
 *
 * `node docs/ship-deck-canvas/compile.mjs` first (it writes the bundle), then `node docs/deck-settings/overlay.mjs`.
 * Needs `docs/board-list`'s `npm install` and Edge. Draws the setting the deck draws (the default until the Deck
 * can choose one); `SETTING=<id>` names which pack's numbers to lay over it.
 */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const generated = join(root, "docs/ship-deck-canvas/.generated");
const rootRequire = createRequire(join(root, "package.json"));
const harness = createRequire(join(root, "docs/board-list/package.json"));
const { build } = harness("esbuild");
const { chromium } = harness("playwright");
const setting = process.env.SETTING ?? "ship";

const hostPlugins = [
  {
    name: "host",
    setup(builder) {
      builder.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: join(root, "docs/board-list/contracts.js") }));
      builder.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: join(here, "stubs.jsx") }));
      builder.onResolve({ filter: /^(react|zod|@tanstack\/react-query)($|\/)/ }, (args) => ({ path: rootRequire.resolve(args.path) }));
      builder.onResolve({ filter: /^react-dom($|\/)/ }, (args) => ({ path: harness.resolve(args.path) }));
      builder.onResolve({ filter: /^react-native(-web)?$/ }, () => ({ path: harness.resolve("react-native-web") }));
    },
  },
];
await build({ entryPoints: [join(here, "host.jsx")], outfile: join(generated, "gate-host.js"), bundle: true, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning", plugins: hostPlugins });
await build({ entryPoints: [join(here, "overlay-draw.mjs")], outfile: join(generated, "overlay-draw.js"), bundle: true, logLevel: "warning", nodePaths: [join(root, "node_modules")] });
await build({ entryPoints: [join(root, "server/deck-settings.ts")], outfile: join(generated, "overlay-server.mjs"), bundle: true, platform: "node", format: "esm", nodePaths: [join(root, "node_modules")], logLevel: "warning" });
const server = await import(pathToFileURL(join(generated, "overlay-server.mjs")).href);
const at = async () => root;
const answers = {
  "firstmate.deck.engine": () => server.readDeckEngine(at),
  "firstmate.deck.settings": () => server.listDeckSettings(at),
  "firstmate.deck.setting": (input) => server.readDeckSetting(input.id, at),
};

const page = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:Segoe UI,sans-serif}*{box-sizing:border-box}</style>
<div id="root"></div><script src="/host.js"></script><script src="/overlay.js"></script>
<script>(async () => { const params = new URLSearchParams(location.search);
  const source = await (await fetch("/bundle/branch.js")).text(); window.mountPlugin(source, params); })();</script>`;
const http = createServer(async (request, response) => {
  const path = new URL(request.url, "http://x").pathname;
  const rpc = /^\/rpc\/branch\/([a-z.]+)$/.exec(path);
  try {
    if (rpc !== null) {
      let body = "";
      for await (const chunk of request) body += chunk;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(await answers[rpc[1]](JSON.parse(body || "{}"))));
    } else if (path === "/host.js" || path === "/overlay.js" || path === "/bundle/branch.js") {
      response.setHeader("Content-Type", "application/javascript");
      const file = { "/host.js": "gate-host.js", "/overlay.js": "overlay-draw.js", "/bundle/branch.js": "branch.client.js" }[path];
      response.end(await readFile(join(generated, file)));
    } else {
      response.setHeader("Content-Type", "text/html");
      response.end(page);
    }
  } catch (error) {
    response.statusCode = 500;
    response.end(String(error?.stack ?? error));
  }
});
await new Promise((done) => http.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: "reduce", timezoneId: "UTC" });
  const view = await context.newPage();
  await view.clock.setFixedTime(new Date("2026-10-14T12:00:00Z"));
  await view.goto(`http://127.0.0.1:${http.address().port}/?tree=branch&theme=dark&working=4`);
  await view.getByText("Deck", { exact: true }).click();
  await view.waitForSelector("canvas[data-firstmate-deck-motion]");
  await view.waitForTimeout(800);
  const manifest = (await (await fetch(`http://127.0.0.1:${http.address().port}/rpc/branch/firstmate.deck.setting`, { method: "POST", body: JSON.stringify({ id: setting }) })).json()).manifest;
  const drawn = await view.evaluate((each) => window.drawOverlay(each), manifest);
  const clip = await view.evaluate(() => {
    const rect = document.querySelector("canvas[data-firstmate-deck]").getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
  await view.screenshot({ path: join(here, `overlay-${setting}.png`), clip });
  console.log(`overlay-${setting}.png: ${drawn.posts} posts, fit ${JSON.stringify(drawn.fit)}`);
} finally {
  await browser.close();
  http.close();
}
