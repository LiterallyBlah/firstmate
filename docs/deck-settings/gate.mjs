/**
 * The deck-settings migration's gate: the ship, drawn by this checkout, must be pixel-identical to the ship
 * drawn by origin/main — still and moving — at every step of the move to a scene engine and a setting pack.
 *
 * Run `node docs/ship-deck-canvas/compile.mjs` first: it compiles both checkouts with Paseo's own plugin
 * compiler (and checks Hermes and `class`), writing `.generated/{main,branch}.client.js`. This script then
 * takes origin/main as files (as compile.mjs does), answers each checkout's deck RPCs from that checkout's own
 * server code and art (`DECK_RPCS` below knows every contract either side has), and renders each bundle in
 * headless Edge through one host (`host.jsx`) that imports neither's deck code. Every scenario is rendered for
 * both, screenshot by screenshot at the same moments, and the screenshots are compared pixel for pixel:
 *
 * - **still** (reduced motion): noon in both themes, night, dawn, dusk into night, a busy crew (still calm), all
 *   idle (the rest area's crowd), the feed lost;
 * - **moving, on Playwright's fake clock**, so every frame is at a known moment: the sea, sail, bob, clouds and
 *   gull over a minute; the storm over ninety seconds; crew changing state and walking, a crewmate climbing out
 *   of the hatch, one archived, one done and walking the plank; night; a sailor focused and the camera's zoom;
 * - **lite** — the software renderer (SwiftShader), moving at its own pace.
 *
 * `CONTROL=1` renders main a second time and compares it with itself first, to show the renders are
 * deterministic. On a difference the three images (main, branch, the differing pixels in red) are written to
 * `.generated/gate/`. Writes `gate-results.json` here and exits non-zero unless every shot is identical.
 */
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const generated = join(root, "docs/ship-deck-canvas/.generated");
const failures = join(generated, "gate");
mkdirSync(failures, { recursive: true });
const rootRequire = createRequire(join(root, "package.json"));
const harness = createRequire(join(root, "docs/board-list/package.json"));
const { build } = harness("esbuild");
const { chromium } = harness("playwright");
const CONTROL = process.env.CONTROL === "1";
/** `SAVE=1` writes every shot of the branch to `.generated/gate/shots/`, to look at. */
const SAVE = process.env.SAVE === "1";
mkdirSync(join(failures, "shots"), { recursive: true });
/** `ONLY=a,b` renders only the scenarios named. */
const ONLY = process.env.ONLY?.split(",") ?? null;

for (const bundle of ["main", "branch"]) {
  if (!existsSync(join(generated, `${bundle}.client.js`))) throw new Error(`no ${bundle} bundle: run node docs/ship-deck-canvas/compile.mjs first`);
}

