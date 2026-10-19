/** Real FirstMate components, synthetic host APIs. No plugin installation, daemon or real sends. */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { checkTaskViews } from "./view-checks.mjs";
import { checkResilience } from "./resilience-checks.mjs";
const here = dirname(fileURLToPath(import.meta.url)),
  root = resolve(here, "../..");
const harness = createRequire(join(root, "docs/board-list/package.json")),
  local = createRequire(join(root, "package.json"));
const { build } = harness("esbuild"),
  { chromium } = harness("playwright");
const generated = join(here, ".generated");
await mkdir(generated, { recursive: true });
await build({
  entryPoints: [join(here, "panel.jsx")],
  outfile: join(generated, "panel.js"),
  bundle: true,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "warning",
  plugins: [
    {
      name: "host-fixtures",
      setup(builder) {
        builder.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({
          path: join(root, "docs/board-list/contracts.js"),
        }));
        builder.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({
          path: join(here, "stubs.jsx"),
        }));
        builder.onResolve(
          { filter: /^(react|zod|@tanstack\/react-query)($|\/)/ },
          (args) => ({ path: local.resolve(args.path) }),
        );
        builder.onResolve({ filter: /^react-dom($|\/)/ }, (args) => ({
          path: harness.resolve(args.path),
        }));
        builder.onResolve({ filter: /^react-native(-web)?$/ }, () => ({
          path: harness.resolve("react-native-web"),
        }));
      },
    },
  ],
});
const server = createServer(async (request, response) => {
  response.setHeader(
    "Content-Type",
    request.url === "/panel.js" ? "text/javascript" : "text/html",
  );
  response.end(
    request.url === "/panel.js"
      ? await readFile(join(generated, "panel.js"))
      : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:Segoe UI,sans-serif}#root{display:flex;flex-direction:column}*{box-sizing:border-box}</style><div id="root"></div><script src="/panel.js"></script>',
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({
  channel:
    process.platform === "win32" && !process.env.CI ? "msedge" : "chromium",
  headless: true,
});
const errors = [],
  evidence = [];
const base = `http://127.0.0.1:${server.address().port}`;
async function pageAt(query, width = 1440) {
  const page = await browser.newPage({
    viewport: { width, height: 1000 },
    reducedMotion: "reduce",
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`${base}/?${query}`);
  if (new URLSearchParams(query).has("decision"))
    await page
      .getByRole("heading", { name: "Decision a", exact: true })
      .waitFor();
  else
    await page
      .getByRole("button", { name: /^Needs you, \d+ decisions/ })
      .waitFor();
  return page;
}
try {
  if (process.argv.includes("--diagnose")) {
    for (const width of [320, 390]) {
      const page = await pageAt("view=crew", width);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        );
      });
      const boxes = await page
        .getByRole("button", { name: /^Needs you, 3 decisions/ })
        .evaluate((indicator) => {
          const box = (element) => {
            const style = getComputedStyle(element),
              rect = element.getBoundingClientRect();
            return {
              tag: element.tagName,
              id: element.id,
              text: element.textContent.slice(0, 120),
              rect: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
              },
              ...Object.fromEntries(
                [
                  "width",
                  "minWidth",
                  "maxWidth",
                  "display",
                  "visibility",
                  "overflow",
                  "overflowX",
                  "flex",
                  "flexDirection",
                  "flexBasis",
                  "flexGrow",
                  "flexShrink",
                  "flexWrap",
                  "alignItems",
                  "alignSelf",
                  "gridTemplateColumns",
                ].map((key) => [key, style[key]]),
              ),
            };
          };
          const ancestors = [];
          let parent = indicator.parentElement;
          while (parent) {
            ancestors.push(box(parent));
            parent = parent.parentElement;
          }
          const title = [...document.querySelectorAll('[role="heading"]')].find(
            (element) => element.textContent === "Crew",
          );
          return {
            viewport: innerWidth,
            indicator: box(indicator),
            parent: box(indicator.parentElement),
            title: title ? box(title) : null,
            titleRow: title ? box(title.parentElement) : null,
            ancestors,
          };
        });
      await page.screenshot({ path: join(generated, `diagnose-${width}.png`) });
      await writeFile(
        join(generated, `diagnose-${width}.json`),
        JSON.stringify(boxes, null, 2),
        "utf8",
      );
      console.log(JSON.stringify(boxes));
      await page.close();
    }
  } else {
    for (const width of [320, 390, 637, 638, 900, 1440, 1680]) {
      const page = await pageAt(
        `view=crew${width === 900 ? "&light" : ""}`,
        width,
      );
      const indicator = page.getByRole("button", {
        name: /^Needs you, 3 decisions/,
      });
      await page.evaluate(() => document.fonts.ready);
      // Observe the actual header control after RN's asynchronous pane measurement.
      if (width < 638)
        await page.waitForFunction(() => {
          const control = document.querySelector(
            'button[aria-label^="Needs you, 3 decisions"]',
          );
          const title = document.querySelector('[role="heading"]');
          if (!control || !title) return false;
          const rect = control.getBoundingClientRect(),
            parent = control.parentElement;
          const style = getComputedStyle(parent);
          return (
            Math.abs(
              rect.width -
                (parent.clientWidth -
                  parseFloat(style.paddingLeft) -
                  parseFloat(style.paddingRight)),
            ) < 1 &&
            rect.y >= title.parentElement.getBoundingClientRect().bottom
          );
        });
      const rect = await indicator.boundingBox();
      assert.ok(rect.height >= 44);
      if (width < 638) {
        assert.equal(rect.width, width - 24);
        assert.equal(rect.x, 12);
      }
      await page.screenshot({
        path: join(generated, `indicator-${width}.png`),
      });
      await indicator.click();
      await page
        .getByRole("heading", { name: "Decision a", exact: true })
        .waitFor();
      if (width < 1078) {
        const drawer = await page
          .getByLabel("FirstMate decisions", { exact: true })
          .boundingBox();
        assert.equal(drawer.width, width);
        assert.equal(drawer.x, 0);
        await page.getByRole("button", { name: "Close decisions" }).focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        assert.equal(
          await page
            .getByRole("button", { name: "Close decisions" })
            .evaluate((node) => node === document.activeElement),
          true,
        );
      }
      const mutations = () =>
        page.evaluate(() =>
          window.fixtureCalls.filter((c) =>
            /needs-you\.(seen|snooze|answer)/.test(c.name),
          ),
        );
      assert.equal((await mutations()).length, 0);
      assert.equal(
        await page
          .getByRole("button", {
            name: "Answer: Use the cautious option",
            exact: true,
          })
          .count(),
        1,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Answer: General action" })
          .count(),
        0,
      );
      for (const button of await page
        .getByLabel("FirstMate decisions", { exact: true })
        .getByRole("button")
        .all()) {
        if (await button.isVisible()) {
          const b = await button.boundingBox();
          assert.ok(b.height >= 43.5, await button.getAttribute("aria-label"));
        }
      }
      await page
        .getByRole("textbox", { name: "Answer the first mate", exact: true })
        .fill("Retained typed answer");
      await page.evaluate(() => {
        const next = structuredClone(window.attentionSnapshot.requests[0]);
        next.id = "new-arrival";
        next.detectedAt = 0;
        window.attentionSnapshot.requests.push(next);
        window.attentionSnapshot.version++;
        window.attentionSnapshot.freshness.checkedAt = Date.now();
        return window.refreshDecisions();
      });
      assert.equal(
        await page
          .getByRole("heading", { name: "Decision a", exact: true })
          .count(),
        1,
      );
      await page.getByRole("button", { name: "Close decisions" }).focus();
      await page.keyboard.press("Escape");
      await indicator.waitFor();
      await page.waitForFunction(() =>
        document.activeElement?.id.startsWith("needs-you-"),
      );
      await indicator.click();
      await page
        .getByRole("button", { name: "All decisions", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Decision a · new", exact: true })
        .click();
      assert.equal(
        await page
          .getByRole("textbox", { name: "Answer the first mate", exact: true })
          .inputValue(),
        "Retained typed answer",
      );
      await page.screenshot({ path: join(generated, `drawer-${width}.png`) });
      evidence.push({ width, indicatorHeight: rect.height, passed: true });
      await page.close();
    }
    for (const view of ["home", "board", "chat", "crew"]) {
      const page = await pageAt(view === "home" ? "compact" : `view=${view}`);
      assert.equal(
        await page
          .getByRole("button", { name: /^Needs you, 3 decisions/ })
          .count(),
        1,
      );
      await page.close();
    }
    const page = await pageAt("decision=a&revision=99", 390);
    await page
      .getByText("The question changed since this link was opened.", {
        exact: false,
      })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          window.fixtureCalls.filter((c) =>
            /needs-you\.(seen|snooze|answer)/.test(c.name),
          ).length,
      ),
      0,
    );
    await page
      .getByRole("textbox", { name: "Answer the first mate", exact: true })
      .fill("A deliberate answer");
    await page
      .getByRole("button", { name: "Send answer to the first mate" })
      .click();
    await page
      .getByText(
        "Answer sent; waiting for the first mate to record the outcome.",
        { exact: true },
      )
      .waitFor();
    const sent = await page.evaluate(() =>
      window.fixtureCalls.filter(
        (c) => c.name === "firstmate.needs-you.answer",
      ),
    );
    assert.equal(sent.length, 1);
    assert.equal(sent[0].input.recordRevision, 1);
    assert.equal(sent[0].input.requestId, "a");
    assert.ok(sent[0].input.submissionId);
    await page.close();
    const actions = await pageAt("view=crew", 320);
    await actions
      .getByRole("button", { name: /^Needs you, 3 decisions/ })
      .focus();
    await actions.keyboard.press("Enter");
    await actions
      .getByRole("heading", { name: "Decision a", exact: true })
      .waitFor();
    await actions
      .getByRole("button", { name: "Mark seen", exact: true })
      .click();
    await actions.getByText("Seen", { exact: true }).waitFor();
    assert.equal(
      await actions.evaluate(() => window.attentionSnapshot.actionCount),
      3,
    );
    await actions
      .getByRole("button", { name: "Snooze 1 hour", exact: true })
      .click();
    await actions
      .getByRole("button", { name: "Unsnooze", exact: true })
      .waitFor();
    const snooze = await actions.evaluate(() =>
      window.fixtureCalls.find((c) => c.name === "firstmate.needs-you.snooze"),
    );
    assert.ok(Math.abs(snooze.input.until - Date.now() - 3600000) < 10000);
    assert.equal(snooze.input.id, "a");
    assert.equal(snooze.input.revision, 1);
    await actions
      .getByRole("button", { name: "Unsnooze", exact: true })
      .click();
    await actions.getByText("Seen", { exact: true }).waitFor();
    await actions.evaluate(() => {
      window.attentionUncertain = true;
    });
    await actions
      .getByRole("button", {
        name: "Answer: Use the cautious option",
        exact: true,
      })
      .click();
    await actions
      .getByText("Delivery uncertain; inspect the first mate's conversation.", {
        exact: false,
      })
      .waitFor();
    assert.equal(
      await actions
        .getByRole("button", {
          name: "Answer: Use the cautious option",
          exact: true,
        })
        .isDisabled(),
      true,
    );
    const choice = await actions.evaluate(() =>
      window.fixtureCalls.filter(
        (c) => c.name === "firstmate.needs-you.answer",
      ),
    );
    assert.equal(choice.length, 1);
    assert.equal(choice[0].input.suggestion.actionId, "cautious");
    assert.equal(choice[0].input.recordRevision, 1);
    await actions.reload();
    await actions
      .getByRole("button", { name: /^Needs you, 3 decisions/ })
      .waitFor();
    assert.equal(
      await actions.evaluate(
        () =>
          window.fixtureCalls.filter((c) =>
            /needs-you\.(seen|snooze|answer)/.test(c.name),
          ).length,
      ),
      0,
    );
    assert.equal(
      await actions.evaluate(() => (window.attentionToasts ?? []).length),
      0,
    );
    await actions.close();
    await checkResilience(pageAt, join(root, ".local/needs-you-resilient"));
    const taskViews = await checkTaskViews(pageAt, generated);
    await writeFile(join(generated, "view-results.json"), JSON.stringify(taskViews, null, 2));
    assert.deepEqual(errors, []);
    await writeFile(
      join(generated, "results.json"),
      JSON.stringify(evidence, null, 2),
    );
    console.log(
      JSON.stringify({
        layouts: evidence.length,
        surfaces: 4,
        taskViews: taskViews.length,
        failures: errors.length,
        checks:
          "counts, no implicit actions, exact selection, retained drafts, focus return, revisions, typed send, 44-point targets",
      }),
    );
  }
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
