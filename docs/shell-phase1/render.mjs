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
  await phone.locator("canvas[data-firstmate-deck-setting=ship]").waitFor();
  assert.equal(await phone.locator("canvas").count(), 1);
  await phone.getByRole("button", { name: "FirstMate Home", exact: true }).click();
  assert.equal(await phone.getByRole("button", { name: "New browser", exact: true }).isDisabled(), true);
  await phone.mouse.move(0, 843);
  await phone.screenshot({ path: join(generated, "home-phone.png") });
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await phone.close();
  // Native API fixtures: creation is explicit, a request cannot steal navigation after leaving Home,
  // browser errors allow retry, and ordinary web/phone clients cannot create a browser.
  const native = await pageAt("?desktop=1");
  await native.getByRole("button", { name: "Shared terminal", exact: true }).waitFor();
  const terminalCalls = () =>
    native.evaluate(() => window.fixtureCalls.filter((call) => call.name === "firstmate.native.terminal"));
  assert.equal((await terminalCalls()).length, 0);
  assert.equal(await native.evaluate(() => window.navigationCalls.length), 0);
  await native.evaluate(() => {
    window.terminalDelay = true;
  });
  await native.getByRole("button", { name: "Shared terminal", exact: true }).click();
  assert.equal(await native.getByRole("button", { name: "Preparing terminal…", exact: true }).isDisabled(), true);
  assert.equal((await terminalCalls()).length, 1);
  await native.getByRole("button", { name: "Open Crew", exact: true }).click();
  await native.evaluate(() => window.finishTerminal());
  await native.getByRole("button", { name: "FirstMate Home", exact: true }).waitFor();
  assert.equal(await native.evaluate(() => window.navigationCalls.some((call) => call.workspace)), false);
  await native.getByRole("button", { name: "FirstMate Home", exact: true }).click();
  await native.evaluate(() => {
    window.terminalDelay = false;
    window.terminalFailure = true;
  });
  await native.getByRole("button", { name: "Shared terminal", exact: true }).click();
  await native.waitForFunction(() => window.fixtureErrors.includes("Terminal host is offline"));
  assert.equal(await native.evaluate(() => window.navigationCalls.some((call) => call.workspace)), false);
  await native.evaluate(() => {
    window.terminalFailure = false;
  });
  await native.getByRole("button", { name: "Shared terminal", exact: true }).click();
  await native.waitForFunction(() => window.navigationCalls.some((call) => call.workspace));
  assert.deepEqual(await native.evaluate(() => window.navigationCalls.at(-1)), {
    workspace: { workspaceId: "sample" },
  });
  assert.deepEqual((await terminalCalls()).at(-1).input, { workspaceId: "sample" });
  await native.getByRole("button", { name: "New browser", exact: true }).click();
  assert.equal(await native.getByRole("button", { name: "Create browser tab", exact: true }).isDisabled(), true);
  await native.getByRole("textbox", { name: "Browser URL" }).fill("javascript:alert(1)");
  assert.equal(await native.getByRole("button", { name: "Create browser tab", exact: true }).isDisabled(), true);
  await native.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await native.evaluate(() => window.navigationCalls.some((call) => call.browser)), false);
  await native.getByRole("button", { name: "New browser", exact: true }).click();
  await native.getByRole("textbox", { name: "Browser URL" }).fill("http://localhost:3000");
  await native.screenshot({ path: join(generated, "new-browser.png") });
  await native.evaluate(() => {
    window.browserFailure = true;
  });
  await native.getByRole("button", { name: "Create browser tab", exact: true }).click();
  await native.getByText("Browser host is unavailable", { exact: true }).waitFor();
  await native.evaluate(() => {
    window.browserFailure = false;
  });
  await native.getByRole("button", { name: "Create browser tab", exact: true }).click();
  assert.deepEqual(await native.evaluate(() => window.navigationCalls.filter((call) => call.browser)), [
    { browser: { workspaceId: "sample", url: "http://localhost:3000/" } },
  ]);
  await native.close();
  assert.deepEqual(errors, []);
  console.log(
    "Shell render checks passed: Home/Board/Crew/office Deck, themes/phone, routing/attention/teardown, explicit terminal/browser creation, unavailable/error/retry and no navigation after unmount.",
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