// ---- The host page, built once for both checkouts.
await build({
  entryPoints: [join(here, "host.jsx")],
  outfile: join(generated, "gate-host.js"),
  bundle: true,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "warning",
  plugins: [
    {
      name: "host",
      setup(builder) {
        builder.onResolve({ filter: /^@getpaseo\/plugin$/ }, () => ({ path: join(root, "docs/board-list/contracts.js") }));
        builder.onResolve({ filter: /^@getpaseo\/plugin\// }, () => ({ path: join(here, "stubs.jsx") }));
        builder.onResolve({ filter: /^(react|zod|@tanstack\/react-query)($|\/)/ }, (args) => ({ path: rootRequire.resolve(args.path) }));
        builder.onResolve({ filter: /^react-dom($|\/)/ }, (args) => ({ path: harness.resolve(args.path) }));
        builder.onResolve({ filter: /^react-native(-web)?$/ }, () => ({ path: harness.resolve("react-native-web") }));
      },
    },
  ],
});

// ---- origin/main as files, with this checkout's node_modules beside it.
const mainDir = join(tmpdir(), `firstmate-gate-main-${process.pid}`);
rmSync(mainDir, { recursive: true, force: true });
mkdirSync(mainDir, { recursive: true });
execFileSync("git", ["-C", root, "archive", "--format=tar", "-o", join(mainDir, "main.tar"), "origin/main"]);
execFileSync("tar", ["-xf", "main.tar"], { cwd: mainDir });
symlinkSync(join(root, "node_modules"), join(mainDir, "node_modules"), "junction");
const commit = (ref) => execFileSync("git", ["-C", root, "rev-parse", "--short", ref], { encoding: "utf8" }).trim();

/**
 * Every deck RPC either checkout may have, answered from that checkout's server modules: the name the client
 * asks by, and how to read it with the checkout's own reader. A reader a checkout lacks answers 404, which its
 * client never asks for.
 */
const DECK_RPCS = {
  "firstmate.deck.engine": (server, at) => server.readDeckEngine?.(at),
  "firstmate.deck.art": (server, at) => server.readDeckArt?.(at),
  "firstmate.deck.environment": (server, at) => server.readDeckEnvironment?.(at),
  "firstmate.deck.extras": (server, at) => server.readDeckExtras?.(at),
  "firstmate.deck.settings": (server, at) => server.listDeckSettings?.(at),
  "firstmate.deck.setting": (server, at, input) => server.readDeckSetting?.(input.id, at),
};
const SERVER_MODULES = ["server/ship-deck.ts", "server/deck-settings.ts"];

async function deckServer(name, dir) {
  const modules = SERVER_MODULES.filter((file) => existsSync(join(dir, file)));
  const outfile = join(generated, `gate-${name}-server.mjs`);
  await build({
    stdin: { contents: modules.map((file, index) => `export * as m${index} from "./${file.replace(/\.ts$/, "")}";`).join("\n"), resolveDir: dir, loader: "ts", sourcefile: "gate-entry.ts" },
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    nodePaths: [join(root, "node_modules")],
    logLevel: "warning",
  });
  const loaded = await import(`${pathToFileURL(outfile).href}?${Date.now()}`);
  const server = Object.assign({}, ...modules.map((_, index) => loaded[`m${index}`]));
  const answers = new Map();
  return function answer(rpc, input) {
    const key = `${rpc} ${JSON.stringify(input)}`;
    if (!answers.has(key)) {
      const read = DECK_RPCS[rpc]?.(server, async () => dir, input);
      answers.set(key, read === undefined ? null : Promise.resolve(read).then((value) => JSON.stringify(value)));
    }
    return answers.get(key);
  };
}

const servers = { main: await deckServer("main", mainDir), branch: await deckServer("branch", root) };
const bundles = { main: join(generated, "main.client.js"), branch: join(generated, "branch.client.js") };
const page = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:Segoe UI,sans-serif}*{box-sizing:border-box}</style>
<div id="root"></div><script src="/host.js"></script>
<script>(async () => { const params = new URLSearchParams(location.search);
  const source = await (await fetch("/bundle/" + params.get("tree") + ".js")).text(); window.mountPlugin(source, params); })();</script>`;
const http = createServer(async (request, response) => {
  const path = new URL(request.url, "http://x").pathname;
  const rpc = /^\/rpc\/(main|branch)\/([a-z.]+)$/.exec(path);
  try {
    if (rpc !== null) {
      let body = "";
      for await (const chunk of request) body += chunk;
      const answer = await servers[rpc[1]](rpc[2], JSON.parse(body || "{}"));
      if (answer === null) {
        response.statusCode = 404;
        response.end(`${rpc[2]} is not served by ${rpc[1]}`);
        return;
      }
      response.setHeader("Content-Type", "application/json");
      response.end(answer);
    } else if (path === "/host.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end(await readFile(join(generated, "gate-host.js")));
    } else if (/^\/bundle\/(main|branch)\.js$/.test(path)) {
      response.setHeader("Content-Type", "application/javascript");
      response.end(await readFile(bundles[path.slice(8, -3)]));
    } else {
      response.setHeader("Content-Type", "text/html");
      response.end(page);
    }
  } catch (error) {
    response.statusCode = 500;
    response.end(String(error?.stack ?? error));
  }
});
await new Promise((done) => http.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${http.address().port}`;

// ---- PNG, enough of it for Playwright's screenshots (8-bit RGB or RGBA, not interlaced).
function decodePng(file) {
  const width = file.readUInt32BE(16);
  const height = file.readUInt32BE(20);
  const channels = { 2: 3, 6: 4 }[file[25]];
  if (file[24] !== 8 || channels === undefined || file[28] !== 0) throw new Error("an unexpected PNG");
  const chunks = [];
  for (let at = 8; at < file.length; ) {
    const length = file.readUInt32BE(at);
    if (file.toString("latin1", at + 4, at + 8) === "IDAT") chunks.push(file.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  const previous = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x];
      const left = x >= channels ? line[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      line[x] = (value + predicted) & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < 3; c += 1) out[(y * width + x) * 4 + c] = line[x * channels + c];
      out[(y * width + x) * 4 + 3] = channels === 4 ? line[x * channels + 3] : 255;
    }
    line.copy(previous);
  }
  return { width, height, rgba: out };
}

