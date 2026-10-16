/** Host APIs are fixtures. Real views, registration, scene engine, pack reads and native-web UI. No daemon. */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url)),
  root = resolve(here, "../..");
const harness = createRequire(join(root, "docs/board-list/package.json")),
  rootRequire = createRequire(join(root, "package.json"));
const { build } = harness("esbuild"),
  { chromium } = harness("playwright");
const generated = join(here, ".generated");
const phase = process.env.BEFORE === "1" ? "before" : "after";
await mkdir(generated, { recursive: true });
await build({
  entryPoints: [join(root, "docs/shell-phase1/panel.jsx")],
  outfile: join(generated, "panel.js"),
  bundle: true,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "warning",
  plugins: [
    {
      name: "host-fixture",
      setup(builder) {
        if (phase === "before") builder.onLoad({ filter: /client[\\/](fleet|ship-deck)\.tsx$/ }, (args) => ({
          contents: execFileSync("git", ["show", `d4b4c1d:client/${args.path.replace(/\\/g, "/").split("/").at(-1)}`], { cwd: root, encoding: "utf8" }),
          loader: "tsx", resolveDir: dirname(args.path),
        }));
        builder.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({
          path: join(root, "docs/board-list/contracts.js"),
        }));
        builder.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({
          path: join(root, "docs/deck-scene-switcher-everywhere/stubs.jsx"),
        }));
        builder.onResolve(
          { filter: /^(react|zod|@tanstack\/react-query)($|\/)/ },
          (args) => ({
            path: rootRequire.resolve(args.path),
          }),
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
await build({
  entryPoints: [join(root, "server/deck-settings.ts")],
  outfile: join(generated, "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "warning",
});
const assets = await import(pathToFileURL(join(generated, "server.mjs")).href);
const at = async () => root;
const answers = {
  "firstmate.deck.engine": () => assets.readDeckEngine(at),
  "firstmate.deck.settings": () => assets.listDeckSettings(at),
  "firstmate.deck.setting": (input) => assets.readDeckSetting(input.id, at),
};
const server = createServer(async (request, response) => {
  try {
    if (request.url.startsWith("/rpc/")) {
      let body = "";
      for await (const chunk of request) body += chunk;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify(await answers[request.url.slice(5)](JSON.parse(body))),
      );
    } else if (request.url === "/panel.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end(await readFile(join(generated, "panel.js")));
    } else {
      response.setHeader("Content-Type", "text/html");
      response.end(
        '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:Segoe UI,sans-serif}#root{display:flex;flex-direction:column}*{box-sizing:border-box}</style><div id="root"></div><script src="/panel.js"></script>',
      );
    }
  } catch (error) {
    response.statusCode = 500;
    response.end(String(error.stack ?? error));
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [];
async function pageAt(query, phone = false) {
  const page = await browser.newPage({
    viewport: phone
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-10-15T12:00:00Z"));
  await page.goto(url + query);
  return page;
}
try {
  const results = [];
  for (const width of [1440, 1100, 800, 638, 390]) {
    for (const light of [false, true]) {
      const page = await pageAt("?setting=japanese-ship" + (light ? "&light=1" : ""));
      await page.setViewportSize({ width, height: 1000 });
      await page.getByRole("tab", { name: "Deck", exact: true }).click();
      await page.mouse.move(0, 500);
      await page.evaluate(() => document.activeElement?.blur());
      await page.waitForFunction(() => document.querySelector("canvas[data-firstmate-deck-motion]"));
      const trigger = page.getByRole("button", { name: /^Scene:/ });
      const geometry = await trigger.evaluate(el => {
        const rect = node => { const r = node.getBoundingClientRect(); const s = getComputedStyle(node); return { x:r.x, y:r.y, width:r.width, height:r.height, flexGrow:s.flexGrow, flexShrink:s.flexShrink, alignItems:s.alignItems }; };
        const title = [...document.querySelectorAll("div")].find(node => node.childElementCount === 0 && node.textContent === "Sakura coast");
        return { trigger:rect(el), caption:rect(title.parentElement), title:rect(title) };
      });
      results.push({ width, light, ...geometry });
      if (phase === "after") {
        assert.equal(geometry.trigger.height, 28);
        assert.equal(geometry.trigger.x + geometry.trigger.width, geometry.caption.x + geometry.caption.width);
        assert(geometry.trigger.y >= geometry.caption.y);
        assert(geometry.trigger.y + 28 <= geometry.caption.y + geometry.caption.height);
        if (width >= 1100) assert.equal(geometry.caption.height, 28);
      }
      await page.screenshot({ path: join(here, `${phase}-${width}-${light ? "light" : "dark"}.png`), clip: { x:0, y:0, width, height:300 } });
      await trigger.click();
      await page.getByRole("button", { name: /^Ship's deck, / }).click();
      await page.waitForFunction(() => document.querySelector('canvas[data-firstmate-deck-setting="ship"][data-firstmate-deck-motion]'));
      assert.match(await trigger.innerText(), /Ship's deck/);
      await page.close();
    }
  }
  console.log(JSON.stringify(results, null, 2));
  await writeFile(join(here, `${phase}-measurements.json`), JSON.stringify(results, null, 2) + "\n");
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  server.close();
}
