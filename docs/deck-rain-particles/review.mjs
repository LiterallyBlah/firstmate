import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export async function review(browser, origin) {
  const out = resolve(root, ".local/rain-evidence"), results = [], errors = [];
  mkdirSync(out, { recursive: true });
  const smoke = process.env.RAIN_SMOKE === "1";
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(root, ".local/browsers");
  const ffmpeg = process.env.FFMPEG ?? (existsSync(cache) ? readdirSync(cache).filter((name) => name.startsWith("ffmpeg-")).map((name) => join(cache, name, "ffmpeg-win64.exe")).find(existsSync) : undefined);
  if (!smoke && !ffmpeg) throw new Error("Set FFMPEG to an installed ffmpeg executable");
  for (const setting of smoke ? ["ship"] : ["ship", "japanese-ship", "sky-airship", "ghost-ship"]) {
    for (const [aspect, width, height] of smoke ? [["wide", 1600, 900]] : [["wide", 1600, 900], ["tall", 720, 1440]]) {
      for (const [kind, working] of smoke ? [["downpour", 6]] : [["drizzle", 4], ["rain", 5], ["downpour", 6]]) {
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: "no-preference", timezoneId: "UTC" });
        try {
          const view = await context.newPage();
          view.on("pageerror", (error) => errors.push(error.message));
          const noon = Date.parse("2026-10-17T12:00:00Z");
          await view.clock.install({ time: noon });
          await view.goto(`${origin}/?tree=branch&theme=dark&working=${working}&setting=${setting}`);
          await view.getByRole("button", { name: "Open Deck", exact: true }).waitFor();
          await view.clock.pauseAt(noon + 20000);
          await view.clock.setFixedTime(new Date(noon + 20000));
          await view.getByRole("button", { name: "Open Deck", exact: true }).click();
          const canvas = view.locator("canvas[data-firstmate-deck]");
          for (let i = 0; i < 200 && !(await canvas.count()); i++) { await view.clock.runFor(100); await view.waitForTimeout(25); }
          assert.equal(await canvas.count(), 1);
          await view.clock.runFor(20000);
          assert.equal(await canvas.getAttribute("data-firstmate-deck-setting"), setting);
          assert.equal(await canvas.getAttribute("data-firstmate-deck-motion"), "full");
          const weather = Number(await canvas.getAttribute("data-firstmate-deck-weather"));
          assert.ok(Math.abs(weather - working / 6) < .02);
          await view.mouse.move(0, 0);
          const name = `${setting}-${aspect}-${kind}`;
          await canvas.screenshot({ path: resolve(out, `${name}.png`) });
          if (!smoke) {
            const frames = [];
            for (let frame = 0; frame < 40; frame++) {
              await view.clock.runFor(100);
              frames.push(await canvas.screenshot({ type: "jpeg", quality: 95 }));
            }
            execFileSync(ffmpeg, ["-y", "-f", "image2pipe", "-vcodec", "mjpeg", "-r", "10", "-i", "pipe:0", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libvpx-vp9", "-b:v", "1600k", resolve(out, `${name}.webm`)], { input: Buffer.concat(frames), stdio: "pipe" });
          }
          results.push({ setting, aspect, kind, working, weather, viewport: { width, height }, canvas: await canvas.boundingBox(), seedClock: "2026-10-17T12:00:20Z" });
          console.log(name);
        } finally { await context.close(); }
      }
    }
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(out, "renders.json"), JSON.stringify({ results, errors }, null, 2) + "\n");
}
