/** Host APIs are fixtures. Real views, registration, scene engine, pack reads and native-web UI. No daemon. */
import { execFileSync } from "node:child_process";
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
const phase = process.argv[2] ?? "after";
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
        if (phase === "before") builder.onLoad({ filter: /client[\\/].*\.tsx?$/ }, args => ({ contents: execFileSync("git", ["show", `b1458b4:client/${args.path.split(/[\\/]/).at(-1)}`], {cwd: root, encoding: "utf8"}), loader: args.path.endsWith("tsx") ? "tsx" : "ts", resolveDir: dirname(args.path) }));
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
    if (request.url === "/preview") { response.end((await readFile(join(root, "docs/ship-deck-replies/still-a.png"))).toString("base64"));
    } else if (request.url.startsWith("/rpc/")) {
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
let page;
const results = [];
try {
  for (const [name, width, route] of [["wide", 1440, "?view=deck"], ["narrow", 650, "?view=deck"], ["phone", 390, "?"], ["list", 1440, "?view=crew"], ["board", 1440, "?view=board"]]) {
    for (const theme of ["light", "dark"]) {
      page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
      page.setDefaultTimeout(15000);
      page.on("pageerror", e => errors.push(e.message));
      await page.goto(`${url}/${route}${theme === "light" ? "&light" : ""}`);
      const deck = !["list", "board"].includes(name);
      if (name === "phone") await page.getByRole("tab", { name: "Deck", exact: true }).click();
      const focus = page.getByTestId("firstmate-deck-focus");
      if (deck) {
        await waitForDeck(page);
        await canvas(page).evaluate(node => { window.originalCanvas = node; node.parentElement.focus(); });
        await page.keyboard.press("ArrowRight");
        await focus.waitFor();
        await page.screenshot({ path: join(here, `${phase}-${name}-${theme}-focus.png`) });
        await focus.getByRole("button", { name: "Converse", exact: true }).click();
      } else await page.getByRole("button", { name: "Converse with Polish the crew conversation", exact: true }).click();
      const input = page.getByRole("textbox", { name: /^To: .* worker/ });
      await input.waitFor();
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(here, `${phase}-${name}-${theme}-conversation.png`) });
      if (phase === "before") { await page.close(); continue; }
      const sameCanvas = async () => assert(await page.evaluate(() => window.originalCanvas === document.querySelector("canvas[data-firstmate-deck]")), "same live canvas, no remount");
      if (deck) {
        await sameCanvas();
        const bounds = await canvas(page).boundingBox();
        const drawer = await page.getByRole("complementary").boundingBox();
        if (name === "wide") assert(bounds.x + bounds.width <= drawer.x + 1, "conversation docks beside visible deck");
        else {
          assert(bounds.x < drawer.x + drawer.width && bounds.x + bounds.width > drawer.x, "narrow conversation overlays scene");
          assert(await canvas(page).evaluate(node => !!node.closest('[inert]')), "covered scene is keyboard inert");
        }
        if (name === "wide") {
          await input.fill("Resize keeps this draft");
          await page.setViewportSize({ width: 650, height: 900 });
          await page.getByRole("button", { name: "Deck", exact: true }).waitFor();
          await sameCanvas();
          assert.equal(await input.inputValue(), "Resize keeps this draft");
          await page.setViewportSize({ width, height: 900 });
          await page.getByRole("button", { name: "Close the conversation", exact: true }).waitFor();
          await sameCanvas();
          await input.fill("");
          await page.emulateMedia({ reducedMotion: "no-preference" });
          const first = await canvas(page).screenshot();
          await page.waitForTimeout(900);
          assert(!first.equals(await canvas(page).screenshot()), "deck continues animating beside conversation");
          await page.emulateMedia({ reducedMotion: "reduce" });
        }
      }
      // Real shared composer, growing and shrinking with wrapping and explicit newlines.
      const height = (await input.boundingBox()).height;
      assert(height <= 42);
      await input.fill("One\nTwo\nThree\nFour");
      assert((await input.boundingBox()).height > height);
      await input.fill("Long wrapping draft ".repeat(100));
      assert.equal((await input.boundingBox()).height, 160);
      await input.fill("");
      assert.equal((await input.boundingBox()).height, height);
      await page.getByRole("button", { name: "Load earlier messages", exact: true }).click();
      await page.getByText("Earlier: keep the scene mounted while the conversation opens.", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Copy code", exact: true }).click();
      assert.equal(await page.evaluate(() => window.copiedText.trim()), "const docked = drawerDocks(width);");
      await page.getByRole("button", { name: "Copy message", exact: true }).first().click();
      assert((await page.evaluate(() => window.copiedText)).length > 0);
      await page.getByRole("button", { name: "Enlarge worker preview", exact: true }).waitFor();
      assert(await page.evaluate(() => window.fixtureCalls.some(c => c.name === "firstmate.images.read" && c.input.root.workspaceId === "worker-space" && c.input.path === "preview.png")));
      await page.getByRole("tab", { name: "Activity", exact: true }).click();
      await page.getByRole("tab", { name: "Conversation", exact: true }).click();
      await input.fill("Keep the deck visible");
      await page.getByRole("button", { name: "Send to worker", exact: true }).click();
      await page.waitForFunction(() => window.fixtureCalls.some(c => c.name === "firstmate.crew.steer" && c.input.text === "Keep the deck visible"));
      await page.getByRole("button", { name: "Open in its own tab", exact: true }).click();
      assert.equal(await page.evaluate(() => window.navigationCalls.at(-1).agent.agentId), "conversation-worker");
      if (deck) await sameCanvas();
      await page.evaluate(() => { window.showPermission = true; window.updateTimeline(); });
      await page.getByRole("button", { name: "Allow", exact: true }).click();
      assert(await page.evaluate(() => window.fixtureCalls.some(c => c.name === "permission" && c.input.agentId === "conversation-worker")));
      await input.fill("Saved worker draft");
      await input.press("Escape");
      await page.getByRole("complementary").waitFor({ state: "detached" });
      if (deck) {
        await sameCanvas();
        await focus.waitFor();
        assert((await focus.innerText()).includes("Polish the crew conversation"), "focused sailor survives close");
        await page.screenshot({ path: join(here, `${phase}-${name}-${theme}-back.png`) });
        await focus.getByRole("button", { name: "Steer", exact: true }).click();
        assert.equal(await input.inputValue(), "Saved worker draft");
        await sameCanvas();
        await page.getByRole("button", { name: name === "wide" ? "Close the conversation" : "Deck", exact: true }).click();
        await focus.getByRole("button", { name: "Interrupt", exact: true }).click();
        await page.waitForFunction(() => window.fixtureCalls.some(c => c.name === "firstmate.crew.interrupt"));
        await sameCanvas();
        await focus.getByRole("button", { name: "Relaunch", exact: true }).click();
        await focus.getByRole("textbox").fill("Keep the verified layout and continue");
        await page.screenshot({ path: join(here, `${phase}-${name}-${theme}-relaunch.png`) });
        await focus.getByRole("button", { name: "Relaunch", exact: true }).last().click();
        await page.waitForFunction(() => window.fixtureCalls.some(c => c.name === "firstmate.crew.relaunch"));
        await sameCanvas();
        await focus.getByRole("button", { name: "End", exact: true }).click();
        await page.screenshot({ path: join(here, `${phase}-${name}-${theme}-end.png`) });
        await focus.getByRole("button", { name: "End it", exact: true }).click();
        await page.waitForFunction(() => window.fixtureCalls.some(c => c.name === "firstmate.crew.exit"));
        await sameCanvas();
        assert.equal(await page.evaluate(() => window.navigationCalls.length), 1, "only explicit own-tab action navigates");
      } else {
        await page.getByRole("button", { name: "Converse with Remote review", exact: true }).click();
        await page.getByText("Worker log: completing the chapter controls", { exact: true }).waitFor();
        await page.getByRole("textbox", { name: /^To: .* on / }).fill("Continue remote review");
        await page.getByRole("button", { name: "Send to worker", exact: true }).click();
        await page.waitForFunction(() => window.fixtureCalls.some(c => c.name === "firstmate.remote-crew.steer"));
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      assert.deepEqual(await page.evaluate(() => window.fixtureErrors), []);
      results.push({ name, theme, passed: true });
      await page.close();
    }
  }
  assert.deepEqual(errors, []);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(here, `${phase}-results.json`), JSON.stringify({ results, errors }, null, 2) + "\n");
  console.log(JSON.stringify({ results, errors }));
} catch (error) {
  await page?.screenshot({ path: join(here, "failed.png") });
  console.error(errors);
  throw error;
} finally { await browser.close(); server.close(); }

