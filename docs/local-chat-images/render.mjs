// Real MateChat + real server reader over a fixture HTTP transport. No daemon/plugin installation.
import { build } from "../board-list/node_modules/esbuild/lib/main.js";
import { chromium } from "../board-list/node_modules/playwright/index.mjs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile, symlink, lstat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../..");
const generated = resolve(here, ".generated");
await mkdir(generated, { recursive: true });
process.env.PASEO_HOME = resolve(generated, "paseo-home");
process.env.FIRSTMATE_RECEIPT_JOURNAL = "0";
await build({ entryPoints: [resolve(root, "server/chat-images.ts")], outfile: resolve(generated, "reader.mjs"), bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "warning" });
const { loadChatImage } = await import(pathToFileURL(resolve(generated, "reader.mjs")));
const rootRequire = createRequire(resolve(root, "package.json")), webRequire = createRequire(resolve(here, "../board-list/package.json"));
await build({ entryPoints: [resolve(here, "panel.jsx")], outfile: resolve(generated, "app.js"), bundle: true, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning", plugins: [{ name: "host", setup(builder) {
  builder.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(here, "../board-list/contracts.js") }));
  builder.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, "stubs.jsx") }));
  builder.onResolve({ filter: /^(react|@tanstack\/react-query)($|\/)/ }, args => ({ path: rootRequire.resolve(args.path) }));
  builder.onResolve({ filter: /^react-dom($|\/)/ }, args => ({ path: webRequire.resolve(args.path) }));
  builder.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: webRequire.resolve("react-native-web") }));
} }] });
const home = resolve(generated, "home"), outside = resolve(generated, "outside"), worktree = resolve(generated, "worktree");
await mkdir(home, { recursive: true }); await mkdir(outside, { recursive: true });
await mkdir(worktree, { recursive: true });
await writeFile(resolve(outside, "preview.png"), await readFile(resolve(root, "docs/ship-deck-replies/still-a.png")));
await writeFile(resolve(worktree, "preview.png"), await readFile(resolve(root, "docs/ship-deck-replies/still-a.png")));
await writeFile(resolve(worktree, "notes.txt"), "This is not an image");
await writeFile(resolve(worktree, "large.png"), Buffer.alloc(10 * 1024 * 1024 + 1));
const escape = resolve(worktree, "escape");
if (!(await lstat(escape).catch(() => null))) await symlink(outside, escape, process.platform === "win32" ? "junction" : "dir");
const workspace = { id: "worktree", name: "Image worktree", workspaceDirectory: worktree.replaceAll("\\", "/"), archivingAt: null };
const api = { workspaces: { ref: id => ({ refresh: async () => id === "worktree" ? workspace : null }) } };
const fixture = { home: home.replaceAll("\\", "/"), outside: outside.replaceAll("\\", "/"), workspace };
const rpcResults = [];
const server = createServer(async (req, res) => {
  if (req.url === "/rpc") {
    let body = ""; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    const result = await loadChatImage(api, input);
    rpcResults.push({ input, status: result.status, reason: result.reason, size: result.size });
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(result));
  } else if (req.url === "/app.js") { res.setHeader("Content-Type", "application/javascript"); res.end(await readFile(resolve(generated, "app.js"))); }
  else { res.setHeader("Content-Type", "text/html"); res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;font-family:Segoe UI}*{box-sizing:border-box}</style></head><body><div id="root"></div><script>window.imageFixture=${JSON.stringify(fixture)}</script><script src="/app.js"></script></body></html>`); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
let browser; const errors = [];
try {
  browser = await chromium.launch({ ...(process.platform === "win32" ? { channel: "msedge" } : {}), headless: true });
  for (const [name, width, height, theme] of [["wide-dark", 1100, 900, "dark"], ["phone-light", 390, 844, "light"]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${url}/?${theme}`);
    await page.waitForFunction(() => [...document.querySelectorAll('img[src^="data:image/png"]')].filter(image => image.complete && image.naturalWidth > 0).length === 2);
    await page.screenshot({ path: resolve(here, `${name}-inline.png`) });
    await page.getByRole("button", { name: "Enlarge deck render", exact: true }).click();
    await page.getByRole("dialog", { name: "Deck render", exact: true }).waitFor();
    await page.screenshot({ path: resolve(here, `${name}-viewer.png`) });
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.getByRole("button", { name: "Fit image", exact: true }).click();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("link", { name: "Open the deck image", exact: true }).click();
    await page.getByRole("dialog", { name: "Image from the first mate", exact: true }).waitFor();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.goto(`${url}/?${theme}&refused`);
    await page.waitForFunction(() => document.body.textContent.split("Image unavailable:").length === 5);
    await page.screenshot({ path: resolve(here, `${name}-refused.png`) });
    await page.close();
  }
  assert.deepEqual(errors, []);
  assert(rpcResults.some(result => result.reason === "not-image"));
  assert(rpcResults.some(result => result.reason === "too-large"));
  assert(rpcResults.some(result => result.reason === "path"));
  await writeFile(resolve(here, "verification.json"), JSON.stringify({ platform: "Windows Edge; desktop and phone web viewport; real MateChat and real image reader, fixture host/transport", rpcResults, errors }, null, 2) + "\n");
  console.log("Passed inline image, enlarged viewer, file-link viewer, and four refusals at both viewport sizes.");
} finally { await browser?.close(); server.close(); }