function encodePng({ width, height, rgba }) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "latin1");
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** How many pixels differ, and where the first does; on a difference, the three images go to `.generated/gate/`. */
async function compare(name, a, b, labels = ["main", "branch"]) {
  const sha = (png) => createHash("sha256").update(png).digest("hex").slice(0, 16);
  if (a.equals(b)) return { identical: true, differingPixels: 0, sha: sha(a) };
  const [left, right] = [decodePng(a), decodePng(b)];
  if (left.width !== right.width || left.height !== right.height) return { identical: false, sizes: [[left.width, left.height], [right.width, right.height]] };
  let differing = 0;
  let first = null;
  // Where the differences are: the box round them, in screenshot pixels [left, top, right, bottom].
  let box = null;
  const mask = Buffer.from(left.rgba);
  for (let index = 0; index < left.width * left.height; index += 1) {
    const at = index * 4;
    if (left.rgba.readUInt32BE(at) !== right.rgba.readUInt32BE(at)) {
      differing += 1;
      const [x, y] = [index % left.width, Math.floor(index / left.width)];
      first ??= [x, y];
      box = box === null ? [x, y, x, y] : [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
      mask.set([255, 0, 0, 255], at);
    }
  }
  if (differing > 0) {
    await writeFile(join(failures, `${name}.${labels[0]}.png`), a);
    await writeFile(join(failures, `${name}.${labels[1]}.png`), b);
    await writeFile(join(failures, `${name}.diff.png`), encodePng({ ...left, rgba: mask }));
  }
  return { identical: differing === 0, differingPixels: differing, firstDifference: first, box, sha: [sha(a), sha(b)] };
}

// ---- Opening the Deck, and the moments each scenario is shot at.
const NOON = Date.parse("2026-10-14T12:00:00Z");
const errors = [];

async function open(browser, tree, { theme = "dark", working = null, reducedMotion = "no-preference", fakeClock = false, time = NOON, scale = 1, width = 1440, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, reducedMotion, timezoneId: "UTC" });
  const view = await context.newPage();
  view.on("pageerror", (error) => errors.push(`${tree}: ${error.message}`));
  view.on("console", (message) => {
    if (message.type() === "error") errors.push(`${tree} console: ${message.text()}`);
  });
  if (fakeClock) await view.clock.install({ time });
  else await view.clock.setFixedTime(time);
  await view.goto(`${origin}/?tree=${tree}&theme=${theme}${working === null ? "" : `&working=${working}`}`);
  await realWait(view, () => [...document.querySelectorAll("div")].some((node) => node.textContent === "Deck"));
  // Paused at a fixed moment, so the deck starts at the same instant in both checkouts, and nothing moves on
  // until a scenario says how far.
  if (fakeClock) await view.clock.pauseAt(time + 20_000);
  await view.getByText("Deck", { exact: true }).click();
  // In real time: the fake clock stays where it is while the art loads and decodes and Pixi starts. The canvas
  // is put in once all of that is done; its first frame waits for the clock (a moving deck) or follows at once.
  await realWait(view, () => document.querySelector("canvas[data-firstmate-deck]") !== null);
  await view.waitForTimeout(300);
  if (!fakeClock) await realWait(view, () => document.querySelector("canvas[data-firstmate-deck-motion]") !== null);
  await view.mouse.move(5, height - 5);
  await view.evaluate(() => document.activeElement?.blur());
  if (fakeClock) await view.clock.runFor(400);
  else await view.waitForTimeout(800);
  return view;
}

async function realWait(view, predicate) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (await view.evaluate(predicate)) return;
    await view.waitForTimeout(50);
  }
  const state = await view.evaluate(() => ({
    canvases: [...document.querySelectorAll("canvas")].map((canvas) => [...canvas.attributes].map((attribute) => `${attribute.name}=${attribute.value}`).join(" ")),
    text: document.body.textContent.slice(0, 400),
  }));
  throw new Error(`timed out waiting for ${predicate}; page errors: ${JSON.stringify(errors)}; page: ${JSON.stringify(state)}`);
}

/** Re-polls the fleet after the fixture has been changed in the page. */
async function poll(view, change, fakeClock) {
  if (change !== null) await view.evaluate(change);
  await view.getByRole("button", { name: "Refresh" }).click();
  await view.mouse.move(5, view.viewportSize().height - 5);
  if (fakeClock) await view.clock.runFor(50);
  else await view.waitForTimeout(400);
}

/** Shots at each of `moments` (ms from `from`), named `<prefix>-<ms>ms`, the fake clock run on between them. */
async function steps(view, take, prefix, moments, from = 0) {
  let now = from;
  for (const at of moments) {
    await view.clock.runFor(at - now);
    now = at;
    await take(`${prefix}-${at}ms`);
  }
}

