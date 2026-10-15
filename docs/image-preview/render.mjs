/**
 * Replays an image sent to the first mate through the real chat, in headless Edge or Chromium,
 * against main (`before`) and this branch (`after`). Never connects to a daemon: the stub timeline
 * records a sent message as Paseo 0.11's daemon does, words only, under the send's `messageId`.
 */
import { build } from "../board-list/node_modules/esbuild/lib/main.js";
import { chromium } from "../board-list/node_modules/playwright/index.mjs";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const rootRequire = createRequire(resolve(root, "package.json"));
const webRequire = createRequire(resolve(here, "../board-list/package.json"));
const generated = resolve(here, ".generated");
const baseline = process.env.IMAGE_PREVIEW_BASELINE ?? "origin/main";
await mkdir(generated, { recursive: true });
const representative = new Set(["before-wide-dark", "after-wide-dark", "after-phone-light", "after-wide-dark-images-only"]);
const shot = (name) => resolve(representative.has(name) ? here : generated, `${name}.png`);

// The before bundle swaps every client and shared file this branch changed for main's copy.
const changed = new Set(
  execFileSync("git", ["diff", "--name-only", baseline, "--", "client", "shared"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .map((path) => path.trim())
    .filter((path) => path !== ""),
);
for (const mode of ["before", "after"]) {
  await build({
    entryPoints: [resolve(here, "panel.jsx")],
    outfile: resolve(generated, `${mode}.js`),
    bundle: true,
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [
      {
        name: "host-and-baseline",
        setup(builder) {
          builder.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: resolve(here, "../board-list/contracts.js") }));
          builder.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: resolve(here, "stubs.jsx") }));
          builder.onResolve({ filter: /^react($|\/)/ }, (args) => ({ path: rootRequire.resolve(args.path) }));
          builder.onResolve({ filter: /^@tanstack\/react-query$/ }, (args) => ({ path: rootRequire.resolve(args.path) }));
          builder.onResolve({ filter: /^react-dom($|\/)/ }, (args) => ({ path: webRequire.resolve(args.path) }));
          builder.onResolve({ filter: /^react-native($|-web$)/ }, () => ({ path: webRequire.resolve("react-native-web") }));
          if (mode === "before")
            builder.onLoad({ filter: /[\\/](client|shared)[\\/][^\\/]+\.tsx?$/ }, (args) => {
              const path = relative(root, args.path).replace(/\\/g, "/");
              if (!changed.has(path)) return undefined;
              return {
                contents: execFileSync("git", ["show", `${baseline}:${path}`], { cwd: root, encoding: "utf8" }),
                loader: path.endsWith(".tsx") ? "tsx" : "ts",
                resolveDir: dirname(args.path),
              };
            });
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

/** Every data: image on the page — React Native Web keeps an <img> inside each Image — and its box. */
function images(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('img[src^="data:image/"]')].map((img) => {
      const box = img.parentElement.getBoundingClientRect();
      return {
        loaded: img.complete && img.naturalWidth > 0,
        width: img.naturalWidth,
        top: box.top,
        bottom: box.bottom,
        boxWidth: box.width,
        label: img.parentElement.getAttribute("aria-label"),
      };
    }),
  );
}

function loadedCount(page, count) {
  return page.waitForFunction(
    (n) => [...document.querySelectorAll('img[src^="data:image/"]')].filter((img) => img.naturalWidth > 0).length === n,
    count,
  );
}

async function attach(page, name, png) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach files or images" }).click();
  await (await chooser).setFiles({ name, mimeType: "image/png", buffer: png });
  await page.getByText(name).waitFor();
}

