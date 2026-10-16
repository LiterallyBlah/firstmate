/** Real Home components with fixture APIs. No live daemon or deck canvas. */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url)),
  root = resolve(here, "../..");
const harness = createRequire(join(root, "docs/board-list/package.json"));
const rootRequire = createRequire(join(root, "package.json"));
const { build } = harness("esbuild"),
  { chromium } = harness("playwright");
const generated = join(here, ".generated/mobile");
await mkdir(generated, { recursive: true });
for (const mode of ["before", "after"])
  await build({
    entryPoints: [join(root, "docs/shell-phase1/panel.jsx")],
    outfile: join(generated, `${mode}.js`),
    bundle: true,
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    logLevel: "warning",
    plugins: [
      {
        name: "host-fixture",
        setup(builder) {
          builder.onLoad({ filter: /shell-phase1[\\/]panel.jsx$/ }, async (args) => ({
            contents:
              (await readFile(args.path, "utf8"))
                .replace("const screens = new Map()", "window.fixtureTheme = theme;\nconst screens = new Map()")
                .replace(
                  "navigate({ id, ...options });",
                  'if (id !== "firstmate-deck") navigate({ id, ...options });',
                ) +
              '\nimport { bindSettingsOpener } from "../../client/fleet";\nbindSettingsOpener(id => window.navigationCalls.push({ settings: id }));',
            loader: "jsx",
            resolveDir: dirname(args.path),
          }));
          if (mode === "before")
            builder.onLoad({ filter: /\.(ts|tsx)$/ }, (args) => {
              const path = relative(root, args.path).split(sep).join("/");
              if (!/^(client|shared)\//.test(path)) return;
              return {
                contents: execFileSync("git", ["show", `d1e9d02:${path}`], { cwd: root, encoding: "utf8" }),
                loader: path.endsWith("tsx") ? "tsx" : "ts",
                resolveDir: dirname(args.path),
              };
            });
          builder.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({
            path: join(root, "docs/board-list/contracts.js"),
          }));
          builder.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: join(here, "list-stubs.jsx") }));
          builder.onResolve({ filter: /^(react|zod|@tanstack\/react-query)($|\/)/ }, (args) => ({
            path: rootRequire.resolve(args.path),
          }));
          builder.onResolve({ filter: /^react-dom($|\/)/ }, (args) => ({ path: harness.resolve(args.path) }));
          builder.onResolve({ filter: /^react-native(-web)?$/ }, () => ({ path: harness.resolve("react-native-web") }));
        },
      },
    ],
  });
