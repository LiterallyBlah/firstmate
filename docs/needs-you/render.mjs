/** Real FirstMate components, synthetic host APIs. No plugin installation, daemon or real sends. */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { checkTaskViews } from "./view-checks.mjs";
import { checkResilience } from "./resilience-checks.mjs";
import { checkPolish } from "./polish-checks.mjs";
import { checkHeaders } from "./header-checks.mjs";
import { checkAnswers } from "./answer-checks.mjs";
import { checkRaised } from "./raised-checks.mjs";
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
  if (request.url?.startsWith("/rpc/")) {
    try {
      let body = ""; for await (const chunk of request) body += chunk;
      const name = request.url.slice(5), input = JSON.parse(body || "{}");
      const manifest = JSON.parse(await readFile(join(root, "art/settings/ship/setting.json"), "utf8"));
      let result;
      if (name === "firstmate.deck.engine") result = { version: "8.22.0", source: await readFile(join(root, "vendor/pixi.min.js"), "utf8") };
      else if (name === "firstmate.deck.settings") result = [{ id: "ship", name: manifest.name, version: manifest.version,
        formatVersion: manifest.formatVersion, compatible: true, reason: null, preview: null, bytes: 0 }];
      else if (name === "firstmate.deck.setting" && input.id === "ship") result = { manifest, images: Object.fromEntries(await Promise.all(
        Object.entries(manifest.images).map(async ([id, image]) => [id, (await readFile(join(root, "art/settings/ship", image.path))).toString("base64")]))) };
      else throw new Error(`Unexpected fixture RPC: ${name}`);
      response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(result));
    } catch (error) { response.statusCode = 500; response.end(String(error)); }
    return;
  }
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
  else if (new URLSearchParams(query).get("view") === "deck")
    await page.getByRole("heading", { name: "Deck", exact: true }).waitFor();
  else
    await page
      .getByRole("button", { name: /^Needs you, \d+ items/ })
      .waitFor();
  return page;
}
try {
  const only = process.env.RAISED_ONLY;
  const raised = process.env.POLISH_ONLY ? [] : await checkRaised(pageAt, output);
  const headers = only ? [] : await checkHeaders(pageAt, output);
  const polish = only ? [] : await checkPolish(pageAt, output);
  const answers = only ? [] : await checkAnswers(pageAt, output);
  const { checkDrawer } = await import("./drawer-checks.mjs");
  const layouts = only || process.env.POLISH_ONLY ? [] : await checkDrawer(pageAt, output);
  if (!only && !process.env.POLISH_ONLY) await checkResilience(pageAt, output);
  const taskViews = only || process.env.POLISH_ONLY ? [] : await checkTaskViews(pageAt, output);
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "results.json"),
    JSON.stringify({ raised, headers, polish, answers, layouts, taskViews, errors }, null, 2),
  );
  console.log(
    JSON.stringify({
      raised: raised.length,
      headers: headers.length,
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
