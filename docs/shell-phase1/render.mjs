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
async function pageAt(query, phone = false) {
  const page = await browser.newPage({
    viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-10-15T12:00:00Z"));
  await page.goto(url + query);
  return page;
}
const seen = (page) =>
  page.evaluate(() => window.fixtureCalls.filter((call) => call.name === "firstmate.mate.seen").length);
try {
  for (const light of [false, true]) {
    const page = await pageAt(light ? "?light=1" : "");
    await page.getByRole("button", { name: "Open Deck", exact: true }).waitFor();
    assert.equal(await page.locator("#firstmate-chat-pane").count(), 1);
    await page.screenshot({
      path: join(generated, `home-${light ? "light" : "dark"}.png`),
    });
    await page.getByRole("button", { name: "Terminal & browser", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.navigationCalls.at(-1)), {
      workspace: { workspaceId: "sample" },
    });
    await page.getByRole("button", { name: "Open Crew", exact: true }).click();
    await page.getByRole("button", { name: "FirstMate Home", exact: true }).waitFor();
    assert.equal(await page.locator("#firstmate-chat-pane").count(), 0);
    await page.screenshot({
      path: join(generated, `crew-${light ? "light" : "dark"}.png`),
    });
    await page.getByRole("button", { name: "FirstMate Home", exact: true }).click();
    await page.getByRole("button", { name: "Open Board", exact: true }).click();
    await page.getByRole("button", { name: "FirstMate Home", exact: true }).waitFor();
    await page.screenshot({
      path: join(generated, `board-${light ? "light" : "dark"}.png`),
    });
    await page.getByRole("button", { name: "FirstMate Home", exact: true }).click();
    await page.getByRole("button", { name: "Open Deck", exact: true }).click();
    await page.waitForSelector('canvas[data-firstmate-deck-setting="office"]');
    assert.equal(await page.locator("canvas[data-firstmate-deck]").count(), 1);
    await page.screenshot({
      path: join(generated, `deck-${light ? "light" : "dark"}.png`),
    });
    await page.getByRole("button", { name: "FirstMate Home", exact: true }).click();
    assert.equal(await page.locator("canvas[data-firstmate-deck]").count(), 0);
    await page.close();
  }
  for (const view of ["crew", "board", "deck"]) {
    const page = await pageAt(`?view=${view}`);
    await page.getByRole("button", { name: "FirstMate Home", exact: true }).waitFor();
    assert.equal(await seen(page), 0, `${view} must not clear the first mate's attention`);
    await page.close();
  }
  const wrong = await pageAt("?view=crew&workspace=other");
  await wrong.getByText("This fleet view belongs to the FirstMate home workspace.").waitFor();
  await wrong.getByRole("button", { name: "Open Crew in FirstMate", exact: true }).click();
  assert.equal((await wrong.evaluate(() => window.navigationCalls.at(-1))).workspaceId, "sample");
  await wrong.close();
  const adopted = await pageAt("?adopted=1");
  await adopted.getByText("Launch a first mate in its home to open the workspace tabs.").waitFor();
  assert.equal(await adopted.getByRole("button", { name: "Open Crew", exact: true }).isDisabled(), true);
  await adopted.close();
  const phone = await pageAt("?view=crew", true);
  await phone.getByRole("button", { name: "FirstMate Home", exact: true }).waitFor();
  assert.equal(await seen(phone), 0);
  await phone.screenshot({ path: join(generated, "crew-phone.png") });
  await phone.getByRole("button", { name: "FirstMate Home", exact: true }).click();
  await phone.getByRole("button", { name: "Open Deck", exact: true }).click();
  await phone
    .getByText("Deck needs a wide web or desktop window. Open Crew or Board from FirstMate Home on this device.")
    .waitFor();
  assert.equal(await phone.locator("canvas").count(), 0);
  await phone.getByRole("button", { name: "FirstMate Home", exact: true }).click();
  await phone.screenshot({ path: join(generated, "home-phone.png") });
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await phone.close();
  assert.deepEqual(errors, []);
  console.log(
    "Shell render checks passed: Home/Board/Crew/office Deck, light/dark, phone, workspace routing, adoption guard, attention, canvas teardown.",
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
