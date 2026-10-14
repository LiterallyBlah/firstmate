/**
 * The ship deck, behind FIRSTMATE_SHIP_DECK: the scene from a fixture fleet, the mount's every way to
 * start or not, the vendored Pixi build evaluated as the client evaluates it, and the view mounted
 * through react-test-renderer with WebGL stood in for. Whether a real WebGL canvas paints is
 * `docs/ship-deck-motion/render.mjs`, in a real browser. The deck's motion is `deck-motion.test.ts`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { inflateSync } from "node:zlib";
import type { PluginTheme } from "@getpaseo/plugin";
import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" }, View: "View", Text: "Text" }));
const rpcLoads = vi.hoisted(() => ({ count: 0 }));
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: () => () => {
    rpcLoads.count += 1;
    return Promise.reject(new Error("no daemon in the tests"));
  },
}));

import type { AgentStatus, ColumnId, FleetCard, RemoteCard } from "../shared/fleet";
import { deckEngineSource, readDeckEnvironment, readDeckExtras } from "../server/ship-deck";
import { DeckArtManifestSchema, environmentImagePaths, type DeckArt } from "../shared/ship-deck";
import { environmentComplete } from "./deck-environment";
import {
  browserDeckEngine,
  decodeAtlas,
  decodeEnvironment,
  decodeExtras,
  evaluatePixi,
  isDeckHost,
  mountDeck,
  probeWebGL,
  type DeckDrawing,
  type DeckEngine,
  type DeckHost,
  type DeckStatus,
  type StartDeck,
} from "./deck-mount";
import type { DeckHover } from "./deck-hover";
import { fitDeck } from "./deck-pixi";
import type { Figure } from "./deck-crew";
import {
  CAPTION_LINE_MAX,
  DECK_HEIGHT,
  DECK_PROPS,
  DECK_WIDTH,
  deckLayers,
  deckOffered,
  deckScene,
  deckState,
  sailorCaption,
  sailorIdentity,
  type DeckScene,
} from "./deck-scene";
import { ShipDeckView, deckStatusText } from "./ship-deck";

const theme = {
  colors: {
    surface0: "#181B1A",
    surface1: "#1E2120",
    surface2: "#272A29",
    border: "#252B2A",
    foreground: "#fafafa",
    foregroundMuted: "#A1A5A4",
    accent: "#20744A",
    accentForeground: "#ffffff",
    statusSuccess: "#6cb17b",
    statusWarning: "#c09664",
    statusDanger: "#d8847b",
  },
} as unknown as PluginTheme;

function card(
  key: string,
  column: ColumnId,
  options: { status?: AgentStatus | null; note?: string; remote?: Partial<RemoteCard> & { followed?: boolean } } = {},
): FleetCard {
  const status = options.status === undefined ? "idle" : options.status;
  const remote = options.remote;
  return {
    key,
    column,
    taskId: key,
    title: `Task ${key}`,
    project: "ariadne",
    kind: "builder",
    backlog: null,
    agent:
      remote !== undefined || status === null
        ? null
        : {
            id: `agent-${key}`,
            workspaceId: "ws",
            title: key,
            provider: "claude",
            model: null,
            status,
            cwd: "/work",
            pendingPermissions: 0,
            requiresAttention: false,
            lastError: null,
            updatedAt: "2026-10-14T12:00:00.000Z",
            labels: {},
          },
    report: null,
    url: null,
    ...(options.note === undefined ? {} : { note: options.note }),
    ...(remote === undefined
      ? {}
      : {
          remote: {
            serverId: "light",
            host: "Light",
            online: true,
            clockSkewSeconds: 0,
            worker: {
              id: `worker-${key}`,
              name: key,
              status: "running",
              updatedAt: "2026-10-14T12:00:00.000Z",
              pendingPermissions: 0,
              permissionDetails: [],
              recentTools: [],
              followed: remote.followed ?? false,
            },
          },
        }),
  };
}

/** Two working (one remote), one waiting on a job, one ready, one blocked, one failed, one idle, one parked — and four not on deck. */
const fixture: FleetCard[] = [
  card("w1", "working", { status: "running" }),
  card("w2", "working", { remote: {} }),
  card("w3", "working", { status: "idle", note: "waiting" }),
  card("r1", "ready"),
  card("b1", "blocked"),
  card("f1", "failed", { status: "error" }),
  card("i1", "idle"),
  card("p1", "parked"),
  card("q1", "queued", { status: null }),
  card("d1", "done"),
  card("c1", "working", { status: "closed" }),
  card("followed", "working", { remote: { followed: true } }),
];

