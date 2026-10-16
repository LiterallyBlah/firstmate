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
const generated = join(here, ".generated/density");
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
              (await readFile(args.path, "utf8")).replace(
                "const screens = new Map()",
                "window.fixtureTheme = theme;\nconst screens = new Map()",
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
                contents: execFileSync("git", ["show", `c04f35e:${path}`], { cwd: root, encoding: "utf8" }),
                loader: path.endsWith("tsx") ? "tsx" : "ts",
                resolveDir: dirname(args.path),
              };
            });
          builder.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({
            path: join(root, "docs/board-list/contracts.js"),
          }));
          builder.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: join(here, "density-stubs.jsx") }));
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
const rows = (page) => page.getByRole("button", { name: /Show details and actions$/ });
const open = async (page, label, title) => {
  await button(page, label).focus();
  await page.keyboard.press("Enter");
  await dialog(page, title).waitFor();
};
const close = async (page, title, label) => {
  await page.keyboard.press("Escape");
  await dialog(page, title).waitFor({ state: "hidden" });
  assert.equal(await button(page, label).evaluate((node) => node === document.activeElement), true);
};
try {
  for (const width of [1440, 900, 390])
    for (const light of [false, true]) {
      const heights = {};
      for (const mode of ["before", "after"]) {
        const page = await browser.newPage({
          viewport: { width, height: width === 390 ? 844 : 1000 },
          reducedMotion: "reduce",
        });
        page.on("pageerror", (error) => errors.push(error.message));
        await page.clock.setFixedTime(new Date("2026-10-16T09:00:00Z"));
        await page.goto(url + "/" + mode + "?desktop=1" + (light ? "&light=1" : ""));
        await tab(page, "List").waitFor();
        if (width === 390) await tab(page, "List").click();
        const list = page.getByTestId("firstmate-task-list");
        await list.waitFor();
        // Wait for wrapped tags to finish measuring in the old pane.
        if (mode === "before") await button(page, "Show more tag filters").waitFor();
        heights[mode] = (await list.boundingBox()).height;
        assert.equal(await rows(page).count(), 15);
        await page.mouse.move(0, 0);
        await page.screenshot({
          path: join(generated, "density-" + mode + "-" + width + "-" + (light ? "light" : "dark") + ".png"),
        });
        if (mode === "after") {
          const toolbar = page.getByTestId("firstmate-task-toolbar");
          const height = (await toolbar.boundingBox()).height;
          assert.ok(height <= 77, "At most two compact rows on narrow panes");
          // All controls are keyboard reachable, dismissed with Escape, and return focus.
          await open(page, "Machines: All machines", "Machines");
          await button(page, "Light, online, 6 working, 0 need attention").click();
          await button(page, "Machines: Light").waitFor();
          assert.equal(await rows(page).count(), 9);
          await open(page, "Machines: Light", "Machines");
          assert.equal(
            await button(page, "Light, online, 6 working, 0 need attention").getAttribute("aria-pressed"),
            "true",
          );
          await page.getByRole("button", { name: /^Light.*Show host details$/ }).click();
          await page.getByText(/6 projects.*14 workspaces.*6 providers/).waitFor();
          await close(page, "Machines", "Machines: Light");
          await tab(page, "Board").click();
          await page.getByTestId("firstmate-board").waitFor();
          assert.equal(await rows(page).count(), 9);
          await open(page, "Machines: Light", "Machines");
          await button(page, "All machines, 6 working, 4 need attention").click();
          await tab(page, "List").click();
          assert.equal(await rows(page).count(), 15);
          await open(page, "Filter tags (0 selected)", "Filter tags");
          const tags = dialog(page, "Filter tags");
          await tags.getByRole("checkbox", { name: "Filter tag layout, 2 items", exact: true }).focus();
          await page.keyboard.press("Space");
          await button(page, "Filter tags (1 selected)").waitFor();
          await button(tags, "Show more tag filters").click();
          await tags.getByRole("checkbox", { name: "Filter tag review-45, 1 items", exact: true }).waitFor();
          await close(page, "Filter tags", "Filter tags (1 selected)");
          assert.equal(await rows(page).count(), 2);
          await tab(page, "Board").click();
          assert.equal(await rows(page).count(), 2);
          await page.screenshot({
            path: join(generated, "density-board-" + width + "-" + (light ? "light" : "dark") + ".png"),
          });
          await page.waitForFunction(() => {
            const saved = JSON.parse(localStorage.getItem("firstmate-display"));
            return saved?.crewView === "board" && saved?.tagFilter?.includes("layout");
          });
          await page.reload();
          await tab(page, "Board").waitFor();
          if (width === 390) await tab(page, "Board").click();
          await button(page, "Filter tags (1 selected)").waitFor();
          assert.equal(await rows(page).count(), 2);
          await open(page, "Filter tags (1 selected)", "Filter tags");
          await button(tags, "Clear tag filters").click();
          await close(page, "Filter tags", "Filter tags (0 selected)");
          await tab(page, "List").click();
          assert.equal(await rows(page).count(), 15);
          await open(page, "Suggestions (2)", "Suggestions");
          await button(page, "Show the whole suggestion: Update the FirstMate panel").click();
          await dialog(page, "Suggestions")
            .getByText(await page.evaluate(() => window.densityPrompt), { exact: true })
            .waitFor();
          await page.screenshot({
            path: join(generated, "density-suggestions-" + width + "-" + (light ? "light" : "dark") + ".png"),
          });
          assert.equal(
            await page.evaluate(() => window.fixtureCalls.filter((call) => call.name === "firstmate.mate.ask").length),
            0,
          );
          await button(page, "Remove suggestion: Speed: lasting fix and checks").click();
          await button(page, "Suggestions (1)").waitFor();
          assert.equal(
            await page.evaluate(() => window.fixtureCalls.filter((call) => call.name === "firstmate.mate.ask").length),
            0,
          );
          await close(page, "Suggestions", "Suggestions (1)");
          await open(page, "Suggestions (1)", "Suggestions");
          await page.getByRole("button", { name: /^Update the FirstMate panel: send/ }).click();
          await dialog(page, "Suggestions").waitFor({ state: "hidden" });
          await page.waitForFunction(() => window.fixtureCalls.some((call) => call.name === "firstmate.mate.ask"));
          assert.equal(
            await page.evaluate(() => window.fixtureCalls.filter((call) => call.name === "firstmate.mate.ask").length),
            1,
          );
          if (width === 390) {
            assert.equal(await tab(page, "First mate").getAttribute("aria-selected"), "true");
            await tab(page, "List").click();
          }
          await open(page, "Suggestions (1)", "Suggestions");
          await button(page, "Remove suggestion: Update the FirstMate panel").click();
          await dialog(page, "Suggestions").getByText("No suggestions right now.").waitFor();
          await close(page, "Suggestions", "Suggestions (0)");
          assert.equal((await toolbar.boundingBox()).height, height, "Counts and removal must not grow the toolbar");
          assert.deepEqual(await page.evaluate(() => window.fixtureErrors), []);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.equal(await page.locator("canvas").count(), 0);
        await page.close();
      }
      assert.ok(heights.after > heights.before + 80, "Tasks gain at least 80px vertically");
      results.push({
        width,
        theme: light ? "light" : "dark",
        listHeight: heights,
        gained: heights.after - heights.before,
      });
    }
  for (const scenario of ["empty", "offline"]) {
    const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
    page.on("pageerror", (error) => errors.push(error.message));
    if (scenario === "offline")
      await page.addInitScript(() =>
        localStorage.setItem("firstmate-display", JSON.stringify({ hostTab: "sample-light" })),
      );
    await page.goto(url + "/after?scenario=" + scenario);
    await tab(page, "List").waitFor();
    if (scenario === "empty") {
      assert.equal(await page.getByRole("button", { name: /^Machines:/ }).count(), 0);
      await open(page, "Filter tags (0 selected)", "Filter tags");
      await dialog(page, "Filter tags").getByText("No tags on the shown tasks.").waitFor();
      await close(page, "Filter tags", "Filter tags (0 selected)");
      await open(page, "Suggestions (0)", "Suggestions");
      await dialog(page, "Suggestions").getByText("No suggestions right now.").waitFor();
    } else {
      const label = "Machines: Light with a very long machine name, unreachable";
      await open(page, label, "Machines");
      await page.getByRole("button", { name: /^Light with.*Show host details$/ }).click();
      await page.getByText("Connection timed out", { exact: true }).waitFor();
      await page.getByText("Clock about 5 minutes ahead; card times corrected", { exact: true }).waitFor();
      await page.screenshot({ path: join(generated, "density-machines.png") });
      await close(page, "Machines", label);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(join(generated, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  server.close();
}
