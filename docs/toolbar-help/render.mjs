/** Hover/focus, disabled safety and screenshots, using the existing fixture dependencies. */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
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
for (const mode of ["before", "after"]) await build({
  entryPoints: [resolve(here, "panel.jsx")],
  outfile: resolve(generated, `${mode}.js`),
  bundle: true,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "synthetic-host",
      setup(builder) {
        if (mode === "after" && process.env.FM_HELP_TRACE) builder.onLoad({ filter: /client[\\/]ui\.tsx$/ }, (args) => {
          let contents = readFileSync(args.path, "utf8");
          if (process.env.FM_HELP_TRACE_OLD) contents = contents.replace('setDismissed(fromHiddenTooltip(event.nativeEvent));', 'setDismissed(false);');
          contents = contents.replace('  const trigger = useRef<View>(null);', `
  const trace = (kind, event) => globalThis.fixtureTrace?.({ kind, id: tooltipId, text, open, hovered, focused, dismissed,
    target: event?.nativeEvent?.target?.outerHTML?.slice(0, 180), related: event?.nativeEvent?.relatedTarget?.outerHTML?.slice(0, 180) });
  useEffect(() => { trace("mount"); return () => trace("unmount"); }, []);
  useEffect(() => { trace("commit"); }, [open, hovered, focused, dismissed]);
  const trigger = useRef<View>(null);`);
          contents = contents.replace('    return bindWebKeys(undefined, (key) => {', '    trace("listen");\n    const unbind = bindWebKeys(undefined, (key) => {');
          contents = contents.replace('      setDismissed(true);', '      trace("escape");\n      setDismissed(true);');
          contents = contents.replace('    }, true);\n  }, [open]);', '    }, true);\n    return () => { trace("unlisten"); unbind(); };\n  }, [open]);');
          contents = contents.replace('onPointerEnter={(event) => {\n        setHovered', 'onPointerEnter={(event) => {\n        trace("enter", event);\n        setHovered');
          contents = contents.replace('onPointerLeave={() => setHovered(false)}', 'onPointerLeave={(event) => { trace("leave", event); setHovered(false); }}');
          contents = contents.replace('onFocus={() => {\n        setFocused', 'onFocus={(event) => {\n        trace("focus", event);\n        setFocused');
          contents = contents.replace('onBlur={() => setFocused(false)}', 'onBlur={(event) => { trace("blur", event); setFocused(false); }}');
          return { contents, loader: "tsx", resolveDir: dirname(args.path) };
        });
        if (mode === "before") builder.onLoad({ filter: /\.(ts|tsx)$/ }, (args) => {
          const path = relative(root, args.path).split(sep).join("/");
          if (!/^(client|shared)\//.test(path)) return;
          return { contents: execFileSync("git", ["show", `2c349548388703a32b8cb095a5f2ec2a2d04771d:${path}`], { cwd: root, encoding: "utf8" }), loader: path.endsWith("tsx") ? "tsx" : "ts", resolveDir: dirname(args.path) };
        });
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
  if (req.url === "/before.js" || req.url === "/after.js") {
    res.setHeader("Content-Type", "application/javascript");
    res.end(await readFile(resolve(generated, req.url.slice(1))));
  } else {
    res.setHeader("Content-Type", "text/html");
    const mode = req.url?.startsWith("/before") ? "before" : "after";
    res.end(
      `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:Segoe UI,sans-serif}*{box-sizing:border-box}</style></head><body><div id="root"></div><script src="/${mode}.js"></script></body></html>`,
    );
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [],
  results = [];
const button = (page, name) => page.getByRole("button", { name, exact: true });
async function open(width, theme, extra = "", mode = "after") {
  const page = await browser.newPage({ viewport: { width, height: 960 } });
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) => errors.push(error.message));
  if (process.env.FM_HELP_TRACE) await page.addInitScript(() => {
    window.fixtureEvents = [];
    window.fixtureTrace = (entry) => window.fixtureEvents.push({ at: performance.now(), ...entry });
  });
  await page.goto(
    `${url}/${mode}?theme=${theme}&label=Hover%20and%20keyboard%20focus${extra}`,
  );
  if (process.env.FM_HELP_TRACE) await page.evaluate(() => {
    for (const kind of ["keydown", "pointerenter", "pointerleave", "pointermove", "focusin", "focusout"]) document.addEventListener(kind, (event) => {
      if (kind === "keydown" && event.key !== "Escape") return;
      window.fixtureEvents.push({ at: performance.now(), kind: `DOM:${kind}`, key: event.key, x: event.clientX, y: event.clientY, target: event.target.outerHTML.slice(0, 160) });
    }, true);
    document.addEventListener("scroll", (event) => window.fixtureEvents.push({ at: performance.now(), kind: "DOM:scroll", top: event.target.scrollTop, left: event.target.scrollLeft, target: event.target.outerHTML.slice(0, 160) }), true);
    new MutationObserver((entries) => {
      for (const entry of entries) {
        if (entry.type === "attributes" && entry.target.getAttribute("role") === "tooltip") window.fixtureEvents.push({ at: performance.now(), kind: "DOM:tooltip-style", id: entry.target.id, text: entry.target.textContent, style: entry.target.getAttribute("style") });
      }
    }).observe(document.getElementById("root"), { subtree: true, childList: true, attributes: true, attributeFilter: ["style"] });
  });
  await page.getByRole("button", { name: /^(Switch provider\/model|Recover migration)$/ }).waitFor();
  await button(page, "Refresh").waitFor();
  return page;
}
async function visibleTip(page, trigger, expected) {
  const tip = page.getByRole("tooltip");
  await tip.waitFor();
  assert.equal(await tip.count(), 1);
  assert.match(await tip.innerText(), expected);
  await page.waitForTimeout(40);
  assert.equal(
    await trigger.getAttribute("aria-describedby"),
    await tip.getAttribute("id"),
  );
  assert.equal(await trigger.getAttribute("title"), null);
  const box = await tip.boundingBox();
  assert(
    box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= page.viewportSize().width + 1 &&
      box.y + box.height <= 961,
    `tip outside viewport: ${JSON.stringify(box)}`,
  );
  // Detect overflow clipping/stacking too, not just an in-bounds bounding box.
  const painted = await tip.evaluate((el) => {
      const b = el.getBoundingClientRect();
      return [
        [b.left + 3, b.top + 3],
        [b.right - 3, b.bottom - 3],
      ].every(([x, y]) => el.contains(document.elementFromPoint(x, y)));
    });
  if (!painted) {
    await page.screenshot({ path: resolve(generated, "clipped-tip.png") });
    await writeFile(resolve(generated, "clipped-tip.json"), JSON.stringify(await tip.evaluate(el => {
      const b = el.getBoundingClientRect();
      return { text: el.textContent, bounds: b.toJSON(), hits: [[b.left + 3, b.top + 3], [b.right - 3, b.bottom - 3]].map(([x, y]) => ({ x, y, target: document.elementFromPoint(x, y)?.outerHTML.slice(0, 500) })), parents: [...function* () { for (let p = el.parentElement; p; p = p.parentElement) yield p; }()].map(p => ({ bounds: p.getBoundingClientRect().toJSON(), scrollTop: p.scrollTop, overflow: getComputedStyle(p).overflow, zIndex: getComputedStyle(p).zIndex })) };
    }), null, 2));
  }
  assert(
    painted,
    `tip clipped or covered: ${await tip.innerText()}`,
  );
  return tip;
}
async function checkHelp(page, trigger, expected, capture) {
  await page.mouse.move(2, 2);
  await page.locator("textarea").first().focus();
  const disabled = (await trigger.getAttribute("aria-disabled")) === "true";
  const focusTarget = disabled ? trigger.locator("..") : trigger;
  const mutations = () => page.evaluate(() => window.fixtureCalls.filter((c) => /(?:crew\.(?:steer|interrupt|exit|relaunch)|mate\.(?:ask|command|compact|restart|migrate)|watch\.(?:toggle|create|configure))$/.test(c.name)).length);
  const before = await mutations();
  await focusTarget.focus();
  const focusedTip = await visibleTip(page, focusTarget, expected);
  if (capture) await page.screenshot({ path: resolve(here, capture) });
  await page.keyboard.press("Escape");
  await focusedTip.waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("tooltip").count(), 0);
  if (disabled) {
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    assert.equal(
      await mutations(),
      before,
      "disabled help invoked an RPC",
    );
    assert.equal(await trigger.getAttribute("aria-disabled"), "true");
    // Space on a focusable, non-interactive help wrapper can scroll the browser.
    // Finish that real scroll before testing pointer movement into its popup.
    await focusTarget.evaluate(async (el) => {
      const parents = [...function* () { for (let p = el; p; p = p.parentElement) yield p; }()];
      let last = "", stable = 0;
      const start = performance.now();
      while (stable < 8) {
        if (performance.now() - start > 5000) throw new Error("disabled-key scroll did not settle");
        await new Promise(requestAnimationFrame);
        const current = parents.map(p => `${p.scrollTop},${p.scrollLeft}`).join(";");
        stable = current === last ? stable + 1 : 0;
        last = current;
      }
    });
  }
  await page.locator("textarea").first().focus();
  await trigger.hover({ force: disabled });
  const tip = await visibleTip(page, trigger, expected);
  if (process.env.FM_HELP_TRACE) await tip.evaluate(el => window.fixtureEvents.push({ at: performance.now(), kind: "MARK:before-popup-hover", bounds: el.getBoundingClientRect().toJSON(), parents: [...function* () { for (let p = el.parentElement; p; p = p.parentElement) yield p; }()].map(p => ({ top: p.scrollTop, left: p.scrollLeft, bounds: p.getBoundingClientRect().toJSON(), overflow: getComputedStyle(p).overflow })) }));
  await tip.hover();
  assert(await tip.isVisible(), "moving into help dismissed it");
  await page.keyboard.press("Escape");
  await tip.waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("tooltip").count(), 0);
  await page.mouse.move(2, 2);
  await trigger.hover({ force: disabled });
  await visibleTip(page, trigger, expected);
  await page.mouse.move(2, 2);
  await page.getByRole("tooltip").waitFor({ state: "hidden" });
}
async function expand(page, name) {
  const heading = page.getByRole("button", { name: new RegExp(`^${name}`) });
  if (await heading.getAttribute("aria-expanded") !== "true") await heading.click();
  return heading.locator("..");
}
async function geometry(page) {
  const controls = [
    button(page, "Switch provider/model"), page.getByRole("tab", { name: "List", exact: true }),
    page.getByRole("tab", { name: "Board", exact: true }), button(page, "Watches"),
    page.getByRole("tab", { name: "Crew (5)", exact: true }), page.getByRole("tab", { name: "Files", exact: true }),
    button(page, "Hide the chat"), button(page, "Hide the board"), button(page, "Open the first mate in Paseo"),
    button(page, "Refresh"), button(page, "FirstMate settings"),
  ];
  const card = await expand(page, "Local running worker");
  controls.push(...["Watch", "Steer", "Interrupt", "Relaunch", "End"].map((name) => card.getByRole("button", { name, exact: true })));
  const boxes = await Promise.all(controls.map((control) => control.boundingBox()));
  await page.getByRole("button", { name: /^Local running worker/ }).click();
  return boxes;
}
async function escapeOverlapRegression(page, card) {
  const end = card.getByRole("button", { name: "End", exact: true });
  const interrupt = card.getByRole("button", { name: "Interrupt", exact: true });
  await page.mouse.move(2, 2);
  await page.locator("textarea").first().focus();
  await end.hover();
  const tip = await visibleTip(page, end, /Confirm archiving/);
  await tip.hover();
  await page.keyboard.press("Escape");
  await tip.waitFor({ state: "hidden" });
  // Keep the pointer stationary while the browser re-tests the revealed controls.
  await page.waitForTimeout(150);
  assert.equal(await page.getByRole("tooltip").count(), 0, "Escape exposed another tooltip without pointer movement");
  // Fresh keyboard focus is intentional, even if Interrupt's hover was suppressed.
  await interrupt.focus();
  await visibleTip(page, interrupt, /Stop this worker's current turn/);
  await page.keyboard.press("Escape");
  await page.getByRole("tooltip").waitFor({ state: "hidden" });
  await page.locator("textarea").first().focus();
  await page.mouse.move(2, 2);
  await interrupt.hover();
  await visibleTip(page, interrupt, /Stop this worker's current turn/);
  await page.keyboard.press("Escape");
  await page.getByRole("tooltip").waitFor({ state: "hidden" });
  await page.mouse.move(2, 2);
}
try {
  if (process.env.FM_HELP_TRACE) {
    if (process.env.FM_HELP_TRACE_BUSY) {
      const page = await open(800, "light");
      const card = await expand(page, "Local running worker");
      await page.evaluate(() => { window.fixtureHoldAction = true; });
      await card.getByRole("button", { name: "Interrupt", exact: true }).click();
      try {
        await checkHelp(page, card.getByRole("button", { name: "Steer", exact: true }), /current action to finish/);
      } finally {
        await writeFile(resolve(generated, "busy-trace.json"), JSON.stringify(await page.evaluate(() => ({ events: window.fixtureEvents, active: document.activeElement.outerHTML, visible: [...document.querySelectorAll('[role="tooltip"]')].filter(el => getComputedStyle(el).display !== 'none').map(el => ({ id: el.id, text: el.textContent })) })), null, 2));
      }
    } else if (process.env.FM_HELP_TRACE_CLIPPED) {
      const page = await open(800, "dark");
      for (const title of ["Local running worker", "Local idle worker", "Remote running worker", "Unreachable remote worker", "Followed remote session"]) await expand(page, title);
      await page.getByRole("tab", { name: "Board", exact: true }).click();
      const idle = await expand(page, "Local idle worker");
      await checkHelp(page, idle.getByRole("button", { name: "Interrupt", exact: true }), /no running turn/);
      const offline = await expand(page, "Unreachable remote worker");
      await checkHelp(page, offline.getByRole("button", { name: "End", exact: true }), /unreachable/);
    } else if (process.env.FM_HELP_TRACE_NARROW) {
      const page = await open(638, "dark");
      await expand(page, "Local running worker");
      await expand(page, "Local idle worker");
      const card = await expand(page, "Remote running worker");
      try {
        await checkHelp(page, card.getByRole("button", { name: "Relaunch", exact: true }), /unavailable here/);
      } finally {
        await page.screenshot({ path: resolve(generated, "narrow-remote-trace.png") });
        await writeFile(resolve(generated, "narrow-remote-trace.json"), JSON.stringify(await page.evaluate(() => ({ events: window.fixtureEvents, tips: [...document.querySelectorAll('[role="tooltip"]')].map(el => ({ id: el.id, text: el.textContent, bounds: el.getBoundingClientRect().toJSON(), style: el.getAttribute("style") })) })), null, 2));
      }
    } else {
    for (const view of ["List", "Board"]) for (const freezePolling of [false, true]) {
      const page = await open(1280, "dark");
      if (freezePolling) await page.evaluate(() => { window.fixtureFreezePolling = true; });
      if (view === "Board") await page.getByRole("tab", { name: "Board", exact: true }).click();
      const card = await expand(page, "Local running worker");
      const end = card.getByRole("button", { name: "End", exact: true });
      await page.mouse.move(2, 2);
      await page.locator("textarea").first().focus();
      await end.focus();
      await visibleTip(page, end, /Confirm archiving/);
      await page.keyboard.press("Escape");
      await page.locator("textarea").first().focus();
      await end.hover();
      const tip = await visibleTip(page, end, /Confirm archiving/);
      const beforeId = await tip.getAttribute("id");
      await tip.hover();
      await page.evaluate(() => window.fixtureEvents.push({ kind: "MARK:before-Escape", at: performance.now() }));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
      const receipt = await page.evaluate(() => ({ events: window.fixtureEvents, visible: [...document.querySelectorAll('[role="tooltip"]')].filter((el) => getComputedStyle(el).display !== "none").map((el) => ({ id: el.id, text: el.textContent })), calls: window.fixtureCalls }));
      Object.assign(receipt, { view, freezePolling, beforeId });
      const variant = process.env.FM_HELP_TRACE_OLD ? "before" : "fixed";
      await writeFile(resolve(generated, `${variant}-trace-${view.toLowerCase()}-${freezePolling ? "frozen" : "polling"}.json`), JSON.stringify(receipt, null, 2));
      const marker = receipt.events.findLast((e) => e.kind === "MARK:before-Escape").at;
      const afterEscape = receipt.events.filter((e) => e.at >= marker);
      console.log(JSON.stringify({ variant, view, freezePolling, beforeId, visible: receipt.visible, events: afterEscape.filter((e) => ["escape", "enter", "commit", "listen", "unlisten", "mount", "unmount", "DOM:pointermove"].includes(e.kind)) }, null, 2));
      assert.deepEqual(receipt.visible.map((t) => t.text), process.env.FM_HELP_TRACE_OLD && view === "Board" ? ["Stop this worker's current turn."] : []);
      assert(!afterEscape.some((e) => e.kind === "mount" || e.kind === "unmount" || e.kind === "DOM:pointermove"));
      await page.screenshot({ path: resolve(generated, `${variant}-trace-${view.toLowerCase()}-${freezePolling ? "frozen" : "polling"}.png`) });
      await page.close();
    }
    }
  } else {
  for (const width of process.env.FM_HELP_STATES_ONLY ? [] : [1280, 800, 638])
    for (const theme of ["dark", "light"]) {
      const baseline = await open(width, theme, "", "before");
      const before = await geometry(baseline);
      await baseline.close();
      const page = await open(width, theme);
      const after = await geometry(page);
      for (let i = 0; i < before.length; i++) for (const key of ["x", "y", "width", "height"]) {
        assert(Math.abs(before[i][key] - after[i][key]) <= 1, `control ${i} changed ${key} at ${width}: ${JSON.stringify({ before: before[i], after: after[i] })}`);
      }
      const header = [
        [button(page, "Switch provider/model"), /Choose a provider or model/],
        [page.getByRole("tab", { name: "List", exact: true }), /grouped list/],
        [
          page.getByRole("tab", { name: "Board", exact: true }),
          /columns by status/,
        ],
        [button(page, "Watches"), /scheduled watches/],
        [
          page.getByRole("tab", { name: "Crew (5)", exact: true }),
          /crew and backlog tasks/,
        ],
        [
          page.getByRole("tab", { name: "Files", exact: true }),
          /Browse and edit files/,
        ],
        [button(page, "Hide the chat"), /Hide the first-mate chat/],
        [button(page, "Hide the board"), /Hide the Crew pane/],
        [
          button(page, "Open the first mate in Paseo"),
          /full conversation in Paseo/,
        ],
        [button(page, "Refresh"), /Refresh the task board/],
        [button(page, "FirstMate settings"), /home, models and display/],
      ];
      for (const [trigger, expected] of header)
        await checkHelp(
          page,
          trigger,
          expected,
          width === 800 && trigger === header[0][0]
            ? `header-transfer-${theme}.png`
            : width === 800 && trigger === header[3][0]
              ? `header-watches-${theme}.png`
            : undefined,
        );
      const local = await expand(page, "Local running worker");
      for (const [name, expected] of [
        ["Watch", /live activity within FirstMate/],
        ["Steer", /instructions directly/],
        ["Interrupt", /current turn/],
        ["Relaunch", /same local copy/],
        ["End", /Confirm archiving/],
      ])
        await checkHelp(
          page,
          local.getByRole("button", { name, exact: true }),
          expected,
          width === 800 && name === "Steer"
            ? `crew-steer-${theme}.png`
            : undefined,
        );
      const idle = await expand(page, "Local idle worker");
      await checkHelp(
        page,
        idle.getByRole("button", { name: "Interrupt", exact: true }),
        /no running turn/,
      );
      const remote = await expand(page, "Remote running worker");
      await checkHelp(
        page,
        remote.getByRole("button", { name: "Watch", exact: true }),
        /recent log/,
      );
      await checkHelp(
        page,
        remote.getByRole("button", { name: "Relaunch", exact: true }),
        /unavailable here.*first mate/s,
        width === 800 ? `remote-relaunch-disabled-${theme}.png` : undefined,
      );
      const offline = await expand(page, "Unreachable remote worker");
      for (const name of ["Steer", "Interrupt", "End"])
        await checkHelp(
          page,
          offline.getByRole("button", { name, exact: true }),
          /unreachable/,
        );
      const followed = await expand(page, "Followed remote session");
      await checkHelp(
        page,
        followed.getByRole("button", { name: "End", exact: true }),
        /followed session/,
      );
      // The old PR10 controls still use the same treatment.
      for (const name of ["Bearings", "Ahoy", "Compact", "Restart"])
        await checkHelp(page, button(page, name), /./);
      // Tab navigation reaches disabled help, without requiring a pointer.
      const disabled = remote.getByRole("button", {
        name: "Relaunch",
        exact: true,
      });
      await remote
        .getByRole("button", { name: "Interrupt", exact: true })
        .focus();
      await page.keyboard.press("Tab");
      assert(
        await disabled
          .locator("..")
          .evaluate((el) => el === document.activeElement),
      );
      await visibleTip(page, disabled.locator(".."), /unavailable here/);
      await page.keyboard.press("Escape");
      // Board reuses the same real card actions, including wrapped action rows.
      await page.getByRole("tab", { name: "Board", exact: true }).click();
      const boardCard = await expand(page, "Local running worker");
      for (const [name, expected] of [
        ["Watch", /live activity within FirstMate/],
        ["Steer", /instructions directly/],
        ["Interrupt", /current turn/],
        ["Relaunch", /same local copy/],
        ["End", /Confirm archiving/],
      ]) await checkHelp(page, boardCard.getByRole("button", { name, exact: true }), expected,
        width === 800 && name === "End" ? `board-end-${theme}.png` : undefined);
      await escapeOverlapRegression(page, boardCard);
      const boardRemote = await expand(page, "Remote running worker");
      await checkHelp(page, boardRemote.getByRole("button", { name: "Relaunch", exact: true }), /unavailable here.*first mate/s);
      const boardIdle = await expand(page, "Local idle worker");
      await checkHelp(page, boardIdle.getByRole("button", { name: "Interrupt", exact: true }), /no running turn/);
      const boardOffline = await expand(page, "Unreachable remote worker");
      await checkHelp(page, boardOffline.getByRole("button", { name: "End", exact: true }), /unreachable/);
      const boardFollowed = await expand(page, "Followed remote session");
      await checkHelp(page, boardFollowed.getByRole("button", { name: "End", exact: true }), /followed session/);
      results.push({
        width,
        theme,
        header: header.length,
        localActions: 5,
        disabledStates: ["idle", "remote-relaunch", "unreachable", "followed"],
        geometryUnchanged: true,
        boardActions: 5,
        boardDisabledStates: ["idle", "remote-relaunch", "unreachable", "followed"],
        escapeOverlap: true,
      });
      await page.close();
      console.log(`Passed ${width}px ${theme}`);
    }
  // State changes and action routing remain fixture-local, including destructive RPCs.
  const page = await open(800, "light");
  await page.getByRole("tab", { name: "Files", exact: true }).click();
  await checkHelp(page, button(page, "Hide the board"), /Hide the Files pane/);
  await button(page, "Hide the board").click();
  const showBoard = button(page, "Show the board").and(page.locator("[aria-describedby]"));
  await checkHelp(page, showBoard, /Show Files beside/);
  await showBoard.click();
  await page.getByRole("tab", { name: "Crew (5)", exact: true }).click();
  const local = await expand(page, "Local running worker");
  await local.getByRole("button", { name: "Watch", exact: true }).click();
  await checkHelp(page, page.getByRole("tab", { name: "Crew (5)", exact: true }), /Return to crew tasks/);
  await page.getByRole("tab", { name: "Crew (5)", exact: true }).click();
  // This row stayed expanded across Watch; End still asks first, and Cancel sends nothing.
  const localAgain = page.getByRole("button", { name: /^Local running worker/ }).locator("..");
  await localAgain.getByRole("button", { name: "End", exact: true }).click();
  await button(page, "End it").waitFor();
  assert(!await page.evaluate(() => window.fixtureCalls.some((c) => c.name === "firstmate.crew.exit")));
  await localAgain.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(() => { window.fixtureHoldAction = true; });
  await localAgain.getByRole("button", { name: "Interrupt", exact: true }).click();
  await checkHelp(page, localAgain.getByRole("button", { name: "Steer", exact: true }), /current action to finish/);
  await page.evaluate(() => { window.fixtureHoldAction = false; window.fixtureReleaseAction(); });
  await page.waitForFunction(() => window.fixtureCalls.some((c) => c.name === "firstmate.crew.interrupt"));
  await page.waitForTimeout(80);
  assert.equal(await localAgain.getByRole("button", { name: "Steer", exact: true }).locator("..").getAttribute("tabindex"), null);
  await button(page, "Switch provider/model").click();
  await page.getByRole("dialog", { name: "Transfer the first-mate role" }).waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).first().click();
  await button(page, "Watches").click();
  await page.getByRole("dialog", { name: "Watches", exact: true }).waitFor();
  await page.getByRole("dialog", { name: "Watches", exact: true }).getByRole("button", { name: "Close", exact: true }).click();
  await button(page, "Open the first mate in Paseo").click();
  assert.equal(await page.evaluate(() => window.fixtureOpenedAgent.agentId), "first-mate");
  await button(page, "FirstMate settings").click();
  assert.equal(await page.evaluate(() => window.fixtureSettingsOpened), "firstmate");
  await page.evaluate(() => { window.fixtureHoldRefresh = true; });
  await button(page, "Refresh").click();
  await checkHelp(page, button(page, "Refreshing"), /status is refreshing/);
  await page.evaluate(() => { window.fixtureHoldRefresh = false; window.fixtureReleaseRefresh(); });
  await button(page, "Refresh").waitFor();
  assert.equal(await button(page, "Refresh").locator("..").getAttribute("tabindex"), null);
  await button(page, "Hide the chat").click();
  const showChat = button(page, "Show the chat").and(page.locator("[aria-describedby]"));
  await showChat.focus();
  await visibleTip(page, showChat, /Show the first-mate chat/);
  await page.keyboard.press("Escape");
  await showChat.click();
  await page.close();
  const recovery = await open(800, "dark", "&recovery=true");
  await checkHelp(recovery, button(recovery, "Recover migration"), /saved first-mate transfer/);
  await recovery.close();
  results.push({ stateChanges: ["Files pane", "show chat", "Watch return", "busy action", "refreshing", "migration recovery"], mockedRouting: ["Interrupt", "End confirmation/cancel", "transfer dialog", "Watches dialog", "Open", "settings"] });
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(generated, process.env.FM_HELP_STATES_ONLY ? "states-results.json" : "results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results, null, 2));
  }
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