describe("who each sailor is", () => {
  const captions = () => Object.fromEntries(deckScene(fixture, theme).sailors.map((sailor) => [sailor.key, sailor.caption]));

  it("labels every state with the card's title, its column in the board's words, and where it works", () => {
    const byKey = captions();
    expect(Object.fromEntries(Object.entries(byKey).map(([key, caption]) => [key, caption.status]))).toEqual({
      w1: "Working",
      w2: "Working",
      w3: "Working · waiting on a job it started",
      r1: "Ready · finished, waiting on the first mate",
      b1: "Blocked",
      f1: "Failed",
      i1: "Idle · its turn ended with no status line",
      p1: "Parked · paused",
    });
    expect(byKey.i1).toEqual({ title: "Task i1", status: "Idle · its turn ended with no status line", project: "ariadne", host: "This machine", line: null, stale: null });
    // A remote worker names its host.
    expect(byKey.w2?.host).toBe("Light");
    const stalled = sailorCaption({ ...card("s1", "idle"), note: "stalled" });
    expect(stalled.status).toBe("Idle · stalled: said working, then stopped");
  });

  it("carries the card's line at rest: the captain's call, a status line, an error — cut when long", () => {
    const held = card("h1", "blocked");
    held.backlog = { hold: "pick a database" } as unknown as FleetCard["backlog"];
    expect(sailorCaption(held).line).toBe("Captain's call: pick a database");
    const reported = { ...card("d2", "ready"), report: { state: "done", text: "PR https://example.test/pr/7" } } as unknown as FleetCard;
    expect(sailorCaption(reported).line).toBe("Done: PR https://example.test/pr/7");
    const failed = card("e1", "failed", { status: "error" });
    failed.agent!.lastError = "the build broke\n\n  twice";
    expect(sailorCaption(failed).line).toBe("the build broke twice");
    const long = { ...card("l1", "ready"), report: { state: "done", text: "x".repeat(400) } } as unknown as FleetCard;
    const line = sailorCaption(long).line!;
    expect(line).toHaveLength(CAPTION_LINE_MAX);
    expect(line.endsWith("…")).toBe(true);
  });

  it("says why a greyed sailor is greyed: the feed lost, or its host out of reach", () => {
    expect(deckScene(fixture, theme, { feedStale: true }).sailors.every((s) => s.caption.stale === "Feed lost: shown where it last stood")).toBe(true);
    const offline = card("o1", "working", { remote: {} });
    offline.remote!.online = false;
    expect(sailorCaption(offline).stale).toBe("Light is out of reach: shown where it last stood");
  });
});

describe("the deck's scene", () => {
  it("puts each live crewmate where its column says, and leaves the rest off deck", () => {
    expect(Object.fromEntries(fixture.map((c) => [c.key, deckState(c)]))).toEqual({
      w1: "working",
      w2: "working",
      w3: "waiting",
      r1: "waiting",
      b1: "blocked",
      f1: "blocked",
      i1: "idle",
      p1: "idle",
      q1: null,
      d1: null,
      c1: null,
      followed: null,
    });
  });

  it("draws one sailor per live crewmate from a fixture fleet, saying only what each is doing", () => {
    const scene = deckScene(fixture, theme);
    expect(scene.counts).toEqual({ working: 2, waiting: 2, blocked: 2, idle: 2 });
    expect(scene.sailors.map((s) => s.key)).toEqual(["w1", "w2", "r1", "w3", "b1", "f1", "i1", "p1"]);
    expect(scene.sailors.map((s) => s.state)).toEqual(["working", "working", "waiting", "waiting", "blocked", "blocked", "idle", "idle"]);
    expect(Object.keys(scene.sailors[0]!).sort()).toEqual(["caption", "identity", "key", "label", "stale", "state"]);
    // Who each is, never where: the caption has no position either.
    expect(Object.keys(scene.sailors[0]!.caption).sort()).toEqual(["host", "line", "project", "stale", "status", "title"]);
    expect(scene.stale).toBe(0);
    expect(scene.palette.states).toEqual({ working: "#6cb17b", waiting: "#c09664", blocked: "#d8847b", idle: "#A1A5A4" });
  });

  it("is the same deck for the same crew in any order", () => {
    expect(deckScene([...fixture].reverse(), theme)).toEqual(deckScene(fixture, theme));
  });

  it("greys the whole crew when the feed is lost, and a remote host's workers when it is out of reach, keeping every state", () => {
    const live = deckScene(fixture, theme);
    const lost = deckScene(fixture, theme, { feedStale: true });
    expect(lost.stale).toBe(8);
    expect(lost.sailors.every((s) => s.stale)).toBe(true);
    // Never idle on its own: the same states and counts as the last load.
    expect(lost.sailors.map((s) => s.state)).toEqual(live.sailors.map((s) => s.state));
    expect(lost.counts).toEqual(live.counts);
    const remote = card("w9", "working", { remote: {} });
    const unreachable: FleetCard = { ...remote, remote: { ...remote.remote!, online: false } };
    const partly = deckScene([...fixture, unreachable], theme);
    expect(partly.stale).toBe(1);
    expect(partly.sailors.find((s) => s.key === "w9")).toMatchObject({ state: "working", stale: true });
    expect(partly.sailors.filter((s) => s.key !== "w9").every((s) => !s.stale)).toBe(true);
  });

  it("knows each sailor by its agent's id, a remote worker by its host and id, for the look it wears", () => {
    const scene = deckScene(fixture, theme);
    for (const sailor of scene.sailors) expect(sailor.identity).toBe(sailorIdentity(fixture.find((c) => c.key === sailor.key)!));
    expect(sailorIdentity(card("w1", "working"))).toBe("agent-w1");
    expect(sailorIdentity(card("w2", "working", { remote: {} }))).toBe("light:worker-w2");
    expect(sailorIdentity(card("q1", "queued", { status: null }))).toBe("q1");
  });
});

