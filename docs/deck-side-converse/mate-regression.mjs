/** Real Chat panel and composer, synthetic host APIs; no installed plugin changes. */
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const here = dirname(fileURLToPath(import.meta.url)),
  root = resolve(here, "../..");
const harness = createRequire(join(root, "docs/board-list/package.json")),
  rootRequire = createRequire(join(root, "package.json"));
const { build } = harness("esbuild"),
  { chromium } = harness("playwright");
const phase = process.argv[2] ?? "after";
await mkdir(join(here, ".generated"), { recursive: true });
await build({
  entryPoints: [join(root, "docs/chat-toolbar/panel.jsx")],
  outfile: join(here, ".generated/panel.js"),
  bundle: true,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "warning",
  plugins: [
    {
      name: "fixture",
      setup(b) {
        if (phase === "before")
          b.onLoad({ filter: /client[\\/](chat|mate-controls)\.tsx$/ }, (args) => ({
            contents: execFileSync("git", ["show", `b1458b4:client/${args.path.split(/[\\/]/).at(-1)}`], {
              cwd: root,
              encoding: "utf8",
            }),
            loader: "tsx",
            resolveDir: dirname(args.path),
          }));
        b.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: join(root, "docs/board-list/contracts.js") }));
        b.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: join(root, "docs/chat-toolbar/stubs.jsx") }));
        b.onResolve({ filter: /^(react|zod|@tanstack\/react-query)($|\/)/ }, (a) => ({
          path: rootRequire.resolve(a.path),
        }));
        b.onResolve({ filter: /^react-dom($|\/)/ }, (a) => ({ path: harness.resolve(a.path) }));
        b.onResolve({ filter: /^react-native(-web)?$/ }, () => ({ path: harness.resolve("react-native-web") }));
      },
    },
  ],
});
const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", req.url === "/panel.js" ? "application/javascript" : "text/html");
  res.end(
    req.url === "/panel.js"
      ? await readFile(join(here, ".generated/panel.js"))
      : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:Segoe UI,sans-serif}#root{display:flex;flex-direction:column}*{box-sizing:border-box}</style><div id="root"></div><script src="/panel.js"></script>',
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [];

const sizes=[];
try {
 for(const width of [360,500,800,1100]) {
  const page=await browser.newPage({viewport:{width,height:700},reducedMotion:"reduce"});
  page.on("pageerror",e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}?view=chat`);
  const input=page.locator("textarea"); await input.waitFor(); await page.waitForTimeout(350);
  const states=[];
  for(const text of ["", "One\nTwo\nThree\nFour", "Long wrapping draft ".repeat(100), ""]) {
   await input.fill(text); await page.waitForTimeout(100);
   states.push(await input.boundingBox());
  }
  sizes.push({width,states}); await page.close();
 }
 assert.deepEqual(errors,[]);
 if (phase === "after") assert.deepEqual(sizes, JSON.parse(await readFile(join(here, "mate-before-measurements.json"), "utf8")), "MateChat geometry is unchanged from the base commit");
 const {writeFile}=await import("node:fs/promises");
 await writeFile(join(here,`mate-${phase}-measurements.json`),JSON.stringify(sizes,null,2)+"\n");
 console.log(JSON.stringify(sizes));
} finally { await browser.close();server.close(); }
