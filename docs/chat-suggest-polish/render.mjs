import { execFileSync } from "node:child_process";
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
        builder.onLoad({ filter: /client[\\/]chat\.tsx$/ }, async (args) => ({
          contents:
            process.env.BEFORE === "1"
              ? execFileSync("git", ["show", "96d5914:client/chat.tsx"], {
                  encoding: "utf8",
                })
              : await readFile(args.path, "utf8"),
          loader: "tsx",
        }));
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
const stage = process.env.BEFORE === "1" ? "before" : "after";
try {
  for (const [name, width] of [
    ["narrow", 320],
    ["phone", 390],
    ["wide", 1000],
    ["side-panel", 1440],
  ]) {
    for (const light of [false, true]) {
      const page = await browser.newPage({
        viewport: { width, height: 844 },
        reducedMotion: "reduce",
      });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(
        url +
          (name === "side-panel" ? "?desktop=1" : "?view=chat") +
          (light ? "&light=1" : ""),
      );
      const input = page.getByPlaceholder("Tell the first mate", {
        exact: false,
      });
      await input.waitFor();
      await page.waitForTimeout(300);
      await page.screenshot({
        path: join(here, `${stage}-${name}-${light ? "light" : "dark"}.png`),
      });
      const size = await input.evaluate((el) => ({
        height: el.clientHeight,
        content: el.scrollHeight,
      }));
      if (stage === "after") {
        assert(
          size.content <= size.height + 1,
          `${name}: placeholder clipped ${JSON.stringify(size)}`,
        );
        await input.fill(
          "A long message that wraps across the composer. ".repeat(100),
        );
        const full = await input.evaluate((el) => ({
          height: el.clientHeight,
          content: el.scrollHeight,
        }));
        assert(
          full.height <= 160 && full.content > full.height,
          "long drafts scroll at the cap",
        );
        await input.fill("Short");
        assert((await input.boundingBox()).height <= 41, "short drafts shrink");
        await input.fill("");
        assert(
          (await input.boundingBox()).height >= size.height,
          "empty draft measures placeholder again",
        );
      }
      console.log(stage, name, light ? "light" : "dark", size);
      await page.close();
    }
  }
  if (stage === "after") {
    for (const light of [false, true]) {
      const page = await browser.newPage({
        viewport: { width: 1200, height: 900 },
        reducedMotion: "reduce",
      });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(url + "?view=deck" + (light ? "&light=1" : ""));
      await page
        .getByRole("button", { name: "Shark suggestions", exact: true })
        .click();
      const panel = page.getByRole("dialog", {
        name: "Shark suggestions",
        exact: true,
      });
      await panel.waitFor();
      const dismiss = panel.getByRole("button", {
        name: "Dismiss suggestion",
        exact: true,
      });
      const count = await dismiss.count();
      assert(count > 1);
      await page.screenshot({
        path: join(here, `shark-${light ? "light" : "dark"}-before.png`),
      });
      await page.evaluate(() => {
        window.delayRemoval = true;
      });
      await dismiss.first().click();
      assert(await dismiss.first().isDisabled());
      assert(
        await panel
          .getByRole("button", { name: /: send / })
          .first()
          .isDisabled(),
      );
      await page.evaluate(() => {
        window.delayRemoval = false;
        window.finishRemoval();
      });
      await page.waitForFunction(
        (n) =>
          document.querySelectorAll('[aria-label="Dismiss suggestion"]')
            .length === n,
        count - 1,
      );
      await page.screenshot({
        path: join(here, `shark-${light ? "light" : "dark"}-after.png`),
      });
      assert.equal(
        await page.evaluate(
          () =>
            window.fixtureCalls.filter((c) => c.name === "firstmate.mate.ask")
              .length,
        ),
        0,
      );
      await page.evaluate(() => {
        window.failRemoval = true;
      });
      await dismiss.first().click();
      await page.waitForFunction(() =>
        window.fixtureErrors.includes("Fixture removal failed"),
      );
      assert.equal(await dismiss.count(), count - 1);
      await page.evaluate(() => {
        window.failRemoval = false;
      });
      while (await dismiss.count()) {
        const n = await dismiss.count();
        await dismiss.first().click();
        await page.waitForFunction(
          (n) =>
            document.querySelectorAll('[aria-label="Dismiss suggestion"]')
              .length < n,
          n,
        );
      }
      await panel.getByText("Nothing to suggest right now.").waitFor();
      assert.equal(
        await page.evaluate(
          () =>
            window.fixtureCalls.filter((c) => c.name === "firstmate.mate.ask")
              .length,
        ),
        0,
      );
      await page.keyboard.press("Escape");
      assert.equal(await panel.count(), 0);
      await page.close();
    }
  }
  assert.deepEqual(errors, []);
  console.log("Composer and shark fixture checks passed");
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
