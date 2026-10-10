/** Mount the real plugin UI with synthetic host APIs; never connects to a daemon. */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const harness = resolve(here, "../board-list");
const local = createRequire(resolve(harness, "package.json"));
const parent = createRequire(resolve(root, "package.json"));
const { build } = local("esbuild");
const { chromium } = local("playwright");
await mkdir(resolve(here, ".generated"), { recursive: true });
await build({
  entryPoints: [resolve(here, "panel.jsx")],
  outfile: resolve(here, ".generated/ui.js"),
  bundle: true,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "host-stubs",
      setup(builder) {
        builder.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(harness, "contracts.js") }));
        builder.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(harness, "stubs.jsx") }));
        builder.onResolve({ filter: /^react($|\/)/ }, (args) => ({ path: parent.resolve(args.path) }));
        builder.onResolve({ filter: /^react-dom($|\/)/ }, (args) => ({ path: local.resolve(args.path) }));
        builder.onResolve({ filter: /^react-native$/ }, () => ({ path: local.resolve("react-native-web") }));
      },
    },
  ],
});
const server = createServer(async (request, response) => {
  if (request.url === "/ui.js") {
    response.setHeader("Content-Type", "application/javascript");
    response.end(await readFile(resolve(here, ".generated/ui.js")));
  } else
    response.end(
      '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;font-family:Segoe UI,sans-serif}</style></head><body><div id="root"></div><script src="/ui.js"></script></body></html>',
    );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ channel: process.env.FM_TEST_BROWSER ?? "msedge", headless: true });
const errors = [];
try {
  for (const [name, width, height] of [
    ["wide", 1600, 1200],
    ["phone", 390, 844],
  ])
    for (const light of [false, true]) {
      const suffix = `${name}${light ? "-light" : ""}`;
      const page = await browser.newPage({ viewport: { width, height } });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/${light ? "?light" : ""}`);
      await page.getByRole("button", { name: "Switch provider/model", exact: true }).click();
      await page.getByText("Native conversation state and permissions do not transfer", { exact: false }).waitFor();
      await page.getByRole("button", { name: /^Target model:/ }).click();
      await page.getByRole("button", { name: "Claude Opus · claude", exact: true }).click();
      await page.getByLabel("Permission mode", { exact: true }).selectOption("bypassPermissions");
      await page.getByRole("button", { name: /^Target model:/ }).click();
      await page.getByRole("button", { name: "GPT · codex", exact: true }).click();
      assert.equal(await page.getByLabel("Permission mode", { exact: true }).inputValue(), "");
      await page.getByLabel("Permission mode", { exact: true }).selectOption("safe");
      await page.getByLabel("Thinking", { exact: true }).selectOption("high");
      await page.screenshot({ path: resolve(here, `selection-${suffix}.png`) });
      await page.evaluate(() => {
        window.fixtureFailMigration = true;
      });
      await page.getByRole("button", { name: "Transfer role", exact: true }).click();
      await page.getByText("Saved target: codex/gpt", { exact: false }).waitFor();
      await page.screenshot({ path: resolve(here, `recovery-${suffix}.png`) });
      await page.getByRole("button", { name: "Open source conversation", exact: true }).click();
      assert.equal(await page.evaluate(() => window.fixtureOpenedAgents.length), 1);
      await page.evaluate(() => {
        window.fixtureFailMigration = false;
      });
      await page.getByRole("button", { name: "Recover migration", exact: true }).last().click();
      await page.waitForFunction(
        () => window.fixtureCalls.filter((entry) => entry.name === "firstmate.mate.migrate").length === 2,
      );
      const calls = await page.evaluate(() =>
        window.fixtureCalls.filter((entry) => entry.name === "firstmate.mate.migrate"),
      );
      assert.deepEqual(calls[0].input.target, { provider: "codex/gpt", modeId: "safe", thinkingOptionId: "high" });
      assert.equal(calls[1].input.target, undefined);
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Switch provider/model", exact: true }).click();
      await page.getByRole("button", { name: /^Previous conversation/ }).click();
      assert.equal(await page.evaluate(() => window.fixtureOpenedAgents.length), 2);
      await page.close();
    }
  for (const name of ["running", "initializing"]) {
    const page = await browser.newPage();
    await page.addInitScript((status) => {
      window.fixtureMateStatus = status;
    }, name);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole("button", { name: "Switch provider/model", exact: true }).click();
    await page.getByText("Wait until the first mate is idle", { exact: false }).waitFor();
    assert(await page.getByRole("button", { name: "Transfer role", exact: true }).isDisabled());
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "Migration UI: desktop/phone in two themes, permission reset, thinking, failure/recovery, conversation links and busy refusal passed.",
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