/** The served atlas, decoded: enough of PNG for the one the build writes (8-bit RGBA, not interlaced). */
function decodePng(file: Buffer): { width: number; height: number; alpha: (x: number, y: number) => number } {
  const width = file.readUInt32BE(16);
  const height = file.readUInt32BE(20);
  expect([file[24], file[25], file[28]]).toEqual([8, 6, 0]);
  const chunks: Buffer[] = [];
  for (let at = 8; at < file.length; ) {
    const length = file.readUInt32BE(at);
    if (file.toString("latin1", at + 4, at + 8) === "IDAT") chunks.push(file.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)] ?? 0;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x] ?? 0;
      const left = x >= 4 ? (pixels[y * stride + x - 4] ?? 0) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const corner = x >= 4 && y > 0 ? (pixels[(y - 1) * stride + x - 4] ?? 0) : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)];
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      pixels[y * stride + x] = (value + predicted) & 0xff;
    }
  }
  return { width, height, alpha: (x, y) => pixels[y * stride + x * 4 + 3] ?? 0 };
}

describe("the deck's art", () => {
  const manifest = DeckArtManifestSchema.parse(JSON.parse(readFileSync(new URL("../art/ship-deck/deck.json", import.meta.url), "utf8")));
  const atlas = decodePng(readFileSync(new URL("../art/ship-deck/deck.png", import.meta.url)));
  const opaque = (frame: readonly number[], x: number, y: number) => {
    const [fx = 0, fy = 0, fw = 0, fh = 0] = frame;
    return x >= 0 && y >= 0 && x < fw && y < fh && atlas.alpha(fx + x, fy + y) === 255;
  };

  it("is the hull the scene's coordinates are, in an atlas the manifest describes", () => {
    expect(manifest.ship.frame).toEqual([0, 0, DECK_WIDTH, DECK_HEIGHT]);
    expect([atlas.width, atlas.height]).toEqual([manifest.atlas.width, manifest.atlas.height]);
    expect(manifest.atlas.colours).toBeLessThanOrEqual(48);
    expect(Object.keys(manifest.pieces).sort()).toEqual([
      "bollard-bow-aft",
      "bollard-bow-fore",
      "bollard-gunwale-aft",
      "bollard-gunwale-fore",
      "mast",
      "near",
    ]);
    expect(manifest.pieces.near?.baseline).toBeNull();
  });

  it("stands every prop on the deck", () => {
    for (const prop of DECK_PROPS) expect(opaque(manifest.ship.frame, prop.x, prop.y), prop.name).toBe(true);
  });

  it("draws the hull first, the near rail last, and everything else by the row it stands on", () => {
    const at = (x: number, y: number, key: string): Figure => ({
      key,
      label: key,
      state: "working",
      stale: false,
      look: "base",
      outfit: "base",
      x,
      y: y - 1,
      row: y,
      pose: "hauling",
      flip: false,
      reveal: 1,
      moving: true,
      seed: 0,
      sink: 0,
    });
    const figures = [at(211, 111, "before-mast"), at(211, 100, "behind-mast"), at(80, 94, "behind-bollard"), at(80, 95, "before-bollard")];
    const order = deckLayers(figures, manifest.pieces).map((layer) =>
      layer.kind === "ship" ? "ship" : layer.kind === "piece" ? `piece:${layer.name}` : layer.kind === "prop" ? `prop:${layer.name}` : layer.figure.key,
    );
    expect(order[0]).toBe("ship");
    expect(order.at(-1)).toBe("piece:near");
    const before = (a: string, b: string) => expect(order.indexOf(a), `${a} before ${b}`).toBeLessThan(order.indexOf(b));
    before("behind-mast", "piece:mast");
    before("piece:mast", "before-mast");
    before("behind-bollard", "piece:bollard-bow-aft");
    before("piece:bollard-bow-aft", "before-bollard");
    before("prop:barrel", "behind-mast");
    expect(order).toHaveLength(1 + DECK_PROPS.length + 4 + Object.keys(manifest.pieces).length);
  });

  it("fits the deck exactly at any size, its offset on whole device pixels", () => {
    const deck = { width: DECK_WIDTH, height: DECK_HEIGHT };
    expect(fitDeck({ width: 1000, height: 800 }, deck, 1).scale).toBeCloseTo((1000 / DECK_WIDTH) * 0.96);
    expect(fitDeck({ width: 1000, height: 800 }, deck, 1.5).scale).toBeCloseTo((1000 / DECK_WIDTH) * 0.96);
    // A short pane: the height decides.
    expect(fitDeck({ width: 1000, height: 200 }, deck, 2).scale).toBeCloseTo((200 / DECK_HEIGHT) * 0.96);
    const small = fitDeck({ width: 600, height: 400 }, deck, 1);
    expect(small.scale).toBeCloseTo((600 / DECK_WIDTH) * 0.96);
    expect(small.x).toBe(Math.round((600 - DECK_WIDTH * small.scale) / 2));
    const hidpi = fitDeck({ width: 777, height: 555 }, deck, 1.25);
    expect(Number.isInteger(hidpi.x * 1.25) && Number.isInteger(hidpi.y * 1.25)).toBe(true);
    expect(fitDeck({ width: 0, height: 0 }, deck, 2).scale).toBe(0);
  });
});

