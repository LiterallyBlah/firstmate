// Real Files UI, synthetic RPCs, no installed daemon or captain's records.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../..");
const fixture = createRequire(join(root, "docs/board-list/package.json")), local = createRequire(join(root, "package.json"));
const { build } = fixture("esbuild"), { chromium } = fixture("playwright");
const out = join(root, ".local/files-safe-save/ui"); await mkdir(out, { recursive: true });
await build({ entryPoints: [join(here, "panel.jsx")], outfile: join(out, "panel.js"), bundle: true, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, plugins: [{ name: "host-fixtures", setup(builder) {
  builder.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: join(root, "docs/board-list/contracts.js") }));
  builder.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: join(here, "stubs.jsx") }));
  builder.onResolve({ filter: /^(react|zod|@tanstack\/react-query)($|\/)/ }, args => ({ path: local.resolve(args.path) }));
  builder.onResolve({ filter: /^react-dom($|\/)/ }, args => ({ path: fixture.resolve(args.path) }));
  builder.onResolve({ filter: /^react-native(-web)?$/ }, () => ({ path: fixture.resolve("react-native-web") }));
} }] });
const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", request.url?.startsWith("/panel.js") ? "text/javascript" : "text/html");
  response.end(request.url?.startsWith("/panel.js") ? await readFile(join(out, "panel.js")) : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}#root{display:flex;flex-direction:column}*{box-sizing:border-box}</style><div id="root"></div><script src="/panel.js"></script>');
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
let browser; const results = [];
try {
  browser = await chromium.launch({ headless: true });
  for (const phone of [false, true]) for (const light of [false, true]) {
    const page = await browser.newPage({ viewport: { width: phone ? 390 : 1440, height: phone ? 844 : 1000 } });
    const errors = []; page.on("pageerror", error => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}/?${phone ? "phone&" : ""}${light ? "light" : ""}`);
    await page.getByRole("textbox", { name: "Edit data/backlog.md" }).fill("## In flight\n- [ ] pr9 - Review the files screen\n## Done\nMy note");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Compare copies", exact: true }).click();
    await page.getByText("Remove task: new-task - Keep the later work", { exact: true }).waitFor();
    await page.getByText("Mark unfinished again: pr9 - Review the files screen", { exact: true }).waitFor();
    const replace = page.getByRole("button", { name: "Replace with my text", exact: true });
    assert(await replace.isDisabled());
    await page.getByRole("checkbox").click(); assert(await replace.isEnabled());
    const file = `${phone ? "phone" : "desktop"}-${light ? "light" : "dark"}.png`;
    await page.screenshot({ path: join(out, file), fullPage: true });
    await replace.click();
    await page.getByRole("textbox", { name: "Edit data/backlog.md" }).waitFor();
    assert.equal((await page.evaluate(() => window.fileSaves.at(-1))).expectedHash, "b".repeat(64));
    assert((await page.getByRole("textbox", { name: "Edit data/backlog.md" }).inputValue()).includes("My note"));
    assert.deepEqual(errors, []); results.push({ phone, light, file, passed: true }); await page.close();
  }
  await writeFile(join(out, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
