/** Real native-web component -> registered RPC handlers; only host/modal and native receiver synthetic. */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
export async function captureAssignment(call: (name: string, input: unknown) => Promise<unknown>, target: { name: string; planId: string; taskId: string }, theme: string, width: number, entry: string) {
  const out = resolve(".local/fmu-integration/browser"), local = createRequire(resolve("docs/board-list/package.json")), repo = createRequire(resolve("package.json"));
  await mkdir(out, { recursive: true });
  const file = join(out, `app-${theme}-${width}-${entry}.js`);
  await local("esbuild").build({ entryPoints: [resolve("docs/fmu-integration/panel.jsx")], outfile: file, bundle: true, jsx: "automatic", logLevel: "warning",
    define: { "process.env.NODE_ENV": '"development"' }, plugins: [{ name: "native-host", setup(b: any) {
      b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve("docs/board-list/contracts.js") }));
      b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve("docs/fmu-integration/host.jsx") }));
      b.onResolve({ filter: /^\.\/workflow-plans$/ }, (a: any) => a.importer.includes("client") ? { path: resolve("docs/fmu-integration/host.jsx") } : undefined);
      b.onResolve({ filter: /^react($|\/)/ }, (a: any) => ({ path: repo.resolve(a.path) }));
      b.onResolve({ filter: /^react-dom($|\/)/ }, (a: any) => ({ path: local.resolve(a.path) }));
      b.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: local.resolve("react-native-web") }));
    } }] });
  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/rpc") {
        let body = ""; for await (const part of req) body += part;
        const { name, input } = JSON.parse(body); res.setHeader("Content-Type", "application/json");
        try { res.end(JSON.stringify({ ok: true, value: await call(name, input) })); }
        catch (e) { res.end(JSON.stringify({ ok: false, error: (e as Error).message })); }
      } else if (req.url?.endsWith(".js")) { res.setHeader("Content-Type", "text/javascript"); res.end(await readFile(file)); }
      else { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;min-height:100%;font-family:system-ui}*{box-sizing:border-box}button:focus-visible{outline:2px solid #26845b;outline-offset:2px}</style><div id="root"></div><script>window.calls=[]</script><script src="/app.js"></script>'); }
    } catch (e) { res.statusCode = 500; res.end((e as Error).message); }
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const browser = await local("playwright").chromium.launch({ ...(process.platform === "win32" ? { channel: "msedge" } : {}), headless: true });
  const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 1000 } }), errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${(server.address() as any).port}/?${new URLSearchParams({ theme, entry, name: target.name, plan: target.planId })}`, { waitUntil: "networkidle" });
    assert.deepEqual(await page.evaluate(() => (globalThis as any).calls), []);
    await page.getByRole("button", { name: entry === "watch" ? `Supervisor for ${target.name}` : "Assign watch inputs", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: `Review ${target.name} to ${target.planId} · ${target.taskId}`, exact: true }).click();
    await page.getByRole("button", { name: "Prepare reviewed watch assignment", exact: true }).click();
    await page.getByRole("button", { name: `Commit exact route for ${target.name}`, exact: true }).click();
    await page.getByRole("button", { name: `Unassign future watch inputs for ${target.name}`, exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Prepare reviewed watch assignment", exact: true }).count(), 0);
    const capture = `${theme}-${width}-${entry}`, screenshot = join(out, `${capture}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    const state = await page.evaluate(() => { const browser = globalThis as any; return { calls: browser.calls, overflow: browser.document.documentElement.scrollWidth > browser.innerWidth }; });
    assert.equal(state.overflow, false); assert.deepEqual(errors, []);
    assert.equal(state.calls.filter((c: any) => c.name.endsWith("act-ui")).length, 2);
    assert.equal(state.calls.every((c: any) => c.ok), true);
    assert.equal(state.calls.some((c: any) => /attach-ui|\.set$/.test(c.name)), false);
    const result = { theme, width, entry, screenshot, ...state, errors, syntheticHost: true };
    await writeFile(join(out, `${capture}.json`), JSON.stringify(result, null, 2)); return result;
  } finally { await browser.close(); await new Promise<void>(r => server.close(() => r())); }
}
