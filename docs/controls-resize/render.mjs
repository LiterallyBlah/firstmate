/** Real components, synthetic host only. Never connects to Paseo or operates a session. */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const rootRequire = createRequire(resolve(root, "package.json"));
const fixtureRequire = createRequire(
  resolve(here, "../board-list/package.json"),
);
const { build } = fixtureRequire("esbuild");
const { chromium } = fixtureRequire("playwright");
const generated = resolve(here, ".generated");
await mkdir(generated, { recursive: true });
const baseline = "830cd6a"; // main before controls/resize work; deployed resize sources are identical
for (const mode of ["before", "visible-only", "after"])
  await build({
    entryPoints: [resolve(here, "panel.jsx")],
    outfile: resolve(generated, `${mode}.js`),
    bundle: true,
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [
      {
        name: "host-fixture",
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
            path: fixtureRequire.resolve(args.path),
          }));
          builder.onResolve({ filter: /^react-native($|-web$)/ }, () => ({
            path: fixtureRequire.resolve("react-native-web"),
          }));
          if (mode !== "after")
            builder.onLoad({ filter: /\.(ts|tsx)$/ }, (args) => {
              const path = relative(root, args.path).split(sep).join("/");
              if (!/^(client|shared)\//.test(path)) return;
              let contents = execFileSync(
                "git",
                ["show", `${baseline}:${path}`],
                { cwd: root, encoding: "utf8" },
              );
              if (
                mode === "visible-only" &&
                path === "client/resize-handle.tsx"
              )
                contents = contents.replace(
                  "line: { width:",
                  "line: { flex: 1, width:",
                );
              return {
                contents,
                loader: path.endsWith("tsx") ? "tsx" : "ts",
                resolveDir: dirname(args.path),
              };
            });
        },
      },
    ],
    logLevel: "warning",
  });
