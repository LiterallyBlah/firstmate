/** Browser integration: actual FleetSurface, cards, drawer and composer; synthetic host, no daemon. */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const rootRequire = createRequire(resolve(root, "package.json"));
const fixtureRequire = createRequire(resolve(here, "../board-list/package.json"));
const { build } = fixtureRequire("esbuild");
const { chromium } = fixtureRequire("playwright");
const generated = resolve(here, ".generated");
await mkdir(generated, { recursive: true });
await build({
  entryPoints: [resolve(here, "panel.jsx")], outfile: resolve(generated, "panel.js"),
  bundle: true, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning",
  plugins: [{ name: "isolated-host", setup(builder) {
    builder.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(here, "../board-list/contracts.js") }));
    builder.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, "stubs.jsx") }));
    builder.onResolve({ filter: /^react($|\/)/ }, (args) => ({ path: rootRequire.resolve(args.path) }));
    builder.onResolve({ filter: /^react-dom($|\/)/ }, (args) => ({ path: fixtureRequire.resolve(args.path) }));
    builder.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: fixtureRequire.resolve("react-native-web") }));
  } }],
});
const server = createServer(async (request, response) => {
  const bundle = request.url === "/panel.js";
  response.setHeader("Content-Type", bundle ? "application/javascript" : "text/html");
  response.end(bundle ? await readFile(resolve(generated, "panel.js")) : '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:Segoe UI,sans-serif}*{box-sizing:border-box}</style></head><body><div id="root"></div><script src="/panel.js"></script></body></html>');
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [], errors = [];
let page;
const sent = (page) => page.evaluate(() => window.fixtureCalls.filter((call) => call.name === "firstmate.item.discuss"));
const open = (page) => page.getByRole("button", { name: "Converse with Queue the next frontend task", exact: true }).click();
try {
  for (const width of [1440, 900, 390]) for (const theme of ["light", "dark"]) for (const view of ["list", "board"]) {
    const name = `${view}-${width}-${theme}`;
    page = await browser.newPage({ viewport: { width, height: 960 } });
    page.setDefaultTimeout(10000);
    page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
    await page.goto(`${url}/?theme=${theme}&view=${view}`);
    await page.getByRole("button", { name: "Refresh", exact: true }).waitFor();
    if (view === "list") await page.getByRole("button", { name: "1 done. Show completed tasks" }).click();
    assert.equal(await page.getByRole("button", { name: /^Converse with / }).count(), 5);
    await open(page);
    const composer = page.getByRole("textbox", { name: "To: first mate · discussion about this item", exact: true });
    await composer.waitFor();
    assert.equal((await sent(page)).length, 0);
    await composer.fill("Could we start with a small prototype?");
    if (width >= 600) await composer.press("Enter");
    else await page.getByRole("button", { name: "Send to first mate", exact: true }).click();
    await page.getByText("Scoped first-mate reply to: Could we start with a small prototype?", { exact: true }).waitFor();
    assert.equal((await sent(page))[0].input.kind, "discuss");
    await page.screenshot({ path: resolve(here, `${name}.png`) });
    await composer.fill("Draft stays on this item");
    assert.equal(await page.getByRole("button", { name: "Start work…", exact: true }).isDisabled(), true);
    await composer.press("Escape");
    await open(page);
    assert.equal(await composer.inputValue(), "Draft stays on this item");
    await composer.fill("");
    await page.getByRole("button", { name: "Start work…", exact: true }).click();
    assert.equal((await sent(page)).length, 1);
    await page.getByRole("button", { name: "Keep discussing", exact: true }).click();
    assert.equal((await sent(page)).length, 1);
    await page.getByRole("button", { name: "Start work…", exact: true }).click();
    await page.getByRole("button", { name: "Request dispatch", exact: true }).click();
    await page.getByText(/Work requested · the first mate owns dispatch/).waitFor();
    assert.equal((await sent(page)).filter((entry) => entry.input.kind === "graduate").length, 1);
    assert.equal(await page.getByRole("button", { name: "Start work…", exact: true }).count(), 0);
    await page.evaluate(() => window.fixtureAttachWorker());
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.getByRole("tab", { name: "Worker", exact: true }).waitFor();
    assert.equal(await page.getByRole("tab", { name: "Item discussion", exact: true }).getAttribute("aria-selected"), "true");
    await composer.fill("Discussion draft");
    await page.getByRole("tab", { name: "Worker", exact: true }).click();
    const workerComposer = page.getByRole("textbox", { name: /^To: .* worker/ });
    assert.equal(await workerComposer.inputValue(), "");
    await workerComposer.fill("Worker draft");
    await page.getByRole("tab", { name: "Item discussion", exact: true }).click();
    assert.equal(await composer.inputValue(), "Discussion draft");
    await composer.fill("");
    await composer.press("Escape");
    await page.getByRole("button", { name: "Converse with Polish item tags", exact: true }).click();
    await page.getByRole("button", { name: "Send to worker", exact: true }).waitFor();
    await page.getByRole("textbox", { name: /^To: .* worker/ }).fill("Keep phase one");
    await page.getByRole("button", { name: "Send to worker", exact: true }).click();
    assert(await page.evaluate(() => window.fixtureCalls.some((call) => call.name === "firstmate.crew.steer" && call.input.text === "Keep phase one")));
    await page.getByRole("textbox", { name: /^To: .* worker/ }).press("Escape");
    await page.getByRole("button", { name: "Converse with Review remote dashboard", exact: true }).click();
    await page.getByRole("textbox", { name: /^To: .* on / }).fill("Remote phase one");
    await page.getByRole("button", { name: "Send to worker", exact: true }).click();
    assert(await page.evaluate(() => window.fixtureCalls.some((call) => call.name === "firstmate.remote-crew.steer" && call.input.text === "Remote phase one")));
    await page.reload();
    await open(page);
    await page.getByText("Scoped first-mate reply to: Could we start with a small prototype?", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    assert.deepEqual(await page.evaluate(() => window.fixtureErrors), []);
    results.push({ name, passed: true, checks: "universal icons; no send on open; scoped reply; draft; cancel and explicit graduation; single request; phase-1 steer; reload persistence; no horizontal overflow" });
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(here, "verification.json"), JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify(results));
} catch (error) {
  await page?.screenshot({ path: resolve(here, "failed.png") });
  console.error(errors);
  throw error;
} finally { await browser.close(); server.close(); }
