/** Before/after actual components, same synthetic paused records, both themes and widths. */
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../.."), local = createRequire(resolve(root, "docs/board-list/package.json")), repo = createRequire(resolve(root, "package.json"));
const { build } = local("esbuild"), { chromium } = local("playwright"), out = resolve(root, ".local/pr4/screenshots");
await mkdir(out, { recursive: true });
for (const variant of ["before", "after"]) await build({ entryPoints: [resolve(here, "policy-panel.jsx")], outfile: resolve(out, `${variant}.js`), bundle: true, jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning", plugins: [{ name: "policy-fixtures", setup(b) {
    b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(root, "docs/board-list/contracts.js") }));
    b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, "policy-stubs.jsx") }));
    b.onResolve({ filter: /[\\/]client[\\/]workflow-plans$/ }, () => ({ path: resolve(here, "policy-stubs.jsx") }));
    b.onResolve({ filter: /^\.\/workflow-plans$/ }, a => a.importer.startsWith(resolve(root, "client")) ? ({ path: resolve(here, "policy-stubs.jsx") }) : undefined);
    b.onResolve({ filter: /^react($|\/)/ }, a => ({ path: repo.resolve(a.path) }));
    b.onResolve({ filter: /^react-dom($|\/)/ }, a => ({ path: local.resolve(a.path) }));
    b.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: local.resolve("react-native-web") }));
    if (variant === "before") b.onLoad({ filter: /client[\\/](project-ownership|maintenance-ownership|supervision-activation)\.tsx$/ }, args => ({
      contents: execFileSync("git", ["show", `cb464d1:${args.path.slice(root.length + 1).replaceAll("\\", "/")}`], { cwd: root, encoding: "utf8" }), loader: "tsx", resolveDir: dirname(args.path),
    }));
  } }] });
const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", req.url.startsWith("/bundle/") ? "text/javascript" : "text/html");
  const variant = req.url.includes("before") ? "before" : "after";
  res.end(req.url.startsWith("/bundle/") ? await readFile(resolve(out, `${variant}.js`)) : `<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle/${variant}"></script>`);
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ ...(process.platform === "win32" ? { channel: "msedge" } : {}), headless: true }), results = [];
try {
  for (const theme of ["light", "dark"]) for (const [device, width, height] of [["desktop", 1440, 1000], ["phone", 390, 844]]) for (const variant of ["before", "after"]) {
    const page = await browser.newPage({ viewport: { width, height } }), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?theme=${theme}&variant=${variant}`);
    await page.getByTestId("maintenance-ownership").waitFor();
    assert.equal(await page.getByText("Paused for new work; checking 2 saved operations", { exact: true }).count(), variant === "after" ? 3 : 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.getByRole("button", { name: "Create maintenance owner", exact: true }).isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => [...new Set(window.policyReads)]), ["firstmate.maintenance.read"]);
    await page.screenshot({ path: resolve(out, `${variant}-${theme}-${device}.png`), fullPage: true });
    assert.deepEqual(errors, []); results.push({ variant, theme, device, errors, horizontalOverflow: false, mutations: 0 }); await page.close();
  }
  await writeFile(resolve(out, "results.json"), JSON.stringify({ passed: true, baseline: "cb464d1", results }, null, 2));
  console.log(JSON.stringify({ passed: true, cases: results.length, out }));
} finally { await browser.close(); await new Promise(done => server.close(done)); }
