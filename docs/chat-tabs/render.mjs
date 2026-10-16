import { build } from "../board-list/node_modules/esbuild/lib/main.js";
import { chromium } from "../board-list/node_modules/playwright/index.mjs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url)),
  root = resolve(here, "../..");
const rootRequire = createRequire(resolve(root, "package.json")),
  webRequire = createRequire(resolve(here, "../board-list/package.json"));
const generated = resolve(here, ".generated");
await mkdir(generated, { recursive: true });
await build({
  entryPoints: [resolve(here, "panel.jsx")],
  outfile: resolve(generated, "app.js"),
  bundle: true,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "host",
      setup(builder) {
        builder.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({
          path: resolve(here, "../board-list/contracts.js"),
        }));
        builder.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, "stubs.jsx") }));
        builder.onResolve({ filter: /^react($|\/)/ }, (args) => ({ path: rootRequire.resolve(args.path) }));
        builder.onResolve({ filter: /^@tanstack\/react-query$/ }, (args) => ({ path: rootRequire.resolve(args.path) }));
        builder.onResolve({ filter: /^react-dom($|\/)/ }, (args) => ({ path: webRequire.resolve(args.path) }));
        builder.onResolve({ filter: /^react-native($|-web$)/ }, () => ({
          path: webRequire.resolve("react-native-web"),
        }));
      },
    },
  ],
  logLevel: "warning",
});
const server = createServer(async (req, res) => {
  if (req.url === "/app.js") {
    res.setHeader("Content-Type", "application/javascript");
    res.end(await readFile(resolve(generated, "app.js")));
  } else {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;font-family:Segoe UI}*{box-sizing:border-box}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
    );
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
const errors = [];
let browser;
try {
  browser = await chromium.launch({ ...(process.platform === "win32" ? { channel: "msedge" } : {}), headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error(e.stack);
  });
  await page.goto(url + "/?both");
  const chat = page.getByTestId("chat"),
    home = page.getByTestId("home");
  const input = (scope) => scope.getByPlaceholder(/Tell the first mate what/);
  await input(chat).fill("A shared draft");
  await page.waitForFunction(
    () => [...document.querySelectorAll("textarea")].filter((e) => e.value === "A shared draft").length === 2,
  );
  assert.equal(await page.getByText("HIDDEN WATCH PAYLOAD", { exact: false }).count(), 0);
  assert.equal(await page.evaluate(() => window.lastAgentRead), "first-mate");
  assert.ok(
    await page.evaluate(() => window.registeredPanels.some((p) => p.id === "firstmate-chat" && p.title === "Chat")),
  );
  assert.ok(await page.evaluate(() => window.fixtureCalls.some((c) => c.name === "firstmate.mate.seen")));
  // Image sent through one composer appears in both, with exactly one RPC under a delayed response.
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 200;
    c.getContext("2d").fillRect(0, 0, 320, 200);
    return c.toDataURL().split(",")[1];
  });
  const picker = page.waitForEvent("filechooser");
  await chat.getByRole("button", { name: "Attach files or images", exact: true }).click();
  await (await picker).setFiles({ name: "shared.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await home.getByText("shared.png", { exact: true }).waitFor();
  await page.evaluate(() => {
    window.holdSend = true;
  });
  await chat.getByRole("button", { name: "Send", exact: true }).click();
  assert.equal(await home.getByRole("button", { name: "Send", exact: true }).isDisabled(), true);
  assert.equal(await input(home).inputValue(), "");
  await input(home).fill("Next message while sending");
  await page.evaluate(() => window.releaseSend());
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="Image you sent"]').length === 2);
  assert.equal(await page.evaluate(() => window.sends.length), 1);
  assert.equal(await input(chat).inputValue(), "Next message while sending");
  await page.evaluate(() => window.remountChats());
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="Image you sent"]').length === 2);
  assert.equal(await input(chat).inputValue(), "Next message while sending");
  await page.screenshot({ path: resolve(generated, "two-chats.png") });
  // Failure after one copy closes restores the words and attachment into the remaining copy.
  await page.evaluate(() => {
    window.failSend = true;
  });
  await chat.getByRole("button", { name: "Send", exact: true }).click();
  await page.evaluate(() => window.showBoth(false));
  await page.evaluate(() => window.releaseSend());
  await page.waitForFunction(() => document.querySelector("textarea")?.value === "Next message while sending");
  // Replacing the configured mate switches timeline and drafts, regardless of this tab's workspace.
  await page.evaluate(async () => {
    window.chatMate = { ...window.chatMate, id: "replacement" };
    await window.refreshFleet();
  });
  await page.waitForFunction(() => window.lastAgentRead === "replacement");
  assert.equal(await input(chat).inputValue(), "");
  await page.goto(url + "/?view=here");
  await page.getByText("FirstMate here", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Open chat", exact: true }).click();
  await input(chat).waitFor();
  assert.deepEqual(await page.evaluate(() => window.navigationCalls[0]), {
    id: "firstmate-chat",
    workspaceId: "sample",
    location: "workspace",
  });
  await page.goto(url + "/?view=fleet");
  await page.getByRole("button", { name: "Open Chat", exact: true }).click();
  await page.getByText("FirstMate · Chat", { exact: true }).waitFor();
  for (const light of [false, true]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url + "/?" + (light ? "light" : ""));
    await input(chat).fill("Phone draft");
    await input(chat).press("Enter");
    assert.equal(await page.evaluate(() => window.sends.length), 0);
    await page.screenshot({ path: resolve(generated, `phone-${light ? "light" : "dark"}.png`) });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.goto(url + "/?no-mate");
  await page.getByRole("button", { name: "Launch the first mate", exact: true }).waitFor();
  assert.equal(await input(chat).count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "Chat registration, foreign workspace, launcher, context shortcut, shared draft/image/send gate, remount, failed send, mate replacement, filtered watch, read state, phone layout and launch state passed.",
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
