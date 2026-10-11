/** Isolated browser verification. No daemon, model, installed plugin or real home is used. */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
await build({
  entryPoints: [resolve(here, "panel.jsx")],
  outfile: resolve(generated, "panel.js"),
  bundle: true,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "warning",
  plugins: [
    {
      name: "isolated-host",
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
});
const server = createServer(async (request, response) => {
  const bundle = request.url === "/panel.js";
  response.setHeader(
    "Content-Type",
    bundle ? "application/javascript" : "text/html",
  );
  response.end(
    bundle
      ? await readFile(resolve(generated, "panel.js"))
      : '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:Segoe UI,sans-serif}*{box-sizing:border-box}</style></head><body><div id="root"></div><script src="/panel.js"></script></body></html>',
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [];
const errors = [];
let currentPage, currentName;
const rows = (page) =>
  page.getByRole("button", { name: /(?:Show|Hide) details and actions$/ });
async function crew(page, width) {
  await page.getByRole("button", { name: "Bearings", exact: true }).waitFor();
  if (width < 600) await page.getByRole("tab", { name: /^Crew \(/ }).click();
}
try {
  for (const width of [1440, 390])
    for (const theme of ["light", "dark"])
      for (const view of ["list", "board"]) {
        const name = `${view}-${width < 600 ? "narrow" : "desktop"}-${theme}`;
        currentName = name;
        const page = (currentPage = await browser.newPage({
          viewport: { width, height: 960 },
        }));
        page.setDefaultTimeout(10000);
        page.on("pageerror", (error) =>
          errors.push(`${name}: ${error.message}`),
        );
        await page.goto(`${url}/?theme=${theme}&view=${view}`);
        await crew(page, width);
        await page
          .getByRole("checkbox", {
            name: `Filter tag Frontend, ${view === "list" ? 2 : 3} items`,
          })
          .waitFor();
        await page.screenshot({ path: resolve(here, `${name}.png`) });
        if (view === "list")
          await page
            .getByRole("button", { name: "1 done. Show completed tasks" })
            .click();
        assert.equal(await rows(page).count(), 5);
        const card = page.getByRole("button", {
          name: /Polish item tags.*Show details/,
        });
        await card.focus();
        await page.keyboard.press("Enter");
        const input = page.getByRole("textbox", {
          name: "New tag for Polish item tags",
        });
        await input.fill("Docs");
        await input.press("Enter");
        await page
          .getByRole("button", { name: "Remove tag Docs", exact: true })
          .waitFor();
        assert.equal(
          await page.evaluate(
            () =>
              window.fixtureCalls.filter(
                (call) => call.name === "firstmate.item.tag",
              ).length,
          ),
          1,
        );
        await page.screenshot({ path: resolve(here, `${name}-edit.png`) });
        await page
          .getByRole("button", { name: "Remove tag Docs", exact: true })
          .click();
        await page
          .getByRole("checkbox", { name: /^Filter tag Docs/ })
          .waitFor({ state: "hidden" });
        await page
          .getByRole("button", { name: /Polish item tags.*Hide details/ })
          .click();
        await page
          .getByRole("checkbox", { name: "Filter tag Frontend, 3 items" })
          .click();
        await page
          .getByRole("checkbox", { name: "Filter tag Dashboard, 3 items" })
          .click();
        assert.equal(await rows(page).count(), 2);
        await page.getByRole("tab", { name: /^Light, online/ }).click();
        await page
          .getByText("No items match the selected tags on this host.", {
            exact: true,
          })
          .waitFor();
        assert.equal(await rows(page).count(), 0);
        await page.screenshot({ path: resolve(here, `${name}-filtered.png`) });
        await page.getByRole("tab", { name: /^All, / }).click();
        await page.waitForFunction(
          () =>
            JSON.parse(localStorage.getItem("fixture-display") ?? "{}")
              .tagFilter?.length === 2,
        );
        await page.reload();
        await crew(page, width);
        await page
          .getByRole("checkbox", {
            name: `Filter tag Frontend, ${view === "list" ? 2 : 3} items`,
            checked: true,
          })
          .waitFor();
        assert.equal(
          await page.getByRole("checkbox", { checked: true }).count(),
          2,
        );
        await page
          .getByRole("button", { name: "Clear tag filters", exact: true })
          .click();
        await page
          .getByRole("button", { name: /Polish item tags.*Show details/ })
          .click();
        await page.evaluate(() => {
          window.fixtureFailTag = true;
        });
        await input.fill("Retry");
        await page
          .getByRole("button", { name: "Add tag", exact: true })
          .click();
        await page.getByRole("alert").waitFor();
        assert.equal(
          await page
            .getByRole("button", { name: "Remove tag Retry", exact: true })
            .count(),
          0,
        );
        await page.screenshot({
          path: resolve(here, `${name}-save-error.png`),
        });
        await page.evaluate(() => {
          window.fixtureFailTag = false;
          window.fixtureErrors = [];
        });
        await page
          .getByRole("button", { name: "Add tag", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Remove tag Retry", exact: true })
          .waitFor();
        await page.reload();
        await crew(page, width);
        await page
          .getByRole("button", { name: /Polish item tags.*Show details/ })
          .click();
        await page
          .getByRole("button", { name: "Remove tag Retry", exact: true })
          .waitFor();
        await page
          .getByRole("button", { name: "Remove tag Retry", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Remove tag Retry", exact: true })
          .waitFor({ state: "hidden" });
        assert.deepEqual(await page.evaluate(() => window.fixtureErrors), []);
        const geometry = await page.evaluate(() => ({
          width: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        }));
        assert.equal(geometry.horizontalOverflow, false);
        results.push({
          name,
          ...geometry,
          checks:
            "keyboard add/remove; AND filter; host intersection; saved filter/tag reload; failed save and retry",
        });
        await page.close();
      }
  // Bound the controls with the largest permitted name and a full set of tags.
  const stress = (currentPage = await browser.newPage({
    viewport: { width: 390, height: 960 },
  }));
  currentName = "board-narrow-light-limit";
  await stress.goto(`${url}/?theme=light&view=board`);
  await crew(stress, 390);
  await stress
    .getByRole("button", { name: /Polish item tags.*Show details/ })
    .click();
  const input = stress.getByRole("textbox", {
    name: "New tag for Polish item tags",
  });
  for (let index = 0; index < 10; index++) {
    const tag = index === 9 ? "W".repeat(40) : `Sample ${index}`;
    await input.fill(tag);
    await input.press("Enter");
    await stress
      .getByRole("button", { name: `Remove tag ${tag}`, exact: true })
      .waitFor();
  }
  assert.equal(await input.isEditable(), false);
  assert(
    await stress
      .getByRole("button", { name: "Add tag", exact: true })
      .isDisabled(),
  );
  const remove = stress.getByRole("button", {
    name: `Remove tag ${"W".repeat(40)}`,
    exact: true,
  });
  const box = await remove.boundingBox();
  assert(box.width <= 350);
  assert(await remove.evaluate((el) => el.scrollWidth <= el.clientWidth));
  await remove.scrollIntoViewIfNeeded();
  await stress.screenshot({
    path: resolve(here, "board-narrow-light-limit.png"),
  });
  await remove.click();
  assert(await input.isEditable());
  assert.equal(
    await stress.evaluate(() => document.documentElement.scrollWidth),
    390,
  );
  results.push({
    name: "board-narrow-light-limit",
    width: 390,
    checks:
      "12 tags; 40-character tag; text fits card; input read-only at limit; removing re-enables editing",
  });
  await stress.close();
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(here, "verification.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  await currentPage?.screenshot({
    path: resolve(here, `failed-${currentName}-${Date.now()}.png`),
  });
  await writeFile(
    resolve(here, "failed-receipts.txt"),
    `${error.stack}\n${errors.join("\n")}\n`,
    { flag: "a" },
  );
  throw error;
} finally {
  await browser.close();
  server.close();
}