let browser;
const errors = [];
const results = [];
try {
  browser = await chromium.launch({ ...(process.platform === "win32" ? { channel: "msedge" } : {}), headless: true });
  // A screenshot-like PNG to send, drawn on a canvas: a hull, a sail and its stern wake.
  const painter = await browser.newPage();
  const png = Buffer.from(
    await painter.evaluate(() => {
      const canvas = Object.assign(document.createElement("canvas"), { width: 320, height: 200 });
      const g = canvas.getContext("2d");
      g.fillStyle = "#2f6fb0";
      g.fillRect(0, 0, 320, 200);
      g.fillStyle = "#e9f3ff";
      g.beginPath();
      g.moveTo(140, 128);
      g.lineTo(310, 70);
      g.lineTo(310, 110);
      g.closePath();
      g.fill();
      g.fillStyle = "#6b3f1d";
      g.fillRect(20, 100, 120, 40);
      g.fillStyle = "#ffffff";
      g.fillRect(70, 30, 6, 70);
      g.fillRect(78, 34, 44, 50);
      g.fillStyle = "#ffd75e";
      g.font = "bold 22px sans-serif";
      g.fillText("stern wake", 170, 170);
      return canvas.toDataURL("image/png").split(",")[1];
    }),
    "base64",
  );
  await painter.close();
  const words = "I believe the angle of this trail needs to be higher";
  for (const [size, width, height] of [
    ["wide", 980, 720],
    ["phone", 390, 844],
  ]) {
    for (const mode of ["before", "after"]) {
      for (const theme of ["dark", "light"]) {
        const name = `${mode}-${size}-${theme}`;
        const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
        page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
        await page.goto(`${url}/${mode}?${theme}`);
        await page.getByText("Ahoy, captain. What needs doing?").waitFor();

        // The trigger: an image attached through the chat's own picker, as the captain does.
        await attach(page, "trail.png", png);
        await loadedCount(page, 1);
        // The path that does preview, before and after: the composer's chip.
        const composer = await images(page);
        assert.equal(composer.length, 1, `${name}: composer thumbnail`);
        await page.screenshot({ path: shot(`${name}-attached`) });

        await page.getByPlaceholder(/Tell the first mate/).fill(words);
        await page.getByRole("button", { name: "Send", exact: true }).click();
        await page.getByText("Looking at it now.").waitFor();
        await page.getByText("trail.png").waitFor({ state: "detached" });
        // An image decodes asynchronously; give a drawn one the chance to load before counting.
        await page.waitForTimeout(500);
        const sends = await page.evaluate(() => window.imageSends);
        assert.equal(sends.length, 1);
        assert.deepEqual(sends[0].images.map((image) => image.mimeType), ["image/png"], `${name}: the image went to the first mate`);
        const sentBubble = await page.getByText(words, { exact: true }).boundingBox();
        const shown = await images(page);
        results.push({ name, sends, composer, shown, sentBubble });
        await page.screenshot({ path: shot(name) });
        if (mode === "before") {
          // The symptom: the message went with its image, and the transcript shows its words alone.
          assert.equal(sends[0].messageId, null, `${name}: main sends no id to find the images by`);
          assert.equal(shown.length, 0, `${name}: main draws no image in the sent message`);
        } else {
          assert.match(sends[0].messageId, /^firstmate-captain-/);
          assert.equal(shown.length, 1, `${name}: the sent message shows its image`);
          assert.ok(shown[0].loaded, `${name}: the sent image loads`);
          assert.equal(shown[0].width, 320);
          assert.equal(shown[0].label, "Image you sent");
          assert.ok(shown[0].top >= sentBubble.y + sentBubble.height - 1, `${name}: the image sits under the words`);
          assert.ok(shown[0].boxWidth <= width, `${name}: the image fits the pane`);
          // A remount — opening a workspace and coming back — keeps it.
          await page.evaluate(() => window.imageRemount());
          await page.getByText(words, { exact: true }).waitFor();
          await loadedCount(page, 1);
          // An image sent with no words shows the image, not "(attachments)".
          await attach(page, "wake.png", png);
          await loadedCount(page, 2);
          await page.getByRole("button", { name: "Send", exact: true }).click();
          await page.getByText("wake.png").waitFor({ state: "detached" });
          await loadedCount(page, 2);
          assert.equal(await page.getByText("(attachments)", { exact: true }).count(), 0, `${name}: no placeholder over an image`);
          await page.screenshot({ path: shot(`${name}-images-only`) });
        }
        await page.close();
      }
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(generated, "results.json"), JSON.stringify(results, null, 2));
  console.log(`${results.length} replays passed: main sends the image but draws none in the chat; this branch draws it.`);
} finally {
  await browser?.close();
  server.close();
}
