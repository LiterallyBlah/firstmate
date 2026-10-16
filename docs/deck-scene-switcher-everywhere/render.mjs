/** Host APIs are fixtures. Real views, registration, scene engine, pack reads and native-web UI. No daemon. */
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
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
        builder.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({
          path: join(root, "docs/board-list/contracts.js"),
        }));
        builder.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({
          path: join(here, "stubs.jsx"),
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
  for (const light of [false, true]) {
    const tone = light ? "light" : "dark";
    for (const surface of ["home", "compact", "panel", "narrow-panel"]) {
      const page = await pageAt(
        "?persistScene=1" +
          (light ? "&light=1" : "") +
          (surface.includes("panel") ? "&view=deck" : ""),
        surface === "compact",
      );
      if (surface === "narrow-panel")
        await page.setViewportSize({ width: 800, height: 900 });
      if (surface === "home")
        await page.getByRole("tab", { name: "Deck", exact: true }).click();
      if (surface === "compact")
        await page.getByRole("tab", { name: "Deck", exact: true }).click();
      const actual = (id) =>
        page.waitForFunction((id) => {
          const canvas = document.querySelector("canvas[data-firstmate-deck]");
          return (
            canvas?.getAttribute("data-firstmate-deck-setting") === id &&
            canvas.hasAttribute("data-firstmate-deck-motion")
          );
        }, id);
      await actual("ship");
      const trigger = page.getByRole("button", { name: /^Scene:/ });
      assert.equal(await trigger.count(), 1);
      if (light)
        await page.evaluate(() => {
          window.fixtureTheme = {
            colors: {
              surface1: "#f4f5f4",
              foreground: "#151915",
              border: "#d6dbd6",
            },
          };
        });
      await trigger.click();
      await page.screenshot({
        path: join(here, surface + "-" + tone + "-picker.png"),
      });
      await page.getByRole("button", { name: /^Sakura coast, / }).click();
      await actual("japanese-ship");
      await page.waitForTimeout(300);
      await page.screenshot({
        path: join(here, surface + "-" + tone + ".png"),
      });
      const box = await trigger.boundingBox();
      assert(box.x >= 0 && box.x + box.width <= page.viewportSize().width);
      assert.match(await trigger.innerText(), /Sakura coast/);
      // The same saved document reaches another registered surface.
      if (surface === "compact")
        await page.setViewportSize({ width: 1000, height: 900 });
      await page.evaluate(() => window.openFixturePanel("deck"));
      await actual("japanese-ship");
      await trigger.click();
      await page.getByRole("button", { name: /^Ship's deck, / }).click();
      await actual("ship");
      await page.reload();
      if (!surface.includes("panel"))
        await page
          .getByRole("button", { name: "Open Deck", exact: true })
          .click();
      await actual("ship");
      await page.evaluate(() => window.selectDeckSetting("japanese-ship"));
      await actual("japanese-ship");
      assert.match(await trigger.innerText(), /Sakura coast/);
      assert.deepEqual(await page.evaluate(() => window.fixtureErrors), []);
      await page.close();
      console.log(
        surface +
          " " +
          tone +
          ": picker, scene change, shared setting, reload, external update passed",
      );
    }
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  server.close();
}
