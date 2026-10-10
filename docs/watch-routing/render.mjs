/** Real watch controls through react-native-web; synthetic RPCs; no daemon connection. */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../.."), harness = resolve(here, "../board-list");
const local = createRequire(resolve(harness, "package.json")), parent = createRequire(resolve(root, "package.json"));
const { build } = local("esbuild"), { chromium } = local("playwright");
await mkdir(resolve(here, ".generated"), { recursive: true });
await build({ entryPoints: [resolve(here, "panel.jsx")], outfile: resolve(here, ".generated/ui.js"), bundle: true, jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' }, plugins: [{ name: "host-stubs", setup(builder) {
    builder.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(harness, "contracts.js") }));
    builder.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, "stubs.jsx") }));
    builder.onResolve({ filter: /^react($|\/)/ }, (args) => ({ path: parent.resolve(args.path) }));
    builder.onResolve({ filter: /^react-dom($|\/)/ }, (args) => ({ path: local.resolve(args.path) }));
    builder.onResolve({ filter: /^react-native$/ }, () => ({ path: local.resolve("react-native-web") }));
  } }] });
const server = createServer(async (request, response) => {
  if (request.url === "/ui.js") { response.setHeader("Content-Type", "application/javascript"); response.end(await readFile(resolve(here, ".generated/ui.js"))); }
  else response.end('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body,#root{margin:0;width:100%;min-height:100%;font-family:Segoe UI,sans-serif}</style></head><body><div id="root"></div><script src="/ui.js"></script></body></html>');
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ channel: process.env.FM_TEST_BROWSER ?? "msedge", headless: true });
const errors = [];
try {
  for (const [name, width, height] of [["wide", 1200, 1000], ["phone", 390, 844]]) for (const light of [false, true]) {
    const suffix = `${name}${light ? "-light" : ""}`;
    const page = await browser.newPage({ viewport: { width, height } }); page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/${light ? "?light" : ""}`);
    await page.getByRole("button", { name: "Configure pr-watch", exact: true }).click();
    await page.getByText("Keeps the current session's reasoning", { exact: false }).waitFor();
    assert.equal(await page.getByLabel("Run in", { exact: true }).inputValue(), "current");
    await page.screenshot({ path: resolve(here, `current-${suffix}.png`) });
    await page.getByRole("button", { name: "Close", exact: true }).last().click();
    await page.getByRole("button", { name: "Add watch", exact: true }).click();
    await page.getByRole("button", { name: "Use Board review defaults", exact: true }).click();
    assert.equal(await page.getByLabel("Run in", { exact: true }).inputValue(), "new");
    assert.equal(await page.getByLabel("New-session reasoning", { exact: true }).inputValue(), "medium");
    assert.equal(await page.getByLabel("Notify first mate", { exact: true }).inputValue(), "actionable");
    await page.screenshot({ path: resolve(here, `board-review-${suffix}.png`) });
    if (name === "phone") {
      await page.getByRole("button", { name: "Save watch", exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(here, `board-review-${suffix}-bottom.png`) });
    }
    await page.getByLabel("Inspection brief", { exact: true }).fill("Edited Board review inspection brief");
    await page.getByRole("button", { name: "Save watch", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    const calls = await page.evaluate(() => window.watchCalls.filter((entry) => entry.name === "firstmate.watch.create"));
    assert.equal(calls.length, 1); assert.deepEqual([calls[0].input.executionSession, calls[0].input.newSessionReasoning, calls[0].input.notificationPolicy], ["new", "medium", "actionable"]);
    assert.equal(calls[0].input.prompt, "Edited Board review inspection brief");
    await page.getByRole("button", { name: "Reports for board-review", exact: true }).click();
    await page.getByText("No actionable changes", { exact: false }).waitFor();
    await page.screenshot({ path: resolve(here, `reports-${suffix}.png`) });
    await page.getByRole("button", { name: "Close", exact: true }).last().click();
    await page.getByRole("button", { name: "Configure board-review", exact: true }).click();
    await page.getByLabel("Notify first mate", { exact: true }).selectOption("never");
    await page.getByRole("button", { name: "Save watch", exact: true }).click();
    await page.waitForFunction(() => window.watchCalls.some((entry) => entry.name === "firstmate.watch.configure" && entry.input.notificationPolicy === "never"));
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log("Watch UI: desktop/phone, light/dark, current reasoning preservation, Board defaults, explicit create/config fields and retained report visibility passed. Fourteen screenshots captured, including phone save controls.");
} finally { await browser.close(); await new Promise((done) => server.close(done)); }
