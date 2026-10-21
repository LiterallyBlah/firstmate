/**
 * Home's top-left header cluster — Needs you, the first mate's state, the counts — rendered from
 * the real Home screen with the Needs-you fixtures (`docs/needs-you/`). Synthetic host APIs only.
 *
 *   node docs/header-style/render.mjs [label]
 *
 * Writes `.local/header-style/<label>/` (default `after`): the header strip at 390, 900, 1440
 * and 2866 pixels, dark and light: decisions new, waiting, stale, none and unreadable, with the
 * first mate idle (asking for attention) and working.
 */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url)),
  root = resolve(here, "../.."),
  fixtures = join(root, "docs/needs-you");
const harness = createRequire(join(root, "docs/board-list/package.json")),
  local = createRequire(join(root, "package.json"));
const { build } = harness("esbuild"),
  { chromium } = harness("playwright");
const label = process.argv[2] ?? "after";
const generated = join(here, ".generated"),
  output = join(root, ".local/header-style", label);
await mkdir(generated, { recursive: true });
await mkdir(output, { recursive: true });
await build({
  entryPoints: [join(here, "panel.jsx")],
  outfile: join(generated, "panel.js"),
  bundle: true,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "warning",
  plugins: [{
    name: "host-fixtures",
    setup(builder) {
      builder.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: join(root, "docs/board-list/contracts.js") }));
      builder.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: join(fixtures, "stubs.jsx") }));
      builder.onResolve({ filter: /^(react|zod|@tanstack\/react-query)($|\/)/ }, (args) => ({ path: local.resolve(args.path) }));
      builder.onResolve({ filter: /^react-dom($|\/)/ }, (args) => ({ path: harness.resolve(args.path) }));
      builder.onResolve({ filter: /^react-native(-web)?$/ }, () => ({ path: harness.resolve("react-native-web") }));
    },
  }],
});
const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", request.url === "/panel.js" ? "text/javascript" : "text/html");
  response.end(request.url === "/panel.js"
    ? await readFile(join(generated, "panel.js"))
    : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:Segoe UI,sans-serif}#root{display:flex;flex-direction:column}*{box-sizing:border-box}</style><div id="root"></div><script src="/panel.js"></script>');
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ channel: process.platform === "win32" && !process.env.CI ? "msedge" : "chromium", headless: true });
const base = `http://127.0.0.1:${server.address().port}`;
const errors = [], shots = [];
try {
  for (const width of [390, 900, 1440, 2866])
    for (const light of [false, true])
    for (const mate of ["idle", "running"]) {
      const page = await browser.newPage({ viewport: { width, height: width < 638 ? 844 : 900 }, reducedMotion: "reduce" });
      page.setDefaultTimeout(10000);
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.goto(`${base}/?${width < 638 ? "compact" : ""}${light ? "&light" : ""}${mate === "running" ? "&mate=running" : ""}`);
      await page.getByRole("button", { name: /^Needs you, \d+ decisions/ }).waitFor();
      await page.evaluate(() => { window.headerSnapshot = structuredClone(window.attentionSnapshot); });
      for (const state of mate === "running" ? ["new"] : ["new", "waiting", "stale", "clear", "unreadable"]) {
        if (state !== "new")
          await page.evaluate(async (state) => {
            const s = structuredClone(window.headerSnapshot);
            s.version = window.attentionSnapshot.version + 1;
            s.freshness.checkedAt = Date.now();
            if (state === "clear") {
              s.requests = [];
              s.actionCount = s.newCount = s.pendingAnswerCount = s.snoozedCount = 0;
            } else if (state === "waiting") {
              s.newCount = 0;
              s.requests = s.requests.map((r) => (r.state === "new" ? { ...r, state: "seen" } : r));
            } else if (state === "stale") {
              s.newCount = 0;
              s.freshness = { ...s.freshness, status: "stale", asOf: Date.now() - 600000, problems: ["The backlog changed while it was being read."] };
            } else s.freshness = { ...s.freshness, status: "unknown", problems: ["Backlog could not be read."] };
            window.attentionSnapshot = s;
            await window.refreshDecisions();
          }, state);
        await page.getByRole("button", { name: state === "clear" ? /^Needs you, 0 decisions/ : state === "unreadable" ? /^Needs you, count unavailable/ : /^Needs you, \d+ decisions/ }).waitFor();
        await page.evaluate(() => document.fonts.ready);
        const header = page.locator("#firstmate-home-header");
        const file = `${width}-${light ? "light" : "dark"}-${mate}-${state}.png`;
        await header.screenshot({ path: join(output, file) });
        shots.push(file);
      }
      await page.close();
    }
  if (errors.length) throw new Error(errors.join("\n"));
  await writeFile(join(output, "results.json"), JSON.stringify({ shots, errors }, null, 2));
  console.log(JSON.stringify({ output, shots: shots.length }));
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
