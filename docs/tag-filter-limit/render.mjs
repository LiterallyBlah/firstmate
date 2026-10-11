/** Reuse the item-tags fixture and board-list browser dependencies. Never connects to a daemon. */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, relative, sep } from "node:path";
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
const baseline = "611e9cd0d5f4fb751dc36b5b8451c78b9ed1bd27";
await mkdir(generated, { recursive: true });
for (const mode of ["before", "after"]) {
  await build({
    entryPoints: [resolve(here, "../item-tags/panel.jsx")],
    outfile: resolve(generated, `${mode}.js`),
    bundle: true,
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    logLevel: "warning",
    plugins: [
      {
        name: "existing-isolated-host",
        setup(builder) {
          builder.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({
            path: resolve(here, "../board-list/contracts.js"),
          }));
          builder.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({
            path: resolve(here, "../item-tags/stubs.jsx"),
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
          if (mode === "before")
            builder.onLoad({ filter: /\.(ts|tsx)$/ }, (args) => {
              const path = relative(root, args.path).split(sep).join("/");
              if (!/^(client|shared)\//.test(path)) return;
              return {
                contents: execFileSync("git", ["show", `${baseline}:${path}`], {
                  cwd: root,
                  encoding: "utf8",
                }),
                loader: path.endsWith("tsx") ? "tsx" : "ts",
                resolveDir: dirname(args.path),
              };
            });
        },
      },
    ],
  });
}
const server = createServer(async (req, res) => {
  if (/^\/(before|after)\.js$/.test(req.url)) {
    res.setHeader("Content-Type", "application/javascript");
    res.end(await readFile(resolve(generated, req.url.slice(1))));
  } else {
    const mode = req.url.startsWith("/before") ? "before" : "after";
    res.setHeader("Content-Type", "text/html");
    res.end(
      `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:Segoe UI,sans-serif}*{box-sizing:border-box}</style><div id="root"></div><script src="/${mode}.js"></script>`,
    );
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [],
  errors = [];
let currentPage, currentName;
const filters = (page) => page.getByRole("checkbox", { name: /^Filter tag / });
const tag = (page, name, count) =>
  page.getByRole("checkbox", {
    name: `Filter tag ${name}, ${count} items`,
    exact: true,
  });
const more = (page) =>
  page.getByRole("button", { name: "Show more tag filters", exact: true });
const less = (page) =>
  page.getByRole("button", { name: "Show less tag filters", exact: true });
const clear = (page) =>
  page.getByRole("button", { name: "Clear tag filters", exact: true });
const taskRows = (page) =>
  page.getByRole("button", { name: /(?:Show|Hide) details and actions$/ });
async function crew(page, width) {
  await page.getByRole("button", { name: "Bearings", exact: true }).waitFor();
  if (width < 638) await page.getByRole("tab", { name: /^Crew \(/ }).click();
}
async function capture(page, name) {
  await page.screenshot({ path: resolve(here, `${name}.png`) });
}
async function collapsed(page) {
  await more(page).waitFor();
  await page.waitForFunction(() => {
    const tray = document.querySelector(
      '[data-testid="firstmate-tag-filter-choices"]',
    );
    return (
      tray &&
      tray.clientHeight <= 71 &&
      tray.querySelector('[aria-hidden="true"]')
    );
  });
  const measured = await page
    .getByTestId("firstmate-tag-filter-choices")
    .evaluate((tray) => {
      const visible = [...tray.querySelectorAll('[role="checkbox"]')].filter(
        (chip) => chip.getAttribute("aria-hidden") !== "true",
      );
      const rows = new Set(
        visible.map((chip) => Math.round(chip.getBoundingClientRect().top)),
      );
      return {
        height: tray.clientHeight,
        rows: rows.size,
        visible: visible.length,
        total: tray.querySelectorAll('[role="checkbox"]').length,
        hiddenFocusable: [
          ...tray.querySelectorAll('[aria-hidden="true"]'),
        ].some((chip) => chip.tabIndex !== -1),
      };
    });
  assert.ok(measured.rows <= 2, JSON.stringify(measured));
  assert.equal(measured.hiddenFocusable, false);
  return measured;
}
try {
  // The screenshot-shaped baseline: exactly 19 choices wrapping to three rows.
  currentName = "before-list-desktop-dark";
  const before = (currentPage = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  }));
  await before.goto(`${url}/before?tags=19&view=list`);
  await crew(before, 1440);
  assert.equal(await filters(before).count(), 19);
  const baselineRows = await filters(before).evaluateAll(
    (chips) =>
      new Set(chips.map((chip) => Math.round(chip.getBoundingClientRect().top)))
        .size,
  );
  assert.equal(baselineRows, 3);
  await capture(before, currentName);
  results.push({ name: currentName, choices: 19, rows: baselineRows });
  await before.close();

  for (const width of [1440, 390])
    for (const theme of ["light", "dark"])
      for (const view of ["list", "board"]) {
        currentName = `${view}-${width === 390 ? "narrow" : "desktop"}-${theme}`;
        const page = (currentPage = await browser.newPage({
          viewport: { width, height: 960 },
        }));
        page.setDefaultTimeout(8000);
        page.on("pageerror", (error) =>
          errors.push(`${currentName}: ${error.message}`),
        );
        await page.goto(`${url}/after?tags=19&view=${view}&theme=${theme}`);
        await crew(page, width);
        const measurement = await collapsed(page);
        assert.equal(measurement.total, view === "list" ? 17 : 19);
        await filters(page).last().focus();
        await page.keyboard.press("Tab");
        assert.equal(
          await page.evaluate(() =>
            document.activeElement?.getAttribute("aria-hidden"),
          ),
          null,
        );
        await capture(page, currentName);
        await more(page).focus();
        await page.keyboard.press("Enter");
        await less(page).waitFor();
        assert.equal(await filters(page).count(), view === "list" ? 17 : 19);
        const last = tag(page, "Windows support", 1);
        await last.scrollIntoViewIfNeeded();
        await last.focus();
        await page.keyboard.down("Space");
        await page.keyboard.down("Space"); // Repeating a held key must not toggle twice.
        await page.keyboard.up("Space");
        await page.waitForFunction(
          () =>
            document
              .querySelector(
                '[aria-label="Filter tag Windows support, 1 items"]',
              )
              .getAttribute("aria-checked") === "true",
        );
        await capture(page, `${currentName}-expanded-selected`);
        await less(page).focus();
        await page.keyboard.press("Space");
        await collapsed(page);
        assert.ok(
          await more(page).evaluate((node) => document.activeElement === node),
        );
        await page
          .getByText("Filter tags · 1 selected · match all", { exact: true })
          .waitFor();
        assert.ok(await clear(page).isVisible());
        // Hidden selections persist through the existing host settings save and a reload.
        await page.waitForFunction(() =>
          JSON.parse(
            localStorage.getItem("fixture-display") ?? "{}",
          ).tagFilter?.includes("Windows support"),
        );
        await page.reload();
        await crew(page, width);
        await collapsed(page);
        await page
          .getByText("Filter tags · 1 selected · match all", { exact: true })
          .waitFor();
        await page
          .getByRole("tab", {
            name: view === "list" ? "Board" : "List",
            exact: true,
          })
          .click();
        await page
          .getByText("Filter tags · 1 selected · match all", { exact: true })
          .waitFor();
        await page
          .getByRole("tab", {
            name: view === "list" ? "List" : "Board",
            exact: true,
          })
          .click();
        await more(page).click();
        await tag(page, "Windows support", 1).scrollIntoViewIfNeeded();
        assert.equal(
          await tag(page, "Windows support", 1).getAttribute("aria-checked"),
          "true",
        );
        await tag(page, "Windows support", 1).click(); // Individual removal, not tag deletion.
        assert.equal(await clear(page).count(), 0);
        await tag(page, "Accessibility", 1).click();
        await tag(page, "Dashboard", view === "list" ? 2 : 3).click();
        assert.equal(await taskRows(page).count(), 1); // Match all, not any.
        await page.getByRole("tab", { name: /^Light, online/ }).click();
        await page
          .getByText("No items match the selected tags on this host.", {
            exact: true,
          })
          .waitFor();
        await tag(page, "Accessibility", 0).waitFor();
        await tag(page, "Dashboard", 0).waitFor();
        assert.ok(await clear(page).isVisible());
        await clear(page).click();
        await page.getByRole("tab", { name: /^All, / }).click();

        // Scope follows completion visibility. Zero-count selections remain clearable after hiding Done.
        if (view === "list") {
          assert.equal(await tag(page, "Archived release", 1).count(), 0);
          await page
            .getByRole("button", {
              name: "1 done. Show completed tasks",
              exact: true,
            })
            .click();
        } else {
          await page
            .getByRole("button", { name: "Fold Done", exact: true })
            .click();
          assert.equal(await tag(page, "Archived release", 1).count(), 0);
          await page
            .getByRole("button", { name: "Unfold Done", exact: true })
            .click();
        }
        if (await more(page).count()) await more(page).click();
        await tag(page, "Archived release", 1).click();
        if (view === "list")
          await page
            .getByRole("button", {
              name: "1 done. Hide completed tasks",
              exact: true,
            })
            .click();
        else
          await page
            .getByRole("button", { name: "Fold Done", exact: true })
            .click();
        await tag(page, "Archived release", 0).waitFor();
        await page
          .getByText("Filter tags · 1 selected · match all", { exact: true })
          .waitFor();
        await clear(page).click();
        assert.equal(await tag(page, "Archived release", 0).count(), 0);
        if (width === 390 && theme === "light" && view === "list") {
          if (await more(page).count()) await more(page).click();
          for (let index = 0; index < 12; index++)
            await filters(page).nth(index).click();
          await page
            .getByText("Filter tags · 12 selected · match all", { exact: true })
            .waitFor();
          assert.equal(
            await page.getByRole("checkbox", { disabled: true }).count(),
            5,
          );
          await filters(page).first().click();
          assert.equal(
            await page.getByRole("checkbox", { disabled: true }).count(),
            0,
          );
          await clear(page).click();
        }
        await page.waitForFunction(
          () =>
            JSON.parse(localStorage.getItem("fixture-display") ?? "{}")
              .tagFilter?.length === 0,
        );
        assert.deepEqual(
          await page.evaluate(
            () =>
              window.fixtureFleet.cards.find((card) => card.column === "done")
                .tags,
          ),
          ["Archived release", "Legacy migration", "Dashboard"],
        );

        // Few tags need no disclosure. Existing item tags and counts still render.
        await page.evaluate(() => localStorage.removeItem("fixture-display"));
        await page.goto(`${url}/after?view=${view}&theme=${theme}`);
        await crew(page, width);
        await tag(page, "Frontend", view === "list" ? 2 : 3).waitFor();
        await page.waitForFunction(
          () => !document.querySelector('[aria-label="Show more tag filters"]'),
        );
        assert.equal(await filters(page).count(), 2);
        await capture(page, `${currentName}-few`);
        results.push({
          name: currentName,
          ...measurement,
          checks:
            "disclosure keyboard, reach last tag, hidden focus, saved filter reload, individual removal, match all, host intersection, completion scope, selected zero counts, clear, few tags",
        });
        await page.close();
      }

  // Resize a focused tag from a wide single row to hidden overflow, with active filtering retained.
  for (const theme of ["light", "dark"])
    for (const view of ["list", "board"]) {
      currentName = `${view}-resized-${theme}`;
      const page = (currentPage = await browser.newPage({
        viewport: { width: 3600, height: 960 },
      }));
      await page.goto(`${url}/after?tags=19&view=${view}&theme=${theme}`);
      await crew(page, 3600);
      await tag(page, "Windows support", 1).click();
      await tag(page, "Windows support", 1).focus();
      await page.setViewportSize({ width: 1100, height: 960 });
      await collapsed(page);
      await page.waitForFunction(
        () =>
          document.activeElement?.getAttribute("aria-label") ===
          "Show more tag filters",
      );
      await page
        .getByText("Filter tags · 1 selected · match all", { exact: true })
        .waitFor();
      await capture(page, currentName);
      await page.setViewportSize({ width: 800, height: 960 });
      await crew(page, 800);
      await collapsed(page);
      assert.ok(await clear(page).isVisible());
      await capture(page, `${currentName}-800`);
      await page.setViewportSize({ width: 390, height: 960 });
      await crew(page, 390);
      await collapsed(page);
      assert.ok(await clear(page).isVisible());
      await capture(page, `${currentName}-390`);
      await page.setViewportSize({ width: 1440, height: 960 });
      await collapsed(page);
      await clear(page).click();
      results.push({
        name: currentName,
        widths: [3600, 1100, 800, 390, 1440],
        focusTransferred: true,
        selectedClearVisible: true,
      });
      await page.close();
    }
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(here, "verification.json"),
    JSON.stringify({ baseline, results, errors }, null, 2) + "\n",
  );
  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  if (currentPage && !currentPage.isClosed())
    await capture(currentPage, `failed-${currentName}`);
  await writeFile(
    resolve(here, "failed-receipt.txt"),
    String(error.stack) + "\n",
  );
  throw error;
} finally {
  await browser.close();
  server.close();
}