describe("the switch on the screen", () => {
  it("offers the deck only when the load says so, in a web renderer, on the wide layout", () => {
    expect(deckOffered({ shipDeck: true }, "web", false)).toBe(true);
    // Off: the load has no key, and nothing is offered.
    expect(deckOffered({}, "web", false)).toBe(false);
    expect(deckOffered(null, "web", false)).toBe(false);
    expect(deckOffered({ shipDeck: true }, "ios", false)).toBe(false);
    expect(deckOffered({ shipDeck: true }, "android", false)).toBe(false);
    expect(deckOffered({ shipDeck: true }, "web", true)).toBe(false);
  });
});

function fakeHost(width = 640, height = 300): DeckHost & { children: unknown[] } {
  const children: unknown[] = [];
  return { children, clientWidth: width, clientHeight: height, appendChild: (node: unknown) => children.push(node) };
}

interface FakeEngine extends DeckEngine {
  starts: Array<{ host: DeckHost; scene: DeckScene; size: { width: number; height: number } }>;
  drawings: Array<DeckDrawing & { updates: DeckScene[]; resizes: number[][]; destroyed: number }>;
  loads: number;
  probes: number;
  stops: number;
  resize?: (width: number, height: number) => void;
  hover?: (hover: DeckHover | null) => void;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeEngine(options: { webgl?: "webgl2" | "webgl" | null; load?: () => Promise<StartDeck>; startFails?: Error; hold?: Promise<void> } = {}): FakeEngine {
  const engine: FakeEngine = {
    starts: [],
    drawings: [],
    loads: 0,
    probes: 0,
    stops: 0,
    probe() {
      engine.probes += 1;
      return options.webgl === undefined ? "webgl2" : options.webgl;
    },
    load() {
      engine.loads += 1;
      if (options.load !== undefined) return options.load();
      return Promise.resolve<StartDeck>(async (host, scene, size, onHover) => {
        engine.starts.push({ host, scene, size });
        engine.hover = onHover;
        if (options.hold !== undefined) await options.hold;
        if (options.startFails !== undefined) throw options.startFails;
        const drawing = {
          renderer: "webgl",
          updates: [] as DeckScene[],
          resizes: [] as number[][],
          destroyed: 0,
          update(next: DeckScene) {
            drawing.updates.push(next);
          },
          resize(width: number, height: number) {
            drawing.resizes.push([width, height]);
          },
          destroy() {
            drawing.destroyed += 1;
          },
        };
        host.appendChild({ canvas: true });
        engine.drawings.push(drawing);
        return drawing;
      });
    },
    observeSize(_host, onSize) {
      engine.resize = onSize;
      return () => {
        engine.stops += 1;
      };
    },
  };
  return engine;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Every constructor `evaluatePixi` looks for, as do-nothing stand-ins. */
const FAKE_PIXI_PARTS = "Application() {}, Container() {}, Graphics() {}, Sprite() {}, ImageSource() {}, Texture() {}, Rectangle() {}";

describe("mounting the deck", () => {
  const scene = deckScene(fixture, theme);

  it("initialises the canvas from a fixture fleet's scene, at the host's size", async () => {
    const engine = fakeEngine();
    const host = fakeHost();
    const statuses: DeckStatus[] = [];
    const mount = mountDeck(host, scene, engine, (s) => statuses.push(s));
    await flush();
    expect(engine.starts).toHaveLength(1);
    expect(engine.starts[0]?.host).toBe(host);
    expect(engine.starts[0]?.scene.sailors).toHaveLength(8);
    expect(engine.starts[0]?.size).toEqual({ width: 640, height: 300 });
    expect(host.children).toEqual([{ canvas: true }]);
    expect(statuses).toEqual([{ kind: "starting" }, { kind: "drawing", renderer: "webgl" }]);

    engine.resize?.(800, 400);
    expect(engine.drawings[0]?.resizes).toEqual([[800, 400]]);
    const next = deckScene(fixture.slice(0, 2), theme);
    mount.update(next);
    expect(engine.drawings[0]?.updates).toEqual([next]);

    mount.destroy();
    expect(engine.drawings[0]?.destroyed).toBe(1);
    expect(engine.stops).toBe(1);
  });

  it("draws the newest scene once Pixi is up, if the fleet moved while it started", async () => {
    const hold = deferred<void>();
    const engine = fakeEngine({ hold: hold.promise });
    const mount = mountDeck(fakeHost(), scene, engine, () => {});
    await flush();
    const newer = deckScene(fixture.slice(0, 3), theme);
    mount.update(newer);
    hold.resolve();
    await flush();
    expect(engine.drawings[0]?.updates).toEqual([newer]);
  });

  it("destroys what starts after it was torn down, and never reports it", async () => {
    const hold = deferred<void>();
    const engine = fakeEngine({ hold: hold.promise });
    const statuses: DeckStatus[] = [];
    const mount = mountDeck(fakeHost(), scene, engine, (s) => statuses.push(s));
    await flush();
    mount.destroy();
    hold.resolve();
    await flush();
    expect(engine.drawings[0]?.destroyed).toBe(1);
    expect(statuses).toEqual([{ kind: "starting" }]);
  });

  it("does not start Pixi at all when torn down before it loaded", async () => {
    const load = deferred<StartDeck>();
    const engine = fakeEngine({ load: () => load.promise });
    const mount = mountDeck(fakeHost(), scene, engine, () => {});
    mount.destroy();
    load.resolve(async () => {
      throw new Error("must not start");
    });
    await flush();
    expect(engine.starts).toHaveLength(0);
  });

  it("degrades to a message, never a throw, and loads no Pixi without a host or WebGL", async () => {
    for (const [node, engine, reason] of [
      [null, fakeEngine(), "no-host"],
      [{ nativeTag: 4 }, fakeEngine(), "no-host"],
      [fakeHost(), fakeEngine({ webgl: null }), "no-webgl"],
      [
        fakeHost(),
        {
          ...fakeEngine(),
          probe() {
            throw new Error("getContext exploded");
          },
        },
        "no-webgl",
      ],
    ] as const) {
      const statuses: DeckStatus[] = [];
      const mount = mountDeck(node, scene, engine, (s) => statuses.push(s));
      mount.update(scene);
      mount.destroy();
      await flush();
      expect(statuses).toEqual([{ kind: "unsupported", reason }]);
      expect((engine as FakeEngine).loads).toBe(0);
    }
  });

  it("reports Pixi failing to load or to start", async () => {
    for (const engine of [
      fakeEngine({ load: () => Promise.reject(new Error("chunk failed")) }),
      fakeEngine({ startFails: new Error("WebGL context could not be created") }),
    ]) {
      const statuses: DeckStatus[] = [];
      mountDeck(fakeHost(), scene, engine, (s) => statuses.push(s));
      await flush();
      expect(statuses.at(-1)?.kind).toBe("failed");
    }
  });

  it("knows a DOM element from a native view", () => {
    expect(isDeckHost(fakeHost())).toBe(true);
    expect(isDeckHost({ appendChild() {} })).toBe(false);
    expect(isDeckHost(undefined)).toBe(false);
  });
});

describe("probing for WebGL", () => {
  it("finds WebGL 2 first, and gives the probe's context straight back", () => {
    let lost = 0;
    const asked: string[] = [];
    const web = {
      document: {
        createElement: () => ({
          getContext(kind: string) {
            asked.push(kind);
            return { getExtension: () => ({ loseContext: () => (lost += 1) }) };
          },
        }),
      },
    };
    expect(probeWebGL(web)).toBe("webgl2");
    expect(asked).toEqual(["webgl2"]);
    expect(lost).toBe(1);
  });

  it("falls back to WebGL 1, and says so when there is neither or no document", () => {
    const only1 = { document: { createElement: () => ({ getContext: (kind: string) => (kind === "webgl" ? { getExtension: () => null } : null) }) } };
    expect(probeWebGL(only1)).toBe("webgl");
    expect(probeWebGL({ document: { createElement: () => ({ getContext: () => null }) } })).toBeNull();
    expect(probeWebGL({})).toBeNull();
  });
});

describe("Pixi, as the daemon serves it and the client evaluates it", () => {
  const vendored = deckEngineSource(readFileSync(new URL("../vendor/pixi.min.js", import.meta.url), "utf8"));

  it("evaluates the vendored build to Pixi's namespace, without leaking it into globals", () => {
    const pixi = evaluatePixi(vendored);
    expect(pixi.VERSION).toBe("8.22.0");
    expect(typeof pixi.Application).toBe("function");
    expect(typeof pixi.Graphics).toBe("function");
    expect("PIXI" in globalThis).toBe(false);
  });

  it("has every method client/deck-pixi.ts draws with", () => {
    // Pixi's own types cannot be imported here: they pull in the DOM library for the whole project
    // (`@xmldom/xmldom` references it), which client/ is kept free of. So the narrow PixiModule is held
    // to the real build at run time instead, and render.mjs draws with it in a browser.
    const pixi = evaluatePixi(vendored);
    const methods = (type: unknown) => {
      const names = new Set<string>();
      for (let proto = (type as { prototype: object }).prototype; proto !== null; proto = Object.getPrototypeOf(proto) as object) {
        for (const name of Object.getOwnPropertyNames(proto)) names.add(name);
      }
      return names;
    };
    const app = methods(pixi.Application);
    for (const name of ["init", "render", "destroy", "canvas", "screen"]) expect(app.has(name), name).toBe(true);
    // The stage is made in the constructor, the renderer by init.
    expect(new pixi.Application().stage).toBeInstanceOf(pixi.Container);
    const container = methods(pixi.Container);
    for (const name of ["addChild", "removeChild", "destroy", "label", "position", "scale", "zIndex", "sortableChildren", "visible", "alpha", "tint"]) {
      expect(container.has(name), name).toBe(true);
    }
    const graphics = methods(pixi.Graphics);
    for (const name of ["clear", "rect", "circle", "ellipse", "fill", "stroke", "addChild", "destroy", "tint"]) expect(graphics.has(name), name).toBe(true);
    const sprite = methods(pixi.Sprite);
    for (const name of ["anchor", "texture", "tint", "position", "scale", "label", "destroy"]) expect(sprite.has(name), name).toBe(true);
    for (const name of ["scaleMode", "destroy"]) expect(methods(pixi.ImageSource).has(name), name).toBe(true);
    expect(methods(pixi.Texture).has("destroy")).toBe(true);
    // A texture cut from an atlas: the frame the deck asks for is the one it gets, sampled nearest.
    const source = new pixi.ImageSource({ resource: { width: 40, height: 30 } });
    source.scaleMode = "nearest";
    const texture = new pixi.Texture({ source, frame: new pixi.Rectangle(2, 3, 10, 20) }) as unknown as {
      frame: { x: number; y: number; width: number; height: number };
    };
    expect([texture.frame.x, texture.frame.y, texture.frame.width, texture.frame.height]).toEqual([2, 3, 10, 20]);
    expect(source.scaleMode).toBe("nearest");
  });

  it("refuses a build that is not the Pixi it claims to be", () => {
    const stub = (body: string) => ({ version: "8.22.0", source: body });
    expect(() => evaluatePixi(stub("var NOT_PIXI = {};"))).toThrow("no PIXI namespace");
    expect(() => evaluatePixi(stub("var PIXI = { VERSION: '8.22.0', Application() {}, Container() {} };"))).toThrow("no Graphics");
    expect(() => evaluatePixi(stub("var PIXI = { VERSION: '8.22.0', Application() {}, Container() {}, Graphics() {} };"))).toThrow("no Sprite");
    expect(() => evaluatePixi(stub(`var PIXI = { VERSION: '7.0.0', ${FAKE_PIXI_PARTS} };`))).toThrow("says 7.0.0, not 8.22.0");
  });

  it("fetches Pixi and the art once a session, decodes the atlas, and tries again after a failure", async () => {
    let sources = 0;
    let arts = 0;
    let environments = 0;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The environment never loads here: the deck is drawn without it, and asks again on the next open.
    const noEnvironment = () => {
      environments += 1;
      return Promise.reject(new Error("sea away"));
    };
    // Nor do the sail and the crew's looks: a bare mast and the atlas's two outfits, asked for again likewise.
    let extras = 0;
    const noExtras = () => {
      extras += 1;
      return Promise.reject(new Error("rig away"));
    };
    const decoded: string[] = [];
    const good = { version: "1.2.3", source: `var PIXI = { VERSION: '1.2.3', ${FAKE_PIXI_PARTS} };` };
    const art = { png: "iVBOR", manifest: {} } as unknown as DeckArt;
    const decode = (png: string) => {
      decoded.push(png);
      return Promise.resolve({ decoded: png });
    };
    const failing = browserDeckEngine(
      () => {
        sources += 1;
        return Promise.resolve(good);
      },
      () => {
        arts += 1;
        return Promise.reject(new Error("art away"));
      },
      noEnvironment,
      noExtras,
      decode,
    );
    await expect(failing.load()).rejects.toThrow("art away");
    const engine = browserDeckEngine(
      () => {
        sources += 1;
        return Promise.resolve(good);
      },
      () => {
        arts += 1;
        return Promise.resolve(art);
      },
      noEnvironment,
      noExtras,
      decode,
    );
    const [first, second] = await Promise.all([engine.load(), engine.load()]);
    expect(typeof first).toBe("function");
    expect(typeof second).toBe("function");
    await engine.load();
    expect([sources, arts]).toEqual([2, 2]);
    expect(decoded).toEqual(["iVBOR"]);
    // Once for the failing open, once for the two at once, once more for the last.
    expect(environments).toBe(3);
    expect(extras).toBe(3);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("drawing a plain sea"), expect.any(Error));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("drawing a bare mast"), expect.any(Error));
    warn.mockRestore();
  });

  it("decodes every image the environment names, and refuses one it did not send", async () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const environment = await readDeckEnvironment({ FIRSTMATE_SHIP_DECK: "1" }, async () => root);
    const decoded = await decodeEnvironment(environment, (png) => Promise.resolve({ png }));
    expect([...decoded.images.keys()]).toEqual(environmentImagePaths(environment.manifest));
    expect(decoded.images.get("sky/night.png")).toEqual({ png: environment.images["sky/night.png"] });
    expect(environmentComplete(decoded)).toBe(true);
    const { "sky/dusk.png": _dusk, ...missing } = environment.images;
    await expect(decodeEnvironment({ ...environment, images: missing }, (png) => Promise.resolve(png))).rejects.toThrow("no sky/dusk.png");
    expect(environmentComplete({ manifest: environment.manifest, images: new Map() })).toBe(false);
    expect(environmentComplete(null)).toBe(false);
  });

