/** Isolated real chat/Watch components and timeline hook; never connects to a daemon. */
import { build } from "../board-list/node_modules/esbuild/lib/main.js";
import { chromium } from "../board-list/node_modules/playwright/index.mjs";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const rootRequire = createRequire(resolve(root, "package.json"));
const webRequire = createRequire(resolve(here, "../board-list/package.json"));
const generated = resolve(here, ".generated");
const baseline = "36a4624"; // main after PR #10
await mkdir(resolve(generated, "screenshots"), { recursive: true });
const representative = new Set([
  "before-chat-wide-dark", "after-chat-wide-dark", "after-chat-phone-light", "after-watch-wide-dark", "chunks-chat-wide",
]);
const screenshotPath = (name) => resolve(representative.has(name) ? here : resolve(generated, "screenshots"), `${name}.png`);
for (const mode of ["before", "after"]) {
  await build({
    entryPoints: [resolve(here, "panel.jsx")],
    outfile: resolve(generated, `${mode}.js`),
    bundle: true,
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [
      {
        name: "host-and-boundary-baseline",
        setup(builder) {
          builder.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({
            path: resolve(here, "../board-list/contracts.js"),
          }));
          builder.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({
            path: resolve(here, "stubs.jsx"),
          }));
          builder.onResolve({ filter: /^react($|\/)/ }, (args) => ({
            path: rootRequire.resolve(args.path),
          }));
          builder.onResolve({ filter: /^react-dom($|\/)/ }, (args) => ({
            path: webRequire.resolve(args.path),
          }));
          builder.onResolve({ filter: /^react-native($|-web$)/ }, () => ({
            path: webRequire.resolve("react-native-web"),
          }));
          if (mode === "before")
            builder.onLoad(
              {
                filter: /[\\/]client[\\/](transcript-rows|activity-rows)\.ts$/,
              },
              (args) => ({
                contents: execFileSync("git", ["show", `${baseline}:client/${args.path.split(/[\\/]/).at(-1)}`], {
                  cwd: root,
                  encoding: "utf8",
                }),
                loader: "ts",
                resolveDir: dirname(args.path),
              }),
            );
        },
      },
    ],
    logLevel: "warning",
  });
}
const server = createServer(async (req, res) => {
  if (req.url === "/before.js" || req.url === "/after.js") {
    res.setHeader("Content-Type", "application/javascript");
    res.end(await readFile(resolve(generated, req.url.slice(1))));
  } else {
    const mode = req.url?.startsWith("/before") ? "before" : "after";
    res.setHeader("Content-Type", "text/html");
    res.end(
      `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;font-family:Segoe UI,sans-serif}*{box-sizing:border-box}</style></head><body><div id="root"></div><script src="/${mode}.js"></script></body></html>`,
    );
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
const errors = [];
const results = [];
// Read the rendered text node containing each paragraph, rather than body text,
// which can hide accidental merging by adding whitespace between descendants.
async function renderedReplies(page) {
  return page.getByTestId("transcript").evaluate((el) =>
    [...el.querySelectorAll("div")]
      .filter(
        (node) =>
          node.children.length === 0 && /For that last case|^Cap$|^Captain, the tooltips/.test(node.textContent),
      )
      .map((node) => ({
        text: node.textContent,
        top: node.getBoundingClientRect().top,
        bottom: node.getBoundingClientRect().bottom,
      })),
  );
}
try {
  browser = await chromium.launch({
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
    headless: true,
  });
  for (const view of ["chat", "watch"]) {
    for (const [size, width, height] of [
      ["wide", 980, 720],
      ["phone", 390, 844],
    ]) {
      for (const mode of ["before", "after"]) {
        for (const theme of ["dark", "light"]) {
          const name = `${mode}-${view}-${size}-${theme}`;
          const page = await browser.newPage({
            viewport: { width, height },
            deviceScaleFactor: 1,
          });
          page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
          await page.goto(`${url}/${mode}?${view}&${theme}`);
          await page
            .getByText(/For that last case/)
            .first()
            .waitFor();
          const replies = await renderedReplies(page);
          assert.equal(replies.length, mode === "before" ? 1 : 2, name);
          if (mode === "before") assert.match(replies[0].text, /reach\.Captain/);
          else {
            assert.match(replies[0].text, /reach\.$/);
            assert.match(replies[1].text, /^Captain, the tooltips/);
            assert.ok(replies[1].top >= replies[0].bottom + 4, `${name}: visible paragraph gap`);
          }
          await page.screenshot({ path: screenshotPath(name) });
          results.push({ name, replies });
          if (mode === "after" && theme === "dark") {
            // A notification-triggered turn begins with an arbitrary partial word.
            await page.evaluate(() => {
              const [first, second] = structuredClone(window.boundaryObserved);
              second.item.text = "Cap";
              second.seqEnd = second.seqStart;
              second.sourceSeqRanges[0].endSeq = second.seqStart;
              second.collapsed = [];
              window.boundarySnapshot([first, second]);
            });
            await page.getByText("Cap", { exact: true }).waitFor();
            const partial = await renderedReplies(page);
            assert.equal(partial.length, 2);
            assert.match(partial[0].text, /reach\.$/);
            assert.equal(partial[1].text, "Cap");
            await page.evaluate(() => window.boundarySnapshot(window.boundaryObserved));
            await page.getByText(/^Captain, the tooltips/).waitFor();
            assert.equal((await renderedReplies(page)).length, 2);
            // The hook retains the last good snapshot during disconnect, then
            // re-reads a replacement page, and gets the same rows on remount.
            await page.evaluate(() => window.boundaryConnection(false));
            await page.getByText("Fixture disconnected", { exact: true }).waitFor();
            assert.equal((await renderedReplies(page)).length, 2);
            await page.evaluate(() => window.boundaryConnection(true));
            await page.getByText("Fixture disconnected", { exact: true }).waitFor({ state: "detached" });
            await page.evaluate(() => window.boundaryRemount());
            await page.getByText(/^Captain, the tooltips/).waitFor();
            assert.equal((await renderedReplies(page)).length, 2);
            assert.ok(await page.evaluate(() => window.boundaryReads.every((read) => read.projection === "projected")));
            // Continuous chunks with the same IDs must remain valid Markdown.
            await page.evaluate(() => {
              const sample = structuredClone(window.boundaryObserved[1]);
              const chunks = [
                "**Ari",
                "adne** proposes:\n\n- chapter ",
                "2\n- chapter 3\n\n```ts\ncon",
                "st n = 2;\n```",
              ];
              window.boundarySnapshot(
                chunks.map((text, i) => ({
                  ...sample,
                  item: { ...sample.item, text },
                  seqStart: 1600 + i,
                  seqEnd: 1600 + i,
                  sourceSeqRanges: [{ startSeq: 1600 + i, endSeq: 1600 + i }],
                  collapsed: [],
                })),
              );
            });
            await page.getByText("const n = 2;", { exact: true }).waitFor();
            await page.getByText("chapter 2", { exact: true }).waitFor();
            await page.getByText("chapter 3", { exact: true }).waitFor();
            assert.equal(await page.getByText("Ariadne", { exact: true }).count(), 1);
            await page.screenshot({
              path: screenshotPath(`chunks-${view}-${size}`),
            });
          }
          await page.close();
        }
      }
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(generated, "results.json"), JSON.stringify(results, null, 2));
  console.log(
    `16 boundary screenshots and 4 streaming/reconnect/Markdown checks passed; baseline reproduces reach.Captain.`,
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
