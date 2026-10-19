/** Real FirstMate components, synthetic host APIs. No plugin installation, daemon or real sends. */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { checkTaskViews } from "./view-checks.mjs";
import { checkResilience } from "./resilience-checks.mjs";
const here = dirname(fileURLToPath(import.meta.url)),
  root = resolve(here, "../..");
const harness = createRequire(join(root, "docs/board-list/package.json")),
  local = createRequire(join(root, "package.json"));
const { build } = harness("esbuild"),
  { chromium } = harness("playwright");
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
      name: "host-fixtures",
      setup(builder) {
        builder.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({
          path: join(root, "docs/board-list/contracts.js"),
        }));
        builder.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({
          path: join(here, "stubs.jsx"),
        }));
        builder.onResolve(
          { filter: /^(react|zod|@tanstack\/react-query)($|\/)/ },
          (args) => ({ path: local.resolve(args.path) }),
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
const server = createServer(async (request, response) => {
  response.setHeader(
    "Content-Type",
    request.url === "/panel.js" ? "text/javascript" : "text/html",
  );
  response.end(
    request.url === "/panel.js"
      ? await readFile(join(generated, "panel.js"))
      : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:Segoe UI,sans-serif}#root{display:flex;flex-direction:column}*{box-sizing:border-box}</style><div id="root"></div><script src="/panel.js"></script>',
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({
  channel:
    process.platform === "win32" && !process.env.CI ? "msedge" : "chromium",
  headless: true,
});
const errors = [],
  output = join(root, ".local/needs-you-drawer");
await mkdir(output, { recursive: true });
const base = `http://127.0.0.1:${server.address().port}`;
async function pageAt(query, width = 1440) {
  const page = await browser.newPage({
    viewport: { width, height: width < 638 ? 844 : 900 },
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`${base}/?${query}`);
  if (new URLSearchParams(query).has("decision"))
    await page
      .getByRole("heading", { name: "Decision a", exact: true })
      .waitFor();
  else
    await page
      .getByRole("button", { name: /^Needs you, \d+ decisions/ })
      .waitFor();
  return page;
}
try {
  const { checkDrawer } = await import("./drawer-checks.mjs");
  const layouts = await checkDrawer(pageAt, output);
  await checkResilience(pageAt, output);
  const taskViews = await checkTaskViews(pageAt, output);
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "results.json"),
    JSON.stringify({ layouts, taskViews, errors }, null, 2),
  );
  console.log(
    JSON.stringify({
      layouts: layouts.length,
      taskViews: taskViews.length,
      failures: errors.length,
    }),
  );
} catch (error) {
  for (const [index, page] of browser
    .contexts()
    .flatMap((context) => context.pages())
    .entries()) {
    await page.screenshot({ path: join(output, `failure-${index}.png`) });
    console.error(await page.locator("body").innerText());
  }
  throw error;
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
