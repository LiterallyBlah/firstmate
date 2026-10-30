/** Actual create/resume component, synthetic host only. Output stays under .local/. */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const root = process.cwd(), out = resolve(root, ".local/project-mate-context"), baseline = "2c1b1ed96c73385ce72293e06aaf97b2a93a99ac";
const local = createRequire(resolve(root, "docs/board-list/package.json")), repo = createRequire(resolve(root, "package.json"));
const { build } = local("esbuild"), { chromium } = local("playwright");
await mkdir(out, { recursive: true });
for (const stage of ["before", "after"]) await build({ entryPoints: [resolve(root, "docs/project-mate-context/panel.jsx")], outfile: resolve(out, stage + ".js"), bundle: true, jsx: "automatic", logLevel: "warning", define: { "process.env.NODE_ENV": '"development"' }, plugins: [{ name: "project-context-host", setup(b) {
  b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(root, "docs/board-list/contracts.js") }));
  b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(root, "docs/project-mate-context/stubs.jsx") }));
  b.onResolve({ filter: /^react($|\/)/ }, a => ({ path: repo.resolve(a.path) }));
  b.onResolve({ filter: /^react-dom($|\/)/ }, a => ({ path: local.resolve(a.path) }));
  b.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: local.resolve("react-native-web") }));
  b.onResolve({ filter: /^lucide-react$/ }, () => ({ path: local.resolve("lucide-react") }));
  if (stage === "before") b.onLoad({ filter: /[\\/]client[\\/]project-ownership\.tsx$/ }, () => ({ contents: execFileSync("git", ["show", `${baseline}:client/project-ownership.tsx`], { encoding: "utf8" }), loader: "tsx" }));
} }] });
const server = createServer(async (req, res) => {
  const stage = req.url.includes("before") ? "before" : "after", js = req.url.endsWith(".js");
  res.setHeader("Content-Type", js ? "application/javascript" : "text/html");
  res.end(js ? await readFile(resolve(out, stage + ".js")) : `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;min-height:100%;font-family:system-ui}*{box-sizing:border-box}button{font:inherit;min-height:44px}</style><div id="root"></div><script src="/${stage}.js"></script>`);
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ ...(process.platform === "win32" ? { channel: "msedge" } : {}), headless: true }), results = [];
try {
  for (const theme of ["light", "dark"]) for (const [device, width, height] of [["desktop", 1440, 1000], ["phone", 390, 844]]) for (const scenario of ["create", "resume", "refusal"]) for (const stage of ["before", "after"]) {
    const page = await browser.newPage({ viewport: { width, height } }), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?${new URLSearchParams({ stage, theme, scenario })}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Project mates and plans", exact: true }).click();
    if (scenario === "resume") await page.getByRole("button", { name: "Show Ariadne details", exact: true }).click();
    await page.getByRole("button", { name: `${scenario === "resume" ? "Resume" : "Create"} Ariadne mate`, exact: true }).click();
    const dialog = page.getByRole("dialog");
    assert.equal(await page.evaluate(() => window.projectCalls.filter(c => c.name !== "firstmate.projects.read").length), 0);
    if (scenario === "refusal") {
      await dialog.getByRole("button", { name: "Create project mate", exact: true }).click();
      await dialog.getByRole("alert").waitFor();
      assert.equal(await dialog.getByRole("button", { name: stage === "after" ? "Resume setup" : "Resume recorded request", exact: true }).isEnabled(), true);
    }
    if (stage === "after") {
      assert.doesNotMatch(await dialog.innerText(), /caller identity|by convention|bounded context|oversight grants|undispatched|provisioning/i);
      if (scenario === "create") assert.match(await dialog.innerText(), /uses one conversation and one turn/);
      else assert.equal(await dialog.getByRole("button", { name: "Stop setup", exact: true }).isEnabled(), true);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    const key = `${theme}-${device}-${scenario}-${stage}`;
    await page.screenshot({ path: resolve(out, key + ".png") });
    // The primary and stop actions remain reachable inside the scrolling dialog on phones.
    await dialog.getByRole("button", { name: stage === "after" && scenario !== "create" ? "Stop setup" : scenario === "resume" ? "Stop recorded provisioning" : scenario === "refusal" ? "Stop recorded provisioning" : "Create project mate", exact: true }).scrollIntoViewIfNeeded();
    results.push({ key, noOverflow: true, errors, calls: await page.evaluate(() => window.projectCalls.filter(c => c.name !== "firstmate.projects.read")) });
    await page.close();
  }
  await writeFile(resolve(out, "results.json"), JSON.stringify({ baseline, results }, null, 2));
  console.log(`${results.length} create/resume/refusal screenshots passed; no live host used.`);
} finally { await browser.close(); await new Promise(done => server.close(done)); }
