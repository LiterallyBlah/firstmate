/** Run from the repo: node docs/board-list/render.mjs. Never connects to a daemon. */
import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const rootRequire = createRequire(resolve(root, "package.json"));
const localRequire = createRequire(resolve(here, "package.json"));
const generated = resolve(here, ".generated");
await mkdir(generated, { recursive: true });
const baseline = "6264aa7"; // main after PR #6, before this layout change
for (const mode of ["before", "after"]) {
  await build({
    entryPoints: [resolve(here, "panel.jsx")],
    outfile: resolve(generated, `${mode}.js`),
    bundle: true,
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [
      {
        name: "host-stubs-and-baseline",
        setup(builder) {
          builder.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({
            path: resolve(here, "contracts.js"),
          }));
          builder.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({
            path: resolve(here, "stubs.jsx"),
          }));
          builder.onResolve({ filter: /^react($|\/)/ }, (args) => ({
            path: rootRequire.resolve(args.path),
          }));
          builder.onResolve({ filter: /^react-dom($|\/)/ }, (args) => ({
            path: localRequire.resolve(args.path),
          }));
          builder.onResolve({ filter: /^react-native($|-web$)/ }, () => ({
            path: localRequire.resolve("react-native-web"),
          }));
          if (mode === "before")
            builder.onLoad({ filter: /\.(ts|tsx)$/ }, (args) => {
              const path = relative(root, args.path).split(sep).join("/");
              if (!/^(client|shared)\//.test(path)) return;
              return {
                contents: execFileSync("git", ["show", `${baseline}:${path}`], {
                  cwd: root,
                  encoding: "utf8",
                }),
                loader: path.endsWith("tsx") ? "tsx" : "ts",
                resolveDir: dirname(args.path),
              };
            });
        },
      },
    ],
    logLevel: "warning",
  });
}
const server = createServer(async (request, response) => {
  if (request.url === "/before.js" || request.url === "/after.js") {
    response.setHeader("Content-Type", "application/javascript");
    response.end(await readFile(resolve(generated, request.url.slice(1))));
    return;
  }
  const mode = request.url?.startsWith("/before") ? "before" : "after";
  response.setHeader("Content-Type", "text/html");
  response.end(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#181B1A}*{box-sizing:border-box}</style></head><body><div id="root"></div><script src="/${mode}.js"></script></body></html>`,
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [];
const errors = [];
try {
  for (const [name, mode, width, height, view] of [
    ["before-wide", "before", 2866, 1694, "board"],
    ["after-list-wide", "after", 2866, 1694, "list"],
    ["after-board-wide", "after", 2866, 1694, "board"],
    ["before-phone", "before", 390, 844, "board"],
    ["after-list-phone", "after", 390, 844, "list"],
    ["after-board-phone", "after", 390, 844, "board"],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
    await page.addInitScript(() => {
      Date.now = () => Date.parse("2026-10-08T12:00:00.000Z");
    });
    await page.goto(`${url}/${mode}`);
    await page.getByText("First mate · idle", { exact: true }).waitFor();
    if (width < 600) await page.getByRole("tab", { name: "Crew (45)" }).click();
    if (mode === "after" && view === "board") await page.getByRole("tab", { name: "Board", exact: true }).click();
    await page.getByRole("tab", { name: "All, 6 working, 4 need attention" }).waitFor();
    await page.screenshot({ path: resolve(here, `${name}.png`) });
    const geometry = await page.evaluate(() => ({
      viewport: { width: innerWidth, height: innerHeight },
      verticalScrollers: [...document.querySelectorAll("*")]
        .filter(
          (el) => ["auto", "scroll"].includes(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1,
        )
        .map((el) => ({
          width: el.clientWidth,
          height: el.clientHeight,
          scrollHeight: el.scrollHeight,
        })),
      horizontalScrollers: [...document.querySelectorAll("*")]
        .filter(
          (el) => ["auto", "scroll"].includes(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1,
        )
        .map((el) => ({
          width: el.clientWidth,
          height: el.clientHeight,
          scrollWidth: el.scrollWidth,
        })),
    }));
    results.push({ name, ...geometry });
    if (mode === "after" && view === "list") {
      const scroll = page.getByTestId("firstmate-task-list");
      assert.equal(await scroll.locator('[data-testid="firstmate-task-list"]').count(), 0);
      assert.equal(
        await scroll.evaluate(
          (el) =>
            [...el.querySelectorAll("*")].filter(
              (node) =>
                ["auto", "scroll"].includes(getComputedStyle(node).overflowY) &&
                node.scrollHeight > node.clientHeight + 1,
            ).length,
        ),
        0,
      );
      assert.equal(await page.getByRole("button", { name: /Show details and actions$/ }).count(), 15);
      const done = page.getByRole("button", {
        name: "30 done. Show completed tasks",
      });
      await done.click();
      assert.equal(await page.getByRole("button", { name: /Show details and actions$/ }).count(), 45);
      assert.equal(await scroll.evaluate((el) => [...el.querySelectorAll("*")].filter((node) => ["auto", "scroll"].includes(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1).length), 0);
      await page.getByRole("button", { name: "30 done. Hide completed tasks" }).click();
      if (width > 600) {
        await scroll.evaluate((el) => (el.scrollTop = el.scrollHeight));
        await page.screenshot({
          path: resolve(here, "after-list-done-wide.png"),
        });
        await scroll.evaluate((el) => (el.scrollTop = 0));
      }
      const row = page.getByRole("button", {
        name: /Build the chapter-craft plan.*Show details/,
      });
      assert.equal(
        await row.getAttribute("title"),
        "Build the chapter-craft plan: chapter styles, pacing and introductions",
      );
      await row.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Steer", exact: true }).waitFor();
      await page.getByRole("button", { name: "Steer", exact: true }).click();
      await page.getByPlaceholder(/Tell the worker on Light/).fill("Keep the chapter scope focused");
      await scroll.getByRole("button", { name: "Send", exact: true }).click();
      assert(
        await page.evaluate(() =>
          window.fixtureCalls.some(
            (call) =>
              call.name === "firstmate.remote-crew.steer" &&
              call.input.serverId === "sample-light" &&
              call.input.agentId === "work-0" &&
              call.input.text === "Keep the chapter scope focused",
          ),
        ),
      );
      await page
        .getByRole("button", {
          name: /Build the chapter-craft plan.*Hide details/,
        })
        .click();
      const local = page.getByRole("button", {
        name: /Install the merged board changes.*Show details/,
      });
      await local.click();
      await page.getByRole("button", { name: "Steer", exact: true }).click();
      await page.getByPlaceholder(/Tell the worker…/).fill("Check the local layout");
      await scroll.getByRole("button", { name: "Send", exact: true }).click();
      assert(
        await page.evaluate(() =>
          window.fixtureCalls.some(
            (call) =>
              call.name === "firstmate.crew.steer" &&
              call.input.agentId === "block-0" &&
              call.input.text === "Check the local layout",
          ),
        ),
      );
      await page
        .getByRole("button", {
          name: /Install the merged board changes.*Hide details/,
        })
        .click();
      await page
        .getByRole("button", {
          name: "Expand suggestion: Update the FirstMate panel",
        })
        .click();
      await page.getByRole("dialog", { name: "Update the FirstMate panel" }).waitFor();
      await page.keyboard.press("Escape");
      if (width < 600) {
        await page.getByRole("button", { name: "More suggestions (1)" }).click();
        await page.getByRole("dialog", { name: "More suggestions" }).waitFor();
        await page.keyboard.press("Escape");
      }
      await page.getByRole("button", { name: "Watches", exact: true }).click();
      await page.getByRole("dialog", { name: "Watches" }).waitFor();
      await page.getByRole("switch", { name: "pr-watch is on; switch it off" }).click();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Watches: 1 failing or off" }).waitFor();
      await page.getByRole("button", { name: "Watches: 1 failing or off" }).click();
      await page.getByRole("switch", { name: "pr-watch is off; switch it on" }).click();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Watches", exact: true }).waitFor();
      await page.evaluate(() => { window.fixtureSnapshot.hosts[1].clockSkew = { seconds: -3600, measuredAt: '2026-10-08T12:00:00.000Z', agentId: 'sample' }; });
      const light = page.getByRole("tab", {
        name: "Light, online, 6 working, 0 need attention",
      });
      await light.click();
      assert.equal(await page.getByRole("button", { name: /Light · online · 9 workers/ }).count(), 1);
      assert.equal(await page.getByRole("button", { name: /Show details and actions$/ }).count(), 9);
      await page.getByRole("button", { name: /Light · online · 9 workers/ }).click();
      await page.getByText("Clock about 60 minutes behind; card times corrected", { exact: true }).waitFor();
      assert.equal(await page.getByText('6 projects · 14 workspaces · 6 providers', { exact: true }).count(), 1);
      await page.getByRole("tab", { name: "All, 6 working, 4 need attention" }).click();
      if (width < 600) {
        await page.getByRole('button', { name: 'More suggestions (1)' }).click();
        await page.getByRole('button', { name: 'Remove suggestion: Speed: lasting fix and checks' }).click();
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: /^More suggestions/ }).waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: /^Update the FirstMate panel: send/ }).click();
        assert(await page.evaluate(() => window.fixtureCalls.some((call) => call.name === 'firstmate.mate.ask' && call.input.text.startsWith('Review the merged FirstMate layout'))));
        await page.getByRole('tab', { name: 'First mate', exact: true, selected: true }).waitFor();
      }
    }
    if (mode === "after" && view === "board" && width > 600) {
      const board = page.getByTestId("firstmate-board");
      assert(await board.evaluate((el) => el.scrollWidth > el.clientWidth));
      await page.getByRole("button", { name: "Fold Working" }).click();
      await page.getByRole("button", { name: "Unfold Working" }).waitFor();
      await page.getByRole("button", { name: "Unfold Working" }).click();
      await board.evaluate((el) => (el.scrollLeft = el.scrollWidth));
      await page.getByRole("button", { name: "Fold Done" }).waitFor();
      await page.screenshot({
        path: resolve(here, "after-board-end-wide.png"),
      });
      assert(await page.getByText("30", { exact: true }).evaluate((el) => el.clientHeight < 30));
    }
    assert.deepEqual(await page.evaluate(() => window.fixtureErrors), []);
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(generated, "geometry.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  server.close();
}
