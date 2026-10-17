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
  const comparisons = process.env.RAIN_COMPARE === "1";
  const stillsOnly = smoke || comparisons || process.env.RAIN_STILLS === "1";
  const baseline = execFileSync("git", ["rev-parse", "origin/main"], { cwd: root, encoding: "utf8" }).trim();
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(root, ".local/browsers");
  const ffmpeg = process.env.FFMPEG ?? (existsSync(cache) ? readdirSync(cache).filter((name) => name.startsWith("ffmpeg-")).map((name) => join(cache, name, "ffmpeg-win64.exe")).find(existsSync) : undefined);
  if (!stillsOnly && !ffmpeg) throw new Error("Set FFMPEG to an installed ffmpeg executable");
  for (const setting of smoke ? [process.env.SETTING ?? "ship"] : ["ship", "japanese-ship", "sky-airship", "ghost-ship"]) {
    const original = comparisons ? JSON.parse(execFileSync("git", ["show", `${baseline}:art/settings/${setting}/setting.json`], { cwd: root, encoding: "utf8" })) : null;
    const oldRain = original?.ambience.filter((element) => element.id === "rain" || element.id === "rain-spray");
    const oldImages = original ? Object.fromEntries(Object.entries(original.images).filter(([id]) => JSON.stringify(oldRain).includes(`"${id}"`)).map(([id, image]) => [id,
      execFileSync("git", ["show", `${baseline}:art/settings/${setting}/${image.path}`], { cwd: root }).toString("base64")])) : null;
    for (const [aspect, width, height] of smoke ? [process.env.RAIN_ASPECT === "tall" ? ["tall", 720, 1440] : ["wide", 1600, 900]] : [["wide", 1600, 900], ["tall", 720, 1440]]) {
      for (const [kind, working] of smoke ? [process.env.RAIN_KIND === "rain" ? ["rain", 5] : ["downpour", 6]] : comparisons ? [["onset", 3], ["rain", 5], ["peak", 6]] : [["drizzle", 4], ["rain", 5], ["downpour", 6]]) {
       for (const version of comparisons ? ["tile", "precip"] : ["precip"]) {
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: "no-preference", timezoneId: "UTC" });
        try {
          const view = await context.newPage();
          view.on("pageerror", (error) => errors.push(error.message));
          await view.route("**/rpc/branch/firstmate.deck.engine", async (route) => {
            const engine = await (await route.fetch()).json();
            engine.source += "\n;const rainInit=PIXI.Application.prototype.init;PIXI.Application.prototype.init=async function(...args){await rainInit.apply(this,args);globalThis.rainReviewApp=this;};";
            await route.fulfill({ json: engine });
          });
          if (version === "tile") await view.route("**/rpc/branch/firstmate.deck.setting", async (route) => {
            const pack = await (await route.fetch()).json();
            pack.manifest.ambience = pack.manifest.ambience.flatMap((element) => element.behaviour.kind === "precip" ? oldRain : [element]);
            for (const id of Object.keys(oldImages)) { pack.manifest.images[id] = original.images[id]; pack.images[id] = oldImages[id]; }
            await route.fulfill({ json: pack });
          });
          const noon = Date.parse("2026-10-17T12:00:00Z");
          await view.clock.install({ time: noon });
          await view.goto(`${origin}/?tree=branch&theme=dark&working=${working}&setting=${setting}`);
          await view.getByRole("button", { name: "Open Deck", exact: true }).waitFor();
          // First attainable crew intensity above each scene's onset: 3 workers plus 1/2/3 waiting.
          const waiting = kind === "onset" ? setting === "ghost-ship" ? 1 : setting === "sky-airship" ? 3 : 2 : 0;
          if (waiting) await view.evaluate((count) => window.changeFleet((fleet) => {
            let changed = 0;
            fleet.cards = fleet.cards.map((card) => card.column === "idle" && card.agent !== null && card.agent.status !== "closed" && changed++ < count ? { ...card, column: "ready" } : card);
          }), waiting);
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
          assert.ok(Math.abs(weather - (working + waiting * .25) / 6) < .02);
          await view.mouse.move(0, 0);
          const name = `${comparisons ? "compare-" : ""}${setting}-${aspect}-${kind}${comparisons ? `-${version}` : ""}`;
          await canvas.screenshot({ path: resolve(out, `${name}.png`) });
          const drops = await view.evaluate(() => {
            const canvas = document.querySelector("canvas[data-firstmate-deck]").getBoundingClientRect();
            const found = [], visit = (node, parents = []) => {
              if (node.label?.includes(":drop:") && node.visible && node.alpha > 0) {
                const box = node.getBounds();
                if (box.maxX >= 0 && box.minX < canvas.width && box.maxY >= 0 && box.minY < canvas.height)
                  found.push({ depth: parents.at(-1), front: parents.includes("scenery:front"), x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2, alpha: node.alpha });
              }
              for (const child of node.children ?? []) visit(child, [...parents, node.label]);
            };
            visit(window.rainReviewApp.stage); return found;
          });
          if (version === "precip" && ["rain", "downpour", "peak"].includes(kind)) {
            assert.ok(drops.every(drop => drop.front), "all depths must draw in front of the ship and sea");
            const pane = await canvas.boundingBox();
            for (let band = 0; band < 3; band++) assert.ok(drops.filter(drop => drop.depth.endsWith(":2") && Math.floor(drop.y / pane.height * 3) === band).length >= 3,
              `${name}: near rain must cross every vertical third of the pane`);
          }
          if (!stillsOnly) {
            const frames = [];
            for (let frame = 0; frame < 40; frame++) {
              await view.clock.runFor(100);
              frames.push(await canvas.screenshot({ type: "jpeg", quality: 95 }));
            }
            execFileSync(ffmpeg, ["-y", "-f", "image2pipe", "-vcodec", "mjpeg", "-r", "10", "-i", "pipe:0", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libvpx-vp9", "-b:v", "1600k", resolve(out, `${name}.webm`)], { input: Buffer.concat(frames), stdio: "pipe" });
          }
          results.push({ setting, aspect, kind, version, working, waiting, weather, viewport: { width, height }, canvas: await canvas.boundingBox(), drops, seedClock: "2026-10-17T12:00:20Z" });
          console.log(name);
        } finally { await context.close(); }
       }
      }
    }
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(out, comparisons ? "comparisons.json" : "renders.json"), JSON.stringify({ baseline, results, errors }, null, 2) + "\n");
  if (comparisons) writeFileSync(resolve(out, "comparisons.html"), '<!doctype html><meta charset="utf-8"><style>body{background:#172129;color:white;font:16px sans-serif}section{display:grid;grid-template-columns:1fr 1fr;gap:12px}img{width:100%}h2{grid-column:span 2}</style><h1>Matched rain: old tiles / particles</h1>' + results.filter(row => row.version === "tile").map(row => {
    const prefix = `compare-${row.setting}-${row.aspect}-${row.kind}`;
    return `<section><h2>${row.setting}, ${row.aspect}, ${row.kind}, intensity ${row.weather}</h2><figure><figcaption>Old tiles</figcaption><img src="${prefix}-tile.png"></figure><figure><figcaption>Particles</figcaption><img src="${prefix}-precip.png"></figure></section>`;
  }).join(""));
}