const shot = (view) => view.screenshot();
const canvasFacts = (view) =>
  view.evaluate(() => {
    const canvas = document.querySelector("canvas[data-firstmate-deck]");
    return Object.fromEntries([...canvas.attributes].filter((attribute) => attribute.name.startsWith("data-firstmate")).map((attribute) => [attribute.name, attribute.value]));
  });

/** Each scenario: how it opens, and what it does between shots. A step returns the shot's name. */
const SCENARIOS = [
  ...[
    ["still-noon-dark", { theme: "dark", scale: 2 }],
    ["still-noon-light", { theme: "light" }],
    ["still-night", { time: Date.parse("2026-10-14T02:00:00Z"), scale: 2 }],
    ["still-dawn", { time: Date.parse("2026-10-14T05:30:00Z") }],
    ["still-dusk-to-night", { time: Date.parse("2026-10-14T20:15:00Z") }],
    ["still-busy", { working: 8, scale: 2 }],
    ["still-all-idle", { working: 0, scale: 2 }],
  ].map(([name, options]) => ({
    name,
    options: { ...options, reducedMotion: "reduce" },
    async run(view, take) {
      await take("open");
    },
  })),
  {
    name: "still-feed-lost",
    options: { reducedMotion: "reduce" },
    async run(view, take) {
      await poll(view, () => (window.fixtureFleetError = true), false);
      await view.waitForTimeout(600);
      await take("lost");
    },
  },
  {
    name: "moving-noon",
    options: { fakeClock: true, scale: 2 },
    async run(view, take) {
      await take("0.4s");
      for (const [at, step] of [["1s", 600], ["2.5s", 1500], ["5s", 2500], ["10s", 5000], ["25s", 15000], ["49s", 24000], ["73s", 24000]]) {
        await view.clock.runFor(step);
        await take(at);
      }
    },
  },
  {
    name: "moving-storm",
    options: { fakeClock: true, working: 8 },
    async run(view, take) {
      // Every five seconds for two minutes, and the first four flashes of lightning as they show.
      await take("0.4s");
      let flashes = 0;
      for (let tenths = 1; tenths <= 1200; tenths += 1) {
        await view.clock.runFor(100);
        const at = `${(0.4 + tenths / 10).toFixed(1)}s`;
        const flash = await view.evaluate(() => document.querySelector("canvas[data-firstmate-deck]").getAttribute("data-firstmate-deck-flash"));
        if (flash && flashes < 4) {
          flashes += 1;
          await take(`flash-${at}`);
        } else if (tenths % 50 === 0) await take(at);
      }
    },
  },
  {
    name: "moving-night",
    options: { fakeClock: true, time: Date.parse("2026-10-14T02:00:00Z") },
    async run(view, take) {
      await take("0.4s");
      await view.clock.runFor(9600);
      await take("10s");
    },
  },
  {
    name: "moving-crew",
    options: { fakeClock: true, scale: 2 },
    async run(view, take) {
      await take("aboard");
      // The crew changes state: the marks change at once, the sailors walk after.
      await poll(view, () =>
        window.changeFleet(function (fleet) {
          const live = fleet.cards.filter((card) => card.agent !== null && card.agent.status !== "closed" && card.column !== "done" && card.column !== "queued");
          live[0].column = "blocked";
          live[1].column = "working";
          live[2].column = "idle";
          live[3].column = "waiting";
        }),
      true);
      await view.clock.runFor(150);
      await take("changed");
      await steps(view, take, "walking", [1000, 2000, 3000, 5000, 8000], 150);
      await view.clock.runFor(12000);
      await take("arrived");
      // A new crewmate climbs out of the hatch and walks to its post.
      await poll(view, () =>
        window.changeFleet(function (fleet) {
          const source = fleet.cards.find((card) => card.agent !== null && card.agent.status !== "closed" && card.column === "working");
          fleet.cards.push({ ...structuredClone(source), key: "gate-new", taskId: "gate-new", title: "A new crewmate", agent: { ...source.agent, id: "gate-new" } });
        }),
      true);
      await steps(view, take, "hatch", [200, 400, 700, 1500, 3000]);
      await view.clock.runFor(10000);
      // One is done and walks the plank; another's agent closes.
      await poll(view, () =>
        window.changeFleet(function (fleet) {
          const live = fleet.cards.filter((card) => card.agent !== null && card.agent.status !== "closed" && card.column !== "done" && card.column !== "queued");
          live[0].column = "done";
          live[1].agent.status = "closed";
        }),
      true);
      await steps(view, take, "leaving", [300, 800, 1400, 2000, 2400, 2700, 3000, 3300, 3600, 4000, 4600, 5400, 7000]);
      await view.clock.runFor(20000);
      await take("after");
    },
  },
  {
    name: "focus",
    options: { fakeClock: true, scale: 2 },
    async run(view, take) {
      await view.evaluate(() => document.querySelector("canvas[data-firstmate-deck]").parentElement.focus());
      await view.keyboard.press("ArrowRight");
      for (const [at, step] of [["100ms", 100], ["300ms", 200], ["1.5s", 1200]]) {
        await view.clock.runFor(step);
        await take(at);
      }
      await view.keyboard.press("Escape");
      await view.clock.runFor(1500);
      await take("back-out");
    },
  },
];

