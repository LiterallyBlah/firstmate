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
  entryPoints: [join(here, "panel.jsx")],
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
        builder.onResolve({ filter: /^(react|zod|@tanstack\/react-query)($|\/)/ }, (args) => ({
          path: rootRequire.resolve(args.path),
        }));
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
      response.end(JSON.stringify(await answers[request.url.slice(5)](JSON.parse(body))));
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
const canvas = (page) => page.locator("canvas[data-firstmate-deck]");
const waitForDeck = async (page) => {
  await canvas(page).waitFor();
  await page.waitForFunction(() => {
    const node = document.querySelector("canvas[data-firstmate-deck]");
    return node?.width > 0 && node?.height > 0;
  });
  assert.equal(await canvas(page).count(), 1);
};
const fleetCalls = (page) =>
  page.evaluate(() => window.fixtureCalls.filter((c) => c.name === "firstmate.fleet.load").length);
try {
  for (const width of [1440, 960, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
      hasTouch: width === 390,
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await page.getByRole("tab", { name: "Deck", exact: true }).waitFor();
    const initialCalls = await fleetCalls(page);
    await page.getByRole("tab", { name: "Deck", exact: true }).click();
    await waitForDeck(page);
    assert.equal(
      await fleetCalls(page),
      initialCalls,
      "inline Deck consumes the current fleet instead of fetching again",
    );
    assert.equal(await page.evaluate(() => window.navigationCalls.length), 0, "inline choice opens no workspace tab");
    const bounds = await canvas(page).boundingBox();
    assert.ok(bounds.width > 200 && bounds.height > 160);
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    assert.ok(bounds.y + bounds.height <= 901);
    // The existing focus renderer must fit inside the narrow pane, including touch-sized phone layouts.
    await canvas(page).evaluate((node) => node.parentElement.focus());
    await page.keyboard.press("ArrowRight");
    const focus = page.getByTestId("firstmate-deck-focus");
    await focus.waitFor();
    const focused = await focus.boundingBox();
    assert.ok(focused.x >= bounds.x && focused.x + focused.width <= bounds.x + bounds.width + 1);
    assert.ok(focused.y + focused.height <= bounds.y + bounds.height + 1);
    await page.screenshot({ path: join(generated, `deck-${width}.png`) });
    await page.keyboard.press("Escape");
    await focus.waitFor({ state: "detached" });
    await page.waitForFunction(() => window.fixtureSettings?.homePane === "deck");
    if (width !== 390) {
      await page.reload();
      await waitForDeck(page);
      assert.equal(await page.getByRole("tab", { name: "Deck", exact: true }).getAttribute("aria-selected"), "true");
    }
    await page.getByRole("tab", { name: "List", exact: true }).click();
    await canvas(page).waitFor({ state: "detached" });
    await page.getByRole("tab", { name: width === 390 ? "Files" : "Home files", exact: true }).click();
    await page.waitForFunction(() => window.fixtureSettings?.homePane === "files");
    await page.getByRole("tab", { name: "Deck", exact: true }).click();
    await waitForDeck(page);
    if (width === 390) {
      await page.getByRole("tab", { name: "First mate", exact: true }).click();
      await canvas(page).waitFor({ state: "detached" });
      await page.getByRole("tab", { name: "Deck", exact: true }).tap();
      await waitForDeck(page);
      await page.getByRole("button", { name: /^Focus on / }).tap();
      await focus.waitFor();
      await page.screenshot({ path: join(generated, "deck-phone-touch.png") });
    } else {
      await page.getByRole("button", { name: "Open Deck", exact: true }).click();
      await page.getByRole("button", { name: "FirstMate Home", exact: true }).waitFor();
      await waitForDeck(page);
      await page.getByRole("button", { name: "FirstMate Home", exact: true }).click();
      await waitForDeck(page);
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "Home Deck: narrow/phone canvas and focus, touch, persistence, teardown, shared fleet and standalone tab passed.",
  );
} finally {
  await browser.close();
  server.close();
}
