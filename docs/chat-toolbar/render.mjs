/** Real Chat panel and composer, synthetic host APIs; no installed plugin changes. */
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const here = dirname(fileURLToPath(import.meta.url)),
  root = resolve(here, "../..");
const harness = createRequire(join(root, "docs/board-list/package.json")),
  rootRequire = createRequire(join(root, "package.json"));
const { build } = harness("esbuild"),
  { chromium } = harness("playwright");
const phase = process.argv[2] ?? "after";
await mkdir(join(here, ".generated"), { recursive: true });
await build({
  entryPoints: [join(here, "panel.jsx")],
  outfile: join(here, ".generated/panel.js"),
  bundle: true,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "warning",
  plugins: [
    {
      name: "fixture",
      setup(b) {
        if (phase === "before")
          b.onLoad({ filter: /client[\\/](chat|mate-controls)\.tsx$/ }, (args) => ({
            contents: execFileSync("git", ["show", `47e305d:client/${args.path.split(/[\\/]/).at(-1)}`], {
              cwd: root,
              encoding: "utf8",
            }),
            loader: "tsx",
            resolveDir: dirname(args.path),
          }));
        b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: join(root, "docs/board-list/contracts.js") }));
        b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: join(here, "stubs.jsx") }));
        b.onResolve({ filter: /^(react|zod|@tanstack\/react-query)($|\/)/ }, (a) => ({
          path: rootRequire.resolve(a.path),
        }));
        b.onResolve({ filter: /^react-dom($|\/)/ }, (a) => ({ path: harness.resolve(a.path) }));
        b.onResolve({ filter: /^react-native(-web)?$/ }, () => ({ path: harness.resolve("react-native-web") }));
      },
    },
  ],
});
const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", req.url === "/panel.js" ? "application/javascript" : "text/html");
  res.end(
    req.url === "/panel.js"
      ? await readFile(join(here, ".generated/panel.js"))
      : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:Segoe UI,sans-serif}#root{display:flex;flex-direction:column}*{box-sizing:border-box}</style><div id="root"></div><script src="/panel.js"></script>',
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [];
try {
  for (const width of [360, 500, 800, 1100])
    for (const light of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height: 700 }, reducedMotion: "reduce" });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}?view=chat${light ? "&light=1" : ""}`);
      const input = page.locator("textarea");
      await input.waitFor();
      await page.waitForTimeout(350);
      await page.screenshot({ path: join(here, `${phase}-${width}-${light ? "light" : "dark"}.png`) });
      if (phase === "after") {
        const bearings = await page.getByRole("button", { name: "Bearings", exact: true }).boundingBox();
        const more = await page.getByRole("button", { name: "Session actions", exact: true }).boundingBox();
        assert(Math.abs(bearings.y + bearings.height / 2 - more.y - more.height / 2) < 1, "toolbar stays on one row");
        assert(more.x + more.width <= width, "toolbar stays inside pane");
        const empty = await input.boundingBox();
        assert(empty.height <= 44, "empty input is one line");
        await input.fill("First line\nSecond line\nThird line\nFourth line");
        await page.waitForTimeout(150);
        assert((await input.boundingBox()).height > empty.height, "input grows");
        await input.fill("A long line that should wrap as it is typed. ".repeat(30));
        await page.waitForTimeout(150);
        assert.equal((await input.boundingBox()).height, 160, "long drafts stop growing at the cap");
        await input.fill("");
        await page.waitForTimeout(150);
        assert.equal((await input.boundingBox()).height, empty.height, "input shrinks");
        await page.getByRole("button", { name: "Session actions", exact: true }).click();
        await page.getByRole("dialog", { name: "Session actions" }).waitFor();
        if (width === 500) await page.screenshot({ path: join(here, `overflow-${light ? "light" : "dark"}.png`) });
        await page.getByRole("button", { name: "Restart", exact: true }).click();
        await page.getByRole("dialog", { name: "Restart the first mate?" }).waitFor();
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        assert.equal(await page.getByRole("dialog").count(), 0);
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Session actions");
        await page.getByRole("button", { name: "Session actions", exact: true }).click();
        await page.getByRole("button", { name: "Full conversation", exact: true }).click();
        assert.equal(await page.evaluate(() => window.navigationCalls.at(-1).agent.agentId), "first-mate");
        await input.fill("Keyboard check");
        await input.press("Shift+Enter");
        assert.equal(await input.inputValue(), "Keyboard check\n");
        await input.press("Enter");
        await page.waitForTimeout(100);
        if (width >= 600) assert.equal(await input.inputValue(), "");
        else {
          assert.equal(await input.inputValue(), "Keyboard check\n\n", "compact Enter remains a newline");
          await page.getByRole("button", { name: "Send", exact: true }).click();
          assert.equal(await input.inputValue(), "");
        }
      }
      await page.close();
    }
  if (phase === "after") {
    // A narrow desktop split must use its measured width, not host compact mode.
    const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
    await page.goto(`http://127.0.0.1:${server.address().port}?view=chat&wideHost=1&running=1`);
    await page.locator("textarea").waitFor();
    for (const width of [500, 360, 240, 800]) {
      await page.setViewportSize({ width, height: 700 });
      await page.waitForTimeout(150);
      const buttons = page.getByRole("button", { name: "Bearings", exact: true });
      assert.equal(await buttons.innerText(), width >= 500 ? "Bearings" : "");
      const a = await buttons.boundingBox(),
        b = await page.getByRole("button", { name: "Session actions", exact: true }).boundingBox();
      assert(Math.abs(a.y + a.height / 2 - b.y - b.height / 2) < 1);
      assert(b.x + b.width <= width);
    }
    await page.getByRole("button", { name: "Session actions", exact: true }).click();
    assert(await page.getByRole("button", { name: "Compact", exact: true }).isDisabled());
    assert(await page.getByRole("button", { name: "Restart", exact: true }).isDisabled());
    await page.keyboard.press("Escape");
    await page.close();
    const home = await browser.newPage({ viewport: { width: 1100, height: 700 } });
    await home.goto(`http://127.0.0.1:${server.address().port}`);
    await home.locator("textarea").waitFor();
    await home.waitForTimeout(200);
    const left = await home.getByRole("button", { name: "Bearings", exact: true }).boundingBox();
    const right = await home.getByRole("button", { name: "Session actions", exact: true }).boundingBox();
    assert(Math.abs(left.y + left.height / 2 - right.y - right.height / 2) < 1, "Home chat uses one row");
    await home.screenshot({ path: join(here, "home-after-dark.png") });
    await home.close();
  }
  assert.deepEqual(errors, []);
  console.log(`${phase}: eight screenshots and layout checks passed`);
} finally {
  await browser.close();
  server.close();
}