const LITE = {
  name: "lite-software-renderer",
  options: { fakeClock: true },
  async run(view, take) {
    await take("0.4s");
    for (const [at, step] of [["2s", 1600], ["6s", 4000]]) {
      await view.clock.runFor(step);
      await take(at);
    }
  },
};

async function render(browser, tree, scenario) {
  const view = await open(browser, tree, scenario.options);
  const shots = [];
  const facts = [];
  await scenario.run(view, async function (name) {
    shots.push([name, await shot(view)]);
    facts.push(await canvasFacts(view));
  });
  await view.context().close();
  return { shots, facts };
}

const results = { base: `origin/main ${commit("origin/main")}`, branch: `HEAD ${commit("HEAD")}`, control: null, scenarios: [] };
let identical = true;

async function run(browser, scenario) {
  const label = scenario.name;
  if (CONTROL) {
    const [first, second] = [await render(browser, "main", scenario), await render(browser, "main", scenario)];
    results.control ??= [];
    for (let index = 0; index < first.shots.length; index += 1) {
      const [name, a] = first.shots[index];
      const outcome = await compare(`control-${label}-${name}`, a, second.shots[index][1], ["first", "second"]);
      results.control.push({ scenario: label, shot: name, identical: outcome.identical, differingPixels: outcome.differingPixels });
    }
  }
  const main = await render(browser, "main", scenario);
  const branch = await render(browser, "branch", scenario);
  const shots = [];
  if (main.shots.length !== branch.shots.length) {
    identical = false;
    console.log(`DIFF  ${label}: ${main.shots.length} shots on main, ${branch.shots.length} on the branch`);
  }
  for (let index = 0; index < main.shots.length; index += 1) {
    const [name, a] = main.shots[index];
    // A shot taken on what the deck shows (a flash) must be taken at the same moment in both.
    const outcome = branch.shots[index]?.[0] === name ? await compare(`${label}-${name}`, a, branch.shots[index][1]) : { identical: false, branchShot: branch.shots[index]?.[0] ?? null };
    if (SAVE) await writeFile(join(failures, "shots", `${label}-${name}.png`), branch.shots[index][1]);
    shots.push({ shot: name, ...outcome, canvas: branch.facts[index], canvasMatchesMain: JSON.stringify(main.facts[index]) === JSON.stringify(branch.facts[index]) });
    if (!outcome.identical) identical = false;
    console.log(`${outcome.identical ? "same" : "DIFF"}  ${label} ${name}${outcome.identical ? "" : ` — ${outcome.differingPixels} px in ${outcome.box}`}`);
  }
  results.scenarios.push({ scenario: label, options: scenario.options, shots });
}

try {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const scenario of SCENARIOS) if (ONLY === null || ONLY.includes(scenario.name)) await run(browser, scenario);
  } finally {
    await browser.close();
  }
  const software = await chromium.launch({ channel: "msedge", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    if (ONLY === null || ONLY.includes(LITE.name)) await run(software, LITE);
  } finally {
    await software.close();
  }
} finally {
  http.close();
  unlinkSync(join(mainDir, "node_modules"));
  rmSync(mainDir, { recursive: true, force: true });
}

results.pageErrors = errors;
results.shots = results.scenarios.reduce((sum, scenario) => sum + scenario.shots.length, 0);
results.identical = identical && errors.length === 0;
if (results.control !== null) results.controlIdentical = results.control.every((entry) => entry.identical);
await writeFile(join(here, "gate-results.json"), `${JSON.stringify(results, null, 2)}\n`);
console.log(`${results.shots} shots: ${results.identical ? "pixel-identical to main" : "NOT identical"}${errors.length > 0 ? `; page errors: ${errors.join(" | ")}` : ""}`);
if (!results.identical || results.controlIdentical === false) process.exitCode = 1;
