/** The real FleetSurface and sender with fixture-only host RPCs; never connects to Paseo. */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url)),
  root = resolve(here, "../..");
const rootRequire = createRequire(resolve(root, "package.json"));
const fixtureRequire = createRequire(
  resolve(here, "../board-list/package.json"),
);
const { build } = fixtureRequire("esbuild"),
  { chromium } = fixtureRequire("playwright");
const generated = resolve(here, ".generated");
await mkdir(generated, { recursive: true });
await build({
  entryPoints: [resolve(here, "panel.jsx")],
  outfile: resolve(generated, "panel.js"),
  bundle: true,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "synthetic-host",
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
      },
    },
  ],
  logLevel: "warning",
});
const server = createServer(async (req, res) => {
  if (req.url === "/panel.js") {
    res.setHeader("Content-Type", "application/javascript");
    res.end(await readFile(resolve(generated, "panel.js")));
  } else {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:Segoe UI,sans-serif}*{box-sizing:border-box}</style><div id="root"></div><script src="/panel.js"></script>',
    );
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [],
  errors = [];
try {
  for (const width of [1440, 390])
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({
        viewport: { width, height: width === 390 ? 844 : 1000 },
      });
      page.on("pageerror", (error) => errors.push(error.message));
      for (const state of [
        "checking",
        "available",
        "current",
        "unavailable",
        "no-mate",
      ]) {
        const name = `${width === 390 ? "narrow" : "desktop"}-${theme}-${state}`;
        await page.goto(`${url}/?theme=${theme}&state=${state}`);
        const label =
          state === "checking"
            ? "Checking FirstMate update"
            : state === "current"
              ? "FirstMate is current"
              : state === "unavailable"
                ? "FirstMate update unavailable"
                : "Update FirstMate to bbbbbbbb";
        const control = page.getByRole("button", { name: label, exact: true });
        await control.waitFor();
        await control.hover();
        const tip = page
          .getByRole("tooltip", { includeHidden: false })
          .filter({ hasText: /FirstMate|configured source/ });
        await tip.waitFor();
        const box = await tip.boundingBox();
        assert.ok(box.x >= -1 && box.x + box.width <= width + 1, name);
        if (state !== "available") {
          assert.equal(await control.isDisabled(), true, name);
          await page
            .locator(
              `[tabindex="0"][aria-disabled="true"][aria-label="${label}"]`,
            )
            .focus();
          await page.keyboard.press("Enter");
          assert.equal(
            await page.evaluate(() => window.fixtureMessages ?? 0),
            0,
          );
        } else {
          await control.focus();
          await page.keyboard.press("Escape");
          await page.evaluate(() => {
            const b = [...document.querySelectorAll('[role="button"]')].find(
              (b) =>
                b.getAttribute("aria-label") === "Update FirstMate to bbbbbbbb",
            );
            b.click();
            b.click();
          });
          await page.waitForFunction(() => Boolean(window.releaseRequest));
          assert.equal(
            await page.evaluate(
              () =>
                window.fixtureCalls.filter(
                  (c) => c.name === "firstmate.update.request",
                ).length,
            ),
            1,
          );
          assert.equal(
            await page
              .getByRole("button", { name: "Bearings", exact: true })
              .isDisabled(),
            true,
          );
          await page.evaluate(() => window.releaseRequest());
          await page
            .getByRole("button", {
              name: "FirstMate update requested",
              exact: true,
            })
            .waitFor();
          assert.equal(await page.evaluate(() => window.fixtureMessages), 1);
          // Capture the verified available state; pending/success behavior was already exercised above.
          await page.goto(`${url}/?theme=${theme}&state=available`);
          await control.waitFor();
          await control.hover();
          await tip.waitFor();
        }
        await page.screenshot({ path: resolve(here, `${name}.png`) });
        results.push(name);
      }
      // A stale availability response naturally replaces the status and sends no chat message.
      await page.goto(`${url}/?theme=${theme}&state=available`);
      await page
        .getByRole("button", {
          name: "Update FirstMate to bbbbbbbb",
          exact: true,
        })
        .click();
      await page.waitForFunction(() => Boolean(window.releaseRequest));
      await page.evaluate(() => {
        window.fixtureStale = true;
        window.releaseRequest();
      });
      await page
        .getByRole("button", { name: "FirstMate is current", exact: true })
        .waitFor();
      assert.equal(await page.evaluate(() => window.fixtureMessages ?? 0), 0);
      await page.close();
    }
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(generated, "results.json"),
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(
    `Verified ${results.length} labelled screenshots, hover/focus help, duplicate/shared-gate and stale/current no-send behavior.`,
  );
} catch (error) {
  for (const [i, page] of browser
    .contexts()
    .flatMap((c) => c.pages())
    .entries())
    await page.screenshot({ path: resolve(here, `failed-${i}.png`) });
  await writeFile(
    resolve(here, "failed-render.txt"),
    `${String(error.stack ?? error)}\nPage errors: ${JSON.stringify(errors)}`,
  );
  throw error;
} finally {
  await browser.close();
  server.close();
}
