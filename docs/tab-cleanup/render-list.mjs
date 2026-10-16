/** Home List/Board regression replay. Synthetic host APIs, no daemon or deck canvas. */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url)),
  root = resolve(here, "../..");
const harness = createRequire(join(root, "docs/board-list/package.json"));
const rootRequire = createRequire(join(root, "package.json"));
const { build } = harness("esbuild"),
  { chromium } = harness("playwright");
const generated = join(here, ".generated/list");
await mkdir(generated, { recursive: true });
await build({
  entryPoints: [join(root, "docs/shell-phase1/panel.jsx")],
  outfile: join(generated, "list.js"),
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
  if (request.url === "/list.js") {
    response.setHeader("Content-Type", "application/javascript");
    response.end(await readFile(join(generated, request.url.slice(1))));
  } else {
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:Segoe UI,sans-serif}#root{display:flex;flex-direction:column}*{box-sizing:border-box}</style><div id="root"></div><script src="/list.js"></script>',
    );
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [],
  results = [];
const tab = (page, name) => page.getByRole("tab", { name, exact: true });
const button = (page, name) => page.getByRole("button", { name, exact: true });
const rows = (page) => page.getByRole("button", { name: /Show details and actions$/ });
const remoteTitle = "Build the chapter-craft plan: chapter styles, pacing and introductions";
try {
  for (const width of [1440, 900, 390])
    for (const light of [false, true]) {
      const page = await browser.newPage({
        viewport: { width, height: width === 390 ? 844 : 1000 },
        reducedMotion: "reduce",
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.clock.setFixedTime(new Date("2026-10-16T09:00:00Z"));
      await page.goto(`${url}/after?${light ? "light=1&" : ""}desktop=1`);
      await tab(page, "List").waitFor();
      if (width === 390) await tab(page, "List").click();
      const list = page.getByTestId("firstmate-task-list");
      await list.waitFor();
      assert.equal(await tab(page, "List").getAttribute("aria-selected"), "true");
      assert.equal(await rows(page).count(), 15);
      const headerHeight = (await page.locator("#firstmate-home-header").boundingBox()).height;
      assert.ok(headerHeight <= (width === 390 ? 179 : 85), "List access must not add another header row");
      await page.screenshot({ path: join(generated, `list-${width}-${light ? "light" : "dark"}.png`) });
      assert.equal(
        await list.evaluate(
          (el) =>
            [...el.querySelectorAll("*")].filter(
              (node) =>
                ["auto", "scroll"].includes(getComputedStyle(node).overflowY) &&
                node.scrollHeight > node.clientHeight + 1,
            ).length,
        ),
        0,
      );
      await button(page, "30 done. Show completed tasks").click();
      assert.equal(await rows(page).count(), 45);
      await button(page, "30 done. Hide completed tasks").click();

      // The toggle only changes presentation: it must not navigate, send or lose filters.
      await tab(page, "Board").focus();
      await page.keyboard.press("Enter");
      await page.getByTestId("firstmate-board").waitFor();
      assert.equal(await tab(page, "Board").getAttribute("aria-selected"), "true");
      await page.screenshot({ path: join(generated, `board-${width}-${light ? "light" : "dark"}.png`) });
      assert.deepEqual(await page.evaluate(() => window.navigationCalls), []);
      await page.waitForFunction(() => window.fixtureSettings?.crewView === "board");
      await page.reload();
      await tab(page, "Board").waitFor();
      if (width === 390) await tab(page, "Board").click();
      await page.getByTestId("firstmate-board").waitFor();
      assert.equal(await tab(page, "Board").getAttribute("aria-selected"), "true");
      await tab(page, "List").click();
      await list.waitFor();
      await page.getByRole("checkbox", { name: "Filter tag layout, 2 items", exact: true }).click();
      assert.equal(await rows(page).count(), 2);
      await tab(page, "Board").click();
      assert.equal(await rows(page).count(), 2);
      assert.equal(
        await page
          .getByRole("checkbox", { name: "Filter tag layout, 2 items", exact: true })
          .getAttribute("aria-checked"),
        "true",
      );
      await button(page, "Clear tag filters").click();
      await page.getByRole("tab", { name: "Light, online, 6 working, 0 need attention", exact: true }).click();
      assert.equal(await rows(page).count(), 9);
      await tab(page, "List").click();
      assert.equal(await rows(page).count(), 9);
      await page.getByRole("tab", { name: "All, 6 working, 4 need attention", exact: true }).click();
      assert.equal(await rows(page).count(), 15);

      // An open conversation and draft survive switching layouts in the same Home pane.
      await button(page, `Converse with ${remoteTitle}`).click();
      const composer = page.getByRole("textbox", { name: /^To: .* on / });
      await composer.fill("Keep this draft while switching views");
      await tab(page, "Board").click();
      assert.equal(await composer.inputValue(), "Keep this draft while switching views");
      await tab(page, "List").click();
      assert.equal(await composer.inputValue(), "Keep this draft while switching views");
      await button(page, "Send to worker").click();
      assert.ok(
        await page.evaluate(() =>
          window.fixtureCalls.some(
            (call) =>
              call.name === "firstmate.remote-crew.steer" &&
              call.input.agentId === "work-0" &&
              call.input.serverId === "sample-light" &&
              call.input.text === "Keep this draft while switching views",
          ),
        ),
      );
      await composer.press("Escape");
      await list.waitFor();

      const local = page.getByRole("button", { name: /Install the merged board changes.*Show details/ });
      await local.focus();
      await page.keyboard.press("Enter");
      await button(page, "Steer").click();
      await page.getByPlaceholder(/Tell the worker…/).fill("Check the local List view");
      await button(list, "Send").click();
      assert.ok(
        await page.evaluate(() =>
          window.fixtureCalls.some(
            (call) =>
              call.name === "firstmate.crew.steer" &&
              call.input.agentId === "block-0" &&
              call.input.text === "Check the local List view",
          ),
        ),
      );
      await page.getByRole("button", { name: /Install the merged board changes.*Hide details/ }).click();

      // Files and compact chat remain reachable. Returning to tasks preserves the view choice.
      await tab(page, width === 390 ? "Files" : "Home files").click();
      await page.getByText("This folder is empty.", { exact: true }).waitFor();
      await tab(page, "List").click();
      await list.waitFor();
      if (width === 390) {
        await tab(page, "First mate").click();
        await tab(page, "List").click();
        await list.waitFor();
      }
      await page.waitForFunction(() => JSON.parse(localStorage.getItem("firstmate-display")).crewView === "list");
      await button(page, "Open Board").click();
      await page.getByTestId("firstmate-board").waitFor();
      assert.equal(await list.count(), 0, "The dedicated Board keeps its own layout");
      await button(page, "FirstMate Home").click();
      if (width === 390) await tab(page, "List").click();
      await list.waitFor();
      await button(page, "Open Crew").click();
      await list.waitFor();
      assert.equal(await tab(page, "List").count(), 0, "Crew keeps its dedicated List destination");
      await button(page, "FirstMate Home").click();
      if (width === 390) await tab(page, "List").click();
      await list.waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(await page.evaluate(() => window.fixtureErrors), []);
      assert.equal(await page.locator("canvas").count(), 0);
      results.push({ width, theme: light ? "light" : "dark", headerHeight, passed: true });
      await page.close();
    }
  assert.deepEqual(errors, []);
  await writeFile(join(generated, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  server.close();
}
