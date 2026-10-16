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
const generated = join(here, ".generated");
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
                contents: execFileSync("git", ["show", `6b11d4d:${path}`], { cwd: root, encoding: "utf8" }),
                loader: path.endsWith("tsx") ? "tsx" : "ts",
                resolveDir: dirname(args.path),
              };
            });
          builder.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({
            path: join(root, "docs/board-list/contracts.js"),
          }));
          builder.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: join(here, "header-stubs.jsx") }));
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
const menu = (page) => page.getByRole("dialog", { name: "FirstMate controls", exact: true });
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
        await page.clock.setFixedTime(new Date("2026-10-16T08:00:00Z"));
        await page.goto(`${url}/${mode}?${light ? "light=1&" : ""}desktop=1`);
        await button(page, mode === "after" && width === 390 ? "Open" : "Open Crew").waitFor();
        const header =
          mode === "after" ? page.locator("#firstmate-home-header") : button(page, "Open Crew").locator("../../../..");
        heights[mode] = (await header.boundingBox()).height;
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.mouse.move(0, 999);
        await page.screenshot({ path: join(generated, `header-${mode}-${width}-${light ? "light" : "dark"}.png`) });
        if (mode === "after") {
          assert.equal(await page.getByText(/Shared tools live in the workspace/).count(), 0);
          assert.equal(await button(page, "Switch provider/model").count(), 0);
          await button(page, "More").focus();
          await page.keyboard.press("Enter");
          await menu(page).waitFor();
          await menu(page).getByText("Home: C:/Sample/FirstMate", { exact: true }).waitFor();
          await page.screenshot({ path: join(generated, `more-${width}-${light ? "light" : "dark"}.png`) });
          await page.keyboard.press("Escape");
          await menu(page).waitFor({ state: "hidden" });
          assert.equal(await button(page, "More").evaluate((node) => node === document.activeElement), true);
          await button(page, "More").click();
          await button(page, "Switch provider/model").click();
          await page.getByRole("dialog", { name: "Transfer the first-mate role", exact: true }).waitFor();
          assert.equal(await menu(page).count(), 0);
          await page.keyboard.press("Escape");
          await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "More");
          await button(page, "More").click();
          await page.getByRole("button", { name: /^Watches/ }).click();
          await page.getByRole("dialog", { name: "Watches", exact: true }).waitFor();
          assert.equal(await menu(page).count(), 0);
          await page.keyboard.press("Escape");
          await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "More");
          await button(page, "More").click();
          await button(page, "Open the first mate in Paseo").click();
          assert.equal(await menu(page).count(), 0);
          assert.ok((await page.evaluate(() => window.navigationCalls.at(-1))).agent);
          await button(page, "More").click();
          await button(page, "FirstMate settings").click();
          assert.deepEqual(await page.evaluate(() => window.navigationCalls.at(-1)), { settings: "firstmate" });
          if (width >= 900) {
            await button(page, "More").click();
            await button(page, "Hide the chat").click();
            await page.waitForFunction(() => window.fixtureSettings?.chatCollapsed);
            await button(page, "More").click();
            await button(menu(page), "Show the chat").click();
            await page.waitForFunction(() => window.fixtureSettings?.chatCollapsed === false);
          }
          await button(page, "More").click();
          await button(page, "Update FirstMate to bbbbbbbb").click();
          await menu(page).waitFor({ state: "hidden" });
          assert.equal(
            await page.evaluate(() => window.fixtureCalls.filter((c) => c.name === "firstmate.update.request").length),
            1,
          );
          assert.equal(await page.locator("canvas").count(), 0);
        }
        await page.close();
      }
      assert.ok(heights.after < heights.before, `Header shrinks at ${width}: ${JSON.stringify(heights)}`);
      results.push({ width, theme: light ? "light" : "dark", ...heights });
    }
  assert.deepEqual(errors, []);
  await writeFile(join(generated, "header-results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  server.close();
}