const server = createServer(async (request, response) => {
  const path = request.url?.split("?")[0];
  if (["/before.js", "/visible-only.js", "/after.js"].includes(path)) {
    response.setHeader("Content-Type", "application/javascript");
    response.end(await readFile(resolve(generated, path.slice(1))));
    return;
  }
  const mode = path?.startsWith("/before")
    ? "before"
    : path?.startsWith("/visible-only")
      ? "visible-only"
      : "after";
  response.setHeader("Content-Type", "text/html");
  response.end(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:Segoe UI,sans-serif}*{box-sizing:border-box}</style></head><body><div id="root"></div><script src="/${mode}.js"></script></body></html>`,
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [];
const errors = [];
async function open(mode, width, theme = "dark", zoom = 1, extra = "") {
  const page = await browser.newPage({ viewport: { width, height: 960 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${url}/${mode}?theme=${theme}&zoom=${zoom}${extra}`);
  await page.getByRole("button", { name: "Bearings", exact: true }).waitFor();
  return page;
}
async function drag(page, handle, dx) {
  const box = await handle.boundingBox();
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 12 });
  await page.mouse.up();
}
try {
  // Reproduce before changing anything: line height, pointer path, scaling,
  // constrained widths, keyboard reachability and actual settings commit.
  for (const [width, zoom] of process.env.FM_TEST_ONLY === "controls"
    ? []
    : [
        [1280, 1],
        [800, 1],
        [1600, 2],
      ]) {
    const page = await open(
      "before",
      width,
      "dark",
      zoom,
      "&label=Before%3A%20invisible%20divider",
    );
    const handle = page.getByRole("slider", { name: "Resize the chat" });
    const before = await handle.boundingBox();
    const line = await handle.locator(":scope > div").boundingBox();
    const tabIndex = await handle.getAttribute("tabindex");
    await drag(page, handle, 100);
    await page.waitForTimeout(550);
    const after = await handle.boundingBox();
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("fixture:display")),
    );
    results.push({
      mode: "before",
      width,
      zoom,
      line,
      tabIndex,
      movedPixels: after.x - before.x,
      savedShare: saved.chatWidthFraction,
    });
    await drag(page, handle, width);
    await page.waitForTimeout(550);
    const edge = await handle.boundingBox();
    results.at(-1).crewPixelsAtMax = (width - edge.x - edge.width) / zoom;
    if (width === 800)
      await page.screenshot({ path: resolve(here, "before-narrow-dark.png") });
    assert.equal(line.height, 0); // invisible despite a live pointer responder
    assert.equal(tabIndex, null);
    await page.close();
  }
  // Small counterfactual: only give the old line height. It becomes visible,
  // while the working normal-scale drag and existing save path stay identical.
  const counter = await open("visible-only", 1280);
  const oldHandle = counter.getByRole("slider", { name: "Resize the chat" });
  assert((await oldHandle.locator(":scope > div").boundingBox()).height > 0);
  const counterStart = await oldHandle.boundingBox();
  await drag(counter, oldHandle, 100);
  assert.equal((await oldHandle.boundingBox()).x - counterStart.x, 100);
  results.push({
    mode: "visible-only",
    paintedHeight: (await oldHandle.locator(":scope > div").boundingBox())
      .height,
    movedPixels: 100,
  });
  await counter.close();

  for (const [width, zoom] of process.env.FM_TEST_ONLY === "controls"
    ? []
    : [
        [1280, 1],
        [800, 1],
        [638, 1],
        [1600, 2],
      ])
    for (const theme of ["light", "dark"])
      for (const view of ["list", "board"]) {
        const page = await open(
          "after",
          width,
          theme,
          zoom,
          `&label=${view}%20pointer%20resize`,
        );
        if (view === "board") {
          await page.getByRole("tab", { name: "Board", exact: true }).click();
          await page.waitForTimeout(550);
        }
        const handle = page.getByRole("separator", { name: "Chat width" });
        await handle.waitFor();
        assert.equal(await handle.getAttribute("tabindex"), "0");
        assert.equal(await handle.getAttribute("aria-orientation"), "vertical");
        assert.equal(
          await handle.getAttribute("aria-controls"),
          "firstmate-chat-pane",
        );
        assert.equal(
          await handle.evaluate((el) => getComputedStyle(el).cursor),
          "col-resize",
        );
        assert(
          (await handle.locator(":scope > div").first().boundingBox()).height >
            0,
        );
        const before = await handle.boundingBox();
        await page.evaluate(() => {
          window.fixtureSaves = [];
        });
        const x = before.x + before.width / 2,
          y = before.y + before.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 100, y, { steps: 12 });
        assert.equal(await page.evaluate(() => window.fixtureSaves.length), 0);
        await page.mouse.up();
        await page.waitForTimeout(550);
        assert.equal(await page.evaluate(() => window.fixtureSaves.length), 1);
        const after = await handle.boundingBox();
        if (width !== 638)
          assert(
            Math.abs(after.x - before.x - 100) <= 1,
            `pointer follows rendered pixels: ${width}/${zoom}/${view}`,
          );
        const savedShare = await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("fixture:display"))
              .chatWidthFraction,
        );
        await page.evaluate(() => window.fixtureRemount());
        await page.waitForTimeout(100);
        assert(
          Math.abs((await handle.boundingBox()).x - after.x) <= 1,
          "width persists through remount",
        );
        await page.reload();
        await handle.waitFor();
        await page.waitForTimeout(100);
        assert(
          Math.abs((await handle.boundingBox()).x - after.x) <= 1,
          "width persists through page reload",
        );
        if (
          (width === 1280 &&
            ((view === "list" && theme === "dark") ||
              (view === "board" && theme === "light"))) ||
          (width === 800 &&
            ((view === "list" && theme === "light") ||
              (view === "board" && theme === "dark"))) ||
          (width === 1600 && view === "board" && theme === "dark")
        ) {
          await page.screenshot({
            path: resolve(here, `after-${view}-${width}-${theme}.png`),
          });
        }
        await handle.focus();
        const keyStart = await handle.boundingBox();
        await page.keyboard.press("ArrowRight");
        const keyEnd = await handle.boundingBox();
        if (width !== 638)
          assert(Math.abs(keyEnd.x - keyStart.x - 16 * zoom) <= 1);
        await page.keyboard.press("Shift+ArrowLeft");
        await page.keyboard.press("Home");
        assert(
          (await page.locator("#firstmate-chat-pane").boundingBox()).width /
            zoom >=
            320,
        );
        await page.keyboard.press("End");
        const maximum = await handle.boundingBox();
        const crewWidth = (width - maximum.x - maximum.width) / zoom;
        assert(crewWidth >= 300, `crew minimum: ${crewWidth}`);
        assert(Number(await handle.getAttribute("aria-valuenow")) > 0);
        await drag(page, handle, -width);
        const minimum = await page
          .locator("#firstmate-chat-pane")
          .boundingBox();
        assert(minimum.width / zoom >= 320);
        const constrainedShare = await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("fixture:display"))
              .chatWidthFraction,
        );
        results.push({
          mode: "after",
          width,
          zoom,
          theme,
          view,
          movedPixels: after.x - before.x,
          savedShare,
          crewWidth,
          minimumChatWidth: minimum.width / zoom,
          constrainedShare,
        });
        assert.deepEqual(await page.evaluate(() => window.fixtureErrors), []);
        await page.close();
      }

  // Tooltip focus/hover, Escape, hoverable popup, descriptions, exact actions.
  const tips = await open(
    "after",
    1280,
    "dark",
    1,
    "&label=Control%20purpose%20on%20focus",
  );
  for (const label of ["Bearings", "Ahoy", "Compact", "Restart"]) {
    const button = tips.getByRole("button", { name: label, exact: true });
    await button.focus();
    const tooltip = tips.getByRole("tooltip");
    await tooltip.waitFor();
    assert.equal(
      await button.getAttribute("aria-describedby"),
      await tooltip.getAttribute("id"),
    );
    await tips.screenshot({
      path: resolve(here, `tooltip-${label.toLowerCase()}-dark.png`),
    });
    await tips.keyboard.press("Escape");
    assert.equal(await tips.getByRole("tooltip").count(), 0);
    await tips.locator("textarea").focus();
    await button.hover();
    await tooltip.waitFor();
    await tooltip.hover();
    assert(await tooltip.isVisible());
    await tips.keyboard.press("Escape");
    await tooltip.waitFor({ state: "hidden" });
    await tips.mouse.move(1270, 10);
    await button.hover();
    await tooltip.waitFor();
    await tips.mouse.move(1270, 10);
    await tooltip.waitFor({ state: "hidden" });
  }
  await tips.getByRole("button", { name: "Bearings", exact: true }).click();
  await tips.getByRole("button", { name: "Ahoy", exact: true }).click();
  await tips.getByRole("button", { name: "Compact", exact: true }).click();
  assert(
    await tips.evaluate(() =>
      window.fixtureCalls.some(
        (c) =>
          c.name === "firstmate.mate.command" && c.input.command === "bearings",
      ),
    ),
  );
  assert(
    await tips.evaluate(() =>
      window.fixtureCalls.some(
        (c) =>
          c.name === "firstmate.mate.command" && c.input.command === "ahoy",
      ),
    ),
  );
  assert(
    await tips.evaluate(() =>
      window.fixtureCalls.some((c) => c.name === "firstmate.mate.compact"),
    ),
  );
  await tips.getByRole("button", { name: "Restart", exact: true }).click();
  await tips.getByRole("dialog", { name: "Restart the first mate?" }).waitFor();
  assert(
    !(await tips.evaluate(() =>
      window.fixtureCalls.some((c) => c.name === "firstmate.mate.restart"),
    )),
    "restart remains confirmed",
  );
  await tips.getByRole("button", { name: "Cancel", exact: true }).click();
  await tips.close();

  // Wide/compact threshold roundtrip preserves the unmodified preference;
  // collapse still hides the separator, and phones keep their existing tabs.
  const narrow = await open("after", 1024);
  const separator = narrow.getByRole("separator", { name: "Chat width" });
  await drag(narrow, separator, 150);
  await narrow.waitForTimeout(550);
  const preference = await narrow.evaluate(() =>
    localStorage.getItem("fixture:display"),
  );
  await narrow.setViewportSize({ width: 620, height: 960 });
  await separator.waitFor({ state: "hidden" });
  await narrow.getByRole("tab", { name: "Crew (45)" }).waitFor();
  await narrow.setViewportSize({ width: 1024, height: 960 });
  await separator.waitFor();
  assert.equal(
    await narrow.evaluate(() => localStorage.getItem("fixture:display")),
    preference,
  );
  await narrow.getByRole("button", { name: "Hide the chat" }).click();
  await separator.waitFor({ state: "hidden" });
  await narrow.getByRole("button", { name: "Show the chat" }).first().click();
  await separator.waitFor();
  await narrow.getByRole("button", { name: "Hide the board" }).click();
  await separator.waitFor({ state: "hidden" });
  await narrow.getByRole("button", { name: "Show the board" }).first().click();
  await separator.waitFor();
  // Leave immediately after a completed drag, before the settings batch fires.
  await narrow.waitForTimeout(550);
  await drag(narrow, separator, 32);
  const leaving = await separator.boundingBox();
  await narrow.evaluate(() => window.fixtureRemount());
  await narrow.waitForTimeout(100); // Let React commit the unmount and its cleanup.
  // The synthetic adapter's new useState can render before the old component's
  // cleanup. Verify the actual saved value, then read it through a fresh page.
  const savedLeaving = await narrow.evaluate(() => ({
    settings: JSON.parse(localStorage.getItem("fixture:display")),
    saves: window.fixtureSaves,
  }));
  assert(
    Math.abs(savedLeaving.settings.chatWidthFraction * 1024 - leaving.x) <= 1,
    JSON.stringify({ leaving, savedLeaving }),
  );
  await narrow.reload();
  await separator.waitFor();
  await narrow.waitForTimeout(100);
  assert(
    Math.abs((await separator.boundingBox()).x - leaving.x) <= 1,
    "early unmount flushes committed width",
  );
  await narrow.close();
  for (const theme of ["light", "dark"]) {
    const phone = await open(
      "after",
      390,
      theme,
      1,
      "&compact=true&label=Compact%20phone",
    );
    assert.equal(await phone.getByRole("separator").count(), 0);
    await phone.getByRole("button", { name: "Restart", exact: true }).focus();
    await phone.getByRole("tooltip").waitFor();
    await phone.screenshot({ path: resolve(here, `phone-chat-${theme}.png`) });
    const popup = await phone.getByRole("tooltip").boundingBox();
    assert(popup.x >= 0 && popup.x + popup.width <= 390);
    await phone.getByRole("tab", { name: "Crew (45)" }).click();
    await phone.getByRole("tab", { name: "Board", exact: true }).click();
    await phone.screenshot({ path: resolve(here, `phone-board-${theme}.png`) });
    assert.equal(await phone.getByRole("separator").count(), 0);
    await phone.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(generated, "results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  server.close();
}