  it("decodes the atlas as a PNG data URL, and says so where there is no image decoder", async () => {
    const made: Array<{ src: string }> = [];
    const FakeImage = function (this: { src: string; decode(): Promise<void> }) {
      this.src = "";
      this.decode = () => Promise.resolve();
      made.push(this);
    } as unknown as new () => { src: string; decode(): Promise<void> };
    const image = await decodeAtlas("AAAA", { Image: FakeImage });
    expect(image).toBe(made[0]);
    expect(made[0]?.src).toBe("data:image/png;base64,AAAA");
    await expect(decodeAtlas("AAAA", {})).rejects.toThrow("cannot decode images");
  });
});

describe("the ship deck view", () => {
  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
  let renderer: ReactTestRenderer | null = null;
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = null;
  });

  function text(root: ReactTestRenderer): string {
    return root.root
      .findAll((node) => (node.type as unknown) === "Text")
      .map((node) => node.children.join(""))
      .join(" | ");
  }

  it("mounts in a web renderer and draws the fixture fleet into its host view", async () => {
    const engine = fakeEngine();
    const host = fakeHost();
    await act(async () => {
      renderer = create(createElement(ShipDeckView, { cards: fixture, theme, engine, os: "web" }), {
        createNodeMock: () => host,
      });
    });
    await act(flush);
    const root = renderer!;
    expect(engine.starts).toHaveLength(1);
    expect(engine.starts[0]?.host).toBe(host);
    expect(engine.starts[0]?.scene.sailors.map((s) => s.key)).toEqual(["w1", "w2", "r1", "w3", "b1", "f1", "i1", "p1"]);
    expect(text(root)).toContain("Preview · drawn with WebGL · 8 on deck");
    expect(text(root)).toContain("2 working | hauling amidships | 2 waiting | by the helm | 2 blocked | in the bow | 2 idle | at the rail");
    expect(text(root)).toContain("Point at a sailor to see who it is");
    const canvasHost = root.root.find((node) => node.props.accessibilityRole === "image");
    expect(canvasHost.props.accessibilityLabel).toBe("Ship deck: 2 working, 2 waiting, 2 blocked, 2 idle");
    // A canvas host must stay childless: React owns the element, Pixi owns what is inside it.
    expect(canvasHost.children).toHaveLength(0);

    await act(async () => {
      root.update(createElement(ShipDeckView, { cards: fixture.slice(0, 1), theme, engine, os: "web" }));
    });
    expect(engine.drawings[0]?.updates.at(-1)?.sailors.map((s) => s.key)).toEqual(["w1"]);

    act(() => root.unmount());
    renderer = null;
    expect(engine.drawings[0]?.destroyed).toBe(1);
  });

  it("with the feed lost, greys the crew it last saw and says so, keeping every count", async () => {
    const engine = fakeEngine();
    await act(async () => {
      renderer = create(createElement(ShipDeckView, { cards: fixture, theme, engine, os: "web", stale: true }), {
        createNodeMock: () => fakeHost(),
      });
    });
    await act(flush);
    const root = renderer!;
    expect(text(root)).toContain("The crew's feed is lost: the deck shows where everyone last stood, greyed.");
    expect(text(root)).toContain("2 idle | at the rail | 8 stale");
    const canvasHost = root.root.find((node) => node.props.accessibilityRole === "image");
    expect(canvasHost.props.accessibilityLabel).toBe("Ship deck: 2 working, 2 waiting, 2 blocked, 2 idle, feed lost: last known");
    expect(engine.starts[0]?.scene.sailors.every((s) => s.stale)).toBe(true);
    await act(async () => {
      root.update(createElement(ShipDeckView, { cards: fixture, theme, engine, os: "web", stale: false }));
    });
    expect(text(root)).not.toContain("stale");
    expect(engine.drawings[0]?.updates.at(-1)?.stale).toBe(0);
  });

  it("on a phone says where it draws, with no host view and no WebGL or Pixi touched", async () => {
    const engine = fakeEngine();
    await act(async () => {
      renderer = create(createElement(ShipDeckView, { cards: fixture, theme, engine, os: "ios" }));
    });
    const root = renderer!;
    expect(text(root)).toContain("The ship deck draws only in the Paseo desktop app.");
    expect(root.root.findAll((node) => node.props.accessibilityRole === "image")).toHaveLength(0);
    expect(engine.probes).toBe(0);
    expect(engine.loads).toBe(0);
  });

  it("with its own engine, asks the daemon for Pixi only once a host and WebGL are found", async () => {
    rpcLoads.count = 0;
    await act(async () => {
      renderer = create(createElement(ShipDeckView, { cards: fixture, theme, os: "web" }), {
        createNodeMock: () => ({}),
      });
    });
    // No DOM element behind the view: the deck says so and never fetches Pixi.
    expect(text(renderer!)).toContain("desktop app");
    expect(rpcLoads.count).toBe(0);
  });

  it("without WebGL shows a plain message in the canvas's place", async () => {
    const engine = fakeEngine({ webgl: null });
    await act(async () => {
      renderer = create(createElement(ShipDeckView, { cards: fixture, theme, engine, os: "web" }), {
        createNodeMock: () => fakeHost(),
      });
    });
    expect(text(renderer!)).toContain("This display has no WebGL, so the ship deck cannot draw.");
    expect(engine.loads).toBe(0);
  });

  it("labels the sailor under the pointer with who it is, over the canvas, and takes it away after", async () => {
    const engine = fakeEngine();
    await act(async () => {
      renderer = create(createElement(ShipDeckView, { cards: fixture, theme, engine, os: "web" }), {
        createNodeMock: () => fakeHost(),
      });
    });
    await act(flush);
    const root = renderer!;
    const labels = () => root.root.findAll((node) => node.props.accessibilityRole === "text");
    const words = (node: (typeof labels extends () => Array<infer T> ? T : never)) =>
      node.findAll((child) => (child.type as unknown) === "Text").map((child) => child.children.join("")).join(" | ");
    expect(labels()).toHaveLength(0);

    const where = { x: 300, top: 200, bottom: 260, width: 640, height: 300 };
    await act(async () => engine.hover?.({ key: "i1", ...where }));
    expect(labels()).toHaveLength(1);
    expect(words(labels()[0]!)).toBe("Task i1 | Idle · its turn ended with no status line | ariadne · This machine");
    // Above the sailor, centred on it; it never takes the pointer from the canvas.
    expect(labels()[0]!.props.style).toMatchObject({ position: "absolute", pointerEvents: "none", left: 170, width: 260, bottom: 106 });
    // The canvas's host stays childless: the label is its sibling.
    expect(root.root.find((node) => node.props.accessibilityRole === "image").children).toHaveLength(0);

    for (const [key, status] of [
      ["w1", "Working"],
      ["w3", "Working · waiting on a job it started"],
      ["r1", "Ready · finished, waiting on the first mate"],
      ["b1", "Blocked"],
      ["f1", "Failed"],
      ["p1", "Parked · paused"],
    ] as const) {
      await act(async () => engine.hover?.({ key, ...where }));
      expect(words(labels()[0]!)).toContain(`Task ${key} | ${status} | ariadne · `);
    }
    await act(async () => engine.hover?.({ key: "w2", ...where, top: 40, bottom: 90 }));
    expect(words(labels()[0]!)).toBe("Task w2 | Working | ariadne · Light");
    // No room above: below its feet.
    expect(labels()[0]!.props.style).toMatchObject({ top: 96 });

    await act(async () => engine.hover?.(null));
    expect(labels()).toHaveLength(0);
    // A sailor that has left the deck gets no label.
    await act(async () => engine.hover?.({ key: "gone", ...where }));
    expect(labels()).toHaveLength(0);
  });

  it("words every status", () => {
    expect(deckStatusText({ kind: "drawing", renderer: "webgl" })).toBeNull();
    expect(deckStatusText({ kind: "starting" })).toBe("Raising the deck…");
    expect(deckStatusText({ kind: "failed", message: "boom" })).toBe("The ship deck could not start: boom");
    expect(deckStatusText({ kind: "unsupported", reason: "no-host" })).toContain("desktop app");
  });
});

describe("the sail and the crew's looks, decoded", () => {
  it("keeps every image that decodes and leaves out, by name, one that is missing or will not decode", async () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const extras = await readDeckExtras({ FIRSTMATE_SHIP_DECK: "1" }, async () => root);
    const all = await decodeExtras(extras, (png) => Promise.resolve({ png }));
    expect([...all.images.keys()]).toHaveLength(8);
    const missing: string[] = [];
    const { ["crew-variants/03-navigator.png"]: _navigator, ...without } = extras.images;
    const some = await decodeExtras(
      { manifest: extras.manifest, images: without },
      (png) => (png === extras.images["sails/main-sail.png"] ? Promise.reject(new Error("bad png")) : Promise.resolve({ png })),
      (path) => missing.push(path),
    );
    expect(missing.sort()).toEqual(["crew-variants/03-navigator.png", "sails/main-sail.png"]);
    expect([...some.images.keys()]).toHaveLength(6);
    expect(some.manifest).toBe(extras.manifest);
  });
});