const server = createServer(async (request, response) => {
  if (request.url === "/before.js" || request.url === "/after.js") {
    response.setHeader("Content-Type", "application/javascript");
    response.end(await readFile(join(generated, request.url.slice(1))));
  } else {
    response.setHeader("Content-Type", "text/html");
    const mode = request.url.startsWith("/before") ? "before" : "after";
    response.end(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:Segoe UI,sans-serif}#root{display:flex;flex-direction:column}*{box-sizing:border-box}</style><div id="root"></div><script src="/' +
        mode +
        '.js"></script>',
    );
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [],
  results = [];
const button = (page, name) => page.getByRole("button", { name, exact: true });
const dialog = (page, name) => page.getByRole("dialog", { name, exact: true });
const tab = (page, name) => page.getByRole("tab", { name, exact: true });
const open = async (page) => {
  await page.mouse.move(0, 0);
  await button(page, "Open").focus();
  await page.keyboard.press("Enter");
  await dialog(page, "FirstMate workspace").waitFor();
};
const close = async (page, name) => {
  await page.keyboard.press("Escape");
  await dialog(page, name).waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Open");
};
try {
  for (const width of [320, 390, 600, 900])
    for (const light of [false, true]) {
      const heights = {};
      for (const mode of ["before", "after"]) {
        const page = await browser.newPage({
          viewport: { width, height: width < 600 ? 844 : 1000 },
          reducedMotion: "reduce",
        });
        page.on("pageerror", (error) => errors.push(error.message));
        await page.clock.setFixedTime(new Date("2026-10-16T09:00:00Z"));
        await page.goto(url + "/" + mode + "?desktop=1" + (light ? "&light=1" : ""));
        const compact = width < 638;
        await button(page, mode === "after" && compact ? "Open" : "Open Crew").waitFor();
        await tab(page, compact ? "First mate" : "List").waitFor();
        if (compact) await tab(page, "List").click();
        await page.getByTestId("firstmate-task-list").waitFor();
        heights[mode] = (await page.locator("#firstmate-home-header").boundingBox()).height;
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.mouse.move(0, 843);
        await page.screenshot({
          path: join(generated, "mobile-" + mode + "-" + width + "-" + (light ? "light" : "dark") + ".png"),
        });
        assert.equal(
          await page.evaluate(() => window.fixtureCalls.filter((c) => c.name === "firstmate.native.terminal").length),
          0,
        );
        assert.deepEqual(await page.evaluate(() => window.navigationCalls), []);
        if (mode === "after" && compact) {
          assert.equal(await button(page, "Open Board").count(), 0);
          await open(page);
          for (const label of [
            "Open Deck",
            "Open Board",
            "Open Crew",
            "Shared terminal",
            "New browser",
            "Terminal & browser",
          ])
            await button(dialog(page, "FirstMate workspace"), label).waitFor();
          await page.mouse.move(0, 843);
          await page.screenshot({
            path: join(generated, "workspace-" + width + "-" + (light ? "light" : "dark") + ".png"),
          });
          await close(page, "FirstMate workspace");
          await open(page);
          await button(page, "Open Deck").click();
          await dialog(page, "FirstMate workspace").waitFor({ state: "hidden" });
          assert.deepEqual(await page.evaluate(() => window.navigationCalls.at(-1)), {
            id: "firstmate-deck",
            workspaceId: "sample",
            location: "workspace",
          });
          for (const view of ["Board", "Crew"]) {
            await open(page);
            await button(page, "Open " + view).click();
            await page.getByTestId(view === "Board" ? "firstmate-board" : "firstmate-task-list").waitFor();
            assert.deepEqual(await page.evaluate(() => window.navigationCalls.at(-1)), {
              id: "firstmate-" + view.toLowerCase(),
              workspaceId: "sample",
              location: "workspace",
            });
            await button(page, "FirstMate Home").click();
            await button(page, "Open").waitFor();
            if ((await tab(page, "List").getAttribute("aria-selected")) !== "true") await tab(page, "List").click();
          }
          await open(page);
          await button(page, "Terminal & browser").click();
          await dialog(page, "FirstMate workspace").waitFor({ state: "hidden" });
          assert.deepEqual(await page.evaluate(() => window.navigationCalls.at(-1)), {
            workspace: { workspaceId: "sample" },
          });
          // The sibling browser dialog closes the launcher first, and cancel returns focus.
          await open(page);
          await button(page, "New browser").click();
          await dialog(page, "New shared browser").waitFor();
          assert.equal(await page.getByRole("dialog").count(), 1);
          assert.equal(await button(page, "Create browser tab").isDisabled(), true);
          await page.getByRole("textbox", { name: "Browser URL", exact: true }).fill("javascript:alert(1)");
          assert.equal(await button(page, "Create browser tab").isDisabled(), true);
          await button(page, "Cancel").click();
          await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Open");
          assert.equal(await page.evaluate(() => window.navigationCalls.some((c) => c.browser)), false);
          await open(page);
          await button(page, "New browser").click();
          await page.getByRole("textbox", { name: "Browser URL", exact: true }).fill("http://localhost:3000");
          await page.evaluate(() => {
            window.browserFailure = true;
          });
          await button(page, "Create browser tab").click();
          await page.getByText("Browser host is unavailable", { exact: true }).waitFor();
          await page.evaluate(() => {
            window.browserFailure = false;
          });
          await button(page, "Create browser tab").click();
          await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Open");
          assert.deepEqual(await page.evaluate(() => window.navigationCalls.filter((c) => c.browser)), [
            { browser: { workspaceId: "sample", url: "http://localhost:3000/" } },
          ]);
          // Pending terminal work survives menu dismissal/reopen without duplicate requests.
          await page.evaluate(() => {
            window.terminalDelay = true;
          });
          await open(page);
          await button(page, "Shared terminal").click();
          await page.waitForFunction(() => window.finishTerminal !== undefined);
          await close(page, "FirstMate workspace");
          await open(page);
          assert.equal(await page.getByRole("button", { name: /^Preparing terminal/ }).isDisabled(), true);
          assert.equal(
            await page.evaluate(() => window.fixtureCalls.filter((c) => c.name === "firstmate.native.terminal").length),
            1,
          );
          await page.evaluate(() => window.finishTerminal());
          await dialog(page, "FirstMate workspace").waitFor({ state: "hidden" });
          assert.deepEqual(await page.evaluate(() => window.navigationCalls.at(-1)), {
            workspace: { workspaceId: "sample" },
          });
          await button(page, "More").click();
          await dialog(page, "FirstMate controls").waitFor();
          await page.keyboard.press("Escape");
          await tab(page, "Board").click();
          await page.getByTestId("firstmate-board").waitFor();
          await tab(page, "Files").click();
          await page.getByText("This folder is empty.", { exact: true }).waitFor();
          await tab(page, "First mate").click();
        } else if (mode === "after") {
          assert.equal(await button(page, "Open").count(), 0);
          for (const label of [
            "Open Deck",
            "Open Board",
            "Open Crew",
            "Shared terminal",
            "New browser",
            "Terminal & browser",
          ])
            await button(page, label).waitFor();
        }
        assert.equal(await page.locator("canvas").count(), 0);
        assert.deepEqual(await page.evaluate(() => window.fixtureErrors), []);
        await page.close();
      }
      if (width < 638) assert.ok(heights.after <= heights.before - 38, "Mobile shortcuts reclaim at least a row");
      else assert.equal(heights.after, heights.before, "Wide shortcut row retains its height");
      results.push({
        width,
        theme: light ? "light" : "dark",
        headerHeight: heights,
        saved: heights.before - heights.after,
      });
    }
  // Phone capability and unavailable home state, without desktop browser APIs.
  for (const adopted of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url + "/after" + (adopted ? "?adopted=1" : ""));
    await open(page);
    assert.equal(await button(page, "New browser").isDisabled(), true);
    assert.equal(await button(page, "Open Board").isDisabled(), adopted);
    assert.equal(await button(page, "Shared terminal").isDisabled(), adopted);
    if (adopted)
      await page.getByText("Launch a first mate in its home to open the workspace tabs.", { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.navigationCalls), []);
    await page.close();
  }
  // Resize across the compact breakpoint, and suppress navigation from an unmounted request.
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url + "/after?desktop=1");
  await button(page, "Open Crew").waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await close(page, "FirstMate workspace");
  await page.setViewportSize({ width: 900, height: 1000 });
  await button(page, "Open Crew").waitFor();
  assert.equal(await button(page, "Open").count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.evaluate(() => {
    window.terminalDelay = true;
  });
  await button(page, "Shared terminal").click();
  await page.waitForFunction(() => window.finishTerminal !== undefined);
  await page.mouse.move(0, 0);
  await button(page, "Open Crew").focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("firstmate-task-list").waitFor();
  await page.evaluate(() => window.finishTerminal());
  assert.equal(await page.evaluate(() => window.navigationCalls.some((c) => c.workspace)), false);
  await page.close();
  assert.deepEqual(errors, []);
  await writeFile(join(generated, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  server.close();
}
