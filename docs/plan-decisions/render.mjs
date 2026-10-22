/** Adapted from docs/plans-view/render.mjs and docs/needs-you/render.mjs. No daemon or installation. */
import { createRequire } from "node:module";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../.."), local = createRequire(resolve(root, "docs/board-list/package.json")), repo = createRequire(resolve(root, "package.json"));
const { build } = local("esbuild"), { chromium } = local("playwright");
const out = resolve(root, ".local/plan-decisions"), baseline = "cf3c914d4854f6e20b74b721f031f0a3956430ea";
await mkdir(out, { recursive: true });
for (const mode of ["before", "after"]) await build({ entryPoints: [resolve(here, "panel.jsx")], outfile: resolve(out, `${mode}.js`), bundle: true, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning", plugins: [{ name: "isolated-host-fixtures", setup(b) {
  b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(root, "docs/board-list/contracts.js") }));
  b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, "stubs.jsx") }));
  b.onResolve({ filter: /^(react|zod|@tanstack\/react-query)($|\/)/ }, a => ({ path: repo.resolve(a.path) }));
  b.onResolve({ filter: /^react-dom($|\/)/ }, a => ({ path: local.resolve(a.path) }));
  b.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: local.resolve("react-native-web") }));
  if (mode === "before") b.onLoad({ filter: /\.(ts|tsx)$/ }, a => {
    const path = relative(root, a.path).split(sep).join("/");
    if (!/^(client|shared)\//.test(path)) return;
    return { contents: execFileSync("git", ["show", `${baseline}:${path}`], { cwd: root, encoding: "utf8" }), loader: path.endsWith("tsx") ? "tsx" : "ts", resolveDir: dirname(a.path) };
  });
} }] });
const server = createServer(async (req, res) => {
  if (req.url === "/before.js" || req.url === "/after.js") { res.setHeader("Content-Type", "application/javascript"); res.end(await readFile(resolve(out, req.url.slice(1)))); }
  else { res.setHeader("Content-Type", "text/html"); res.end(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body,#root{margin:0;height:100%;overflow:hidden;font-family:Segoe UI,sans-serif}*{box-sizing:border-box}</style><div id="root" style="display:flex"></div><script src="/${req.url.startsWith('/before') ? 'before' : 'after'}.js"></script>`); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--disable-gpu"] }), results = [];
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  for (const theme of ["day", "night"]) for (const width of [1440, 390]) for (const view of ["needs-you", "all", "list", "board"]) {
    for (const mode of ["before", "after"]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: "reduce" }), errors = [];
      page.setDefaultTimeout(10000);
      page.on("pageerror", e => errors.push(e.message));
      await page.goto(`${origin}/${mode}?theme=${theme}&view=${view}`);
      await page.getByLabel("Decision count", { exact: true }).getByText(`Needs you · ${view === "needs-you" ? 1 : 2}`, { exact: true }).waitFor();
      if (view === "all") await page.getByRole("button", { name: "All decisions", exact: true }).click();
      if (mode === "after") {
        const visible = await page.locator("body").innerText();
        assert(!visible.includes(needTitle()), "the full plan title must not reappear in a prefixed Review plan link");
        assert.equal(await page.getByRole("button", { name: /^Review plan:/ }).count(), 0, "due decisions must not also appear as review links");
        assert.equal(await page.getByText("Now · plans", { exact: true }).count(), 0);
        assert.equal(await page.getByText(/Needed before/).count(), 0);
        assert.equal(await page.getByText(needTitle(), { exact: true }).count(), 0);
        if (view === "needs-you") {
          await page.getByRole("heading", { name: "Spoiler and foreshadowing checks", exact: true }).waitFor();
          await page.getByRole("button", { name: "Keep both checks", exact: true }).waitFor();
          await page.getByText(/Should the reader pass check both/).waitFor();
        } else {
          assert.equal(await page.getByTestId("decision-task").count(), 2);
          if (view === "all") {
            assert(visible.indexOf("Waiting for you") < visible.indexOf("Coming up:"), "waiting group must precede future decisions");
            assert(visible.indexOf("Spoiler and foreshadowing checks") < visible.indexOf("Coming up:"), "the due plan card must come first");
            assert(visible.indexOf("Choose the review pilot") < visible.indexOf("Coming up:"), "the backlog card must also precede future decisions");
          }
        }
        if (view === "list" || view === "board") assert.equal(await page.getByTestId("workflow-coming-up").count(), 0);
      } else assert.equal(await page.getByText("Now · plans", { exact: true }).count(), 1);
      await page.mouse.move(1, 1);
      await page.screenshot({ path: resolve(out, `${theme}-${width}-${view}-${mode}.png`) });
      if (mode === "after" && view === "all") {
        await page.getByRole("button", { name: "Coming up: 3 later decisions", exact: true }).click();
        await page.getByRole("button", { name: "Connect Claude · after the connection is ready", exact: true }).waitFor();
        await page.screenshot({ path: resolve(out, `${theme}-${width}-${view}-expanded.png`) });
        const expanded = await page.locator("body").innerText();
        assert(!expanded.includes(needTitle()), "expanded future decisions must not repeat the plan title");
        await page.getByRole("button", { name: /^Answer: Choose the review pilot\./ }).first().click();
        await page.getByRole("textbox", { name: "Answer the first mate", exact: true }).fill("Use the public pilot.");
        await page.getByRole("button", { name: "Send answer", exact: true }).click();
        await page.getByRole("button", { name: "Keep both checks", exact: true }).waitFor();
        await page.getByRole("button", { name: "Keep both checks", exact: true }).click();
        await page.getByText("Returned to Home", { exact: true }).waitFor();
      }
      if (mode === "after" && (view === "list" || view === "board")) {
        await page.getByRole("button", { name: /^Answer: Spoiler and foreshadowing checks\./ }).first().click();
        await page.getByRole("button", { name: "Keep both checks", exact: true }).waitFor();
      }
      if (mode === "after" && view !== "all") {
        await page.getByRole("button", { name: "Keep both checks", exact: true }).click();
        assert.equal(await page.evaluate(() => window.fixtureActions.length), 1);
        assert.equal(await page.evaluate(() => window.fixtureActions[0].command.action), "answer");
        assert.equal(await page.evaluate(() => window.fixtureCalls.some(c => c.name.endsWith(".answer"))), false);
        if (view !== "needs-you") {
          await page.getByRole("heading", { name: "Choose the review pilot", exact: true }).waitFor();
          await page.getByRole("textbox", { name: "Answer the first mate", exact: true }).fill("Use the public pilot.");
          await page.getByRole("button", { name: "Send answer", exact: true }).click();
        }
        await page.getByText(view === "list" ? "Nothing needs a decision now." : view === "board" ? "Nothing needs a decision now." : "Returned to Home", { exact: true }).waitFor();
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      results.push({ theme, width, view, mode, checked: true, errors }); await page.close();
    }
  }
  await writeFile(resolve(out, "checks.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ renders: results.length, errors: 0, output: out }));
} catch (error) {
  for (const page of browser.contexts().flatMap(c => c.pages())) {
    await page.screenshot({ path: resolve(out, "failure.png") });
    console.error(await page.locator("body").innerText());
  }
  throw error;
} finally { await browser.close(); await new Promise(done => server.close(done)); }
function needTitle() { return "Build the reader pass into chapter-making and roll it out"; }
