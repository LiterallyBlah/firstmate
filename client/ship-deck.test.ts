/**
 * The ship deck: the scene from a fixture fleet, the mount's every way to
 * start or not, the vendored Pixi build evaluated as the client evaluates it, and the view mounted
 * through react-test-renderer with WebGL stood in for. Whether a real WebGL canvas paints is
 * `docs/deck-settings/gate.mjs`, in a real browser, against main's. The deck's motion is `deck-motion.test.ts`.
 */
import { deckPresentation, type DeckPresentation } from "./deck-setting";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { inflateSync } from "node:zlib";
import type { PluginTheme } from "@getpaseo/plugin";
import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" }, View: "View", Text: "Text", ScrollView: "ScrollView", Pressable: "Pressable" }));
const rpcLoads = vi.hoisted(() => ({ count: 0 }));
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: () => () => {
    rpcLoads.count += 1;
    return Promise.reject(new Error("no daemon in the tests"));
  },
}));

import type { AgentStatus, ColumnId, FleetCard, RemoteCard } from "../shared/fleet";
import { attentionRequest, attentionSnapshot } from "../test/attention-deck-fixture";
import { deckEngineSource } from "../server/deck-settings";
import {
  browserDeckEngine,
  decodeAtlas,
  decodePack,
  drifterMasks,
  packArt,
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
  DECK_STATES,
  deckLayers,
  deckOffered,
  deckScene,
  deckState,
  departureOf,
  sailorCaption,
  sailorIdentity,
  type DeckScene,
} from "./deck-scene";
import { answeredReplies } from "./deck-replies";
import { BUBBLE_LINGER_MS, ShipDeckView, deckKeyAction, deckStatusText } from "./ship-deck";
import { focusLayout } from "./deck-camera";
import { shipFile, shipImages, shipManifest, shipStage, shipViews } from "../test/ship-pack";

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

  it("says why each card off the deck is off it, which is how a sailor that stood there leaves", () => {
    const scene = deckScene([...fixture, card("f2", "failed", { status: "closed" })], theme);
    expect(scene.departures).toEqual({ q1: "closed", d1: "done", c1: "closed", followed: "closed", f2: "failed" });
    expect(departureOf(card("d2", "done", { status: "closed" }))).toBe("done");
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

const DECK_PROPS = shipStage().props.map((prop) => ({ name: prop.id, x: prop.x, y: prop.y }));

describe("the deck's art", () => {
  const { stage } = shipManifest();
  const backdrop = stage.backdrop.sprite.rect!;
  const atlas = decodePng(readFileSync(shipFile("deck.png")));
  const opaque = (frame: readonly number[], x: number, y: number) => {
    const [fx = 0, fy = 0, fw = 0, fh = 0] = frame;
    return x >= 0 && y >= 0 && x < fw && y < fh && atlas.alpha(fx + x, fy + y) === 255;
  };

  it("is the hull the scene's coordinates are, in an atlas the manifest describes", () => {
    expect(backdrop).toEqual([0, 0, shipStage().width, shipStage().height]);
    expect([atlas.width, atlas.height]).toEqual(shipManifest().images[stage.backdrop.sprite.image]!.size);
    expect(shipStage().pieces.map((piece) => piece.id).sort()).toEqual([
      "bollard-bow-aft",
      "bollard-bow-fore",
      "bollard-gunwale-aft",
      "bollard-gunwale-fore",
      "mast",
      "near",
      "nest-rim",
    ]);
    expect(shipStage().pieces.find((piece) => piece.id === "near")?.baseline).toBeNull();
  });

  it("stands every prop on the deck", () => {
    for (const prop of DECK_PROPS) expect(opaque(backdrop, prop.x, prop.y), prop.name).toBe(true);
  });

  it("draws the hull first, the near rail last, and everything else by the row it stands on", () => {
    const at = (x: number, y: number, key: string): Figure => ({
      key,
      label: key,
      state: "working",
      stale: false,
      look: "base",
      lane: "base",
      x,
      y: y - 1,
      row: y,
      pose: "hauling",
      flip: false,
      reveal: 1,
      moving: true,
      seed: 0,
      sink: 0,
      departing: false,
      layer: "floor",
      alpha: 1,
    });
    const figures = [at(211, 111, "before-mast"), at(211, 100, "behind-mast"), at(80, 94, "behind-bollard"), at(80, 95, "before-bollard")];
    const order = deckLayers(figures, shipStage().pieces, shipStage().props).map((layer) =>
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
    expect(order).toHaveLength(1 + DECK_PROPS.length + 4 + shipStage().pieces.length);
  });

  it("fits the deck exactly at any size, its offset on whole device pixels", () => {
    const deck = { width: shipStage().width, height: shipStage().height };
    expect(fitDeck({ width: 1000, height: 800 }, deck, 1, shipStage().fit.margin).scale).toBeCloseTo((1000 / shipStage().width) * 0.96);
    expect(fitDeck({ width: 1000, height: 800 }, deck, 1.5, shipStage().fit.margin).scale).toBeCloseTo((1000 / shipStage().width) * 0.96);
    // A short pane: the height decides.
    expect(fitDeck({ width: 1000, height: 200 }, deck, 2, shipStage().fit.margin).scale).toBeCloseTo((200 / shipStage().height) * 0.96);
    const small = fitDeck({ width: 600, height: 400 }, deck, 1, shipStage().fit.margin);
    expect(small.scale).toBeCloseTo((600 / shipStage().width) * 0.96);
    expect(small.x).toBe(Math.round((600 - shipStage().width * small.scale) / 2));
    const hidpi = fitDeck({ width: 777, height: 555 }, deck, 1.25, shipStage().fit.margin);
    expect(Number.isInteger(hidpi.x * 1.25) && Number.isInteger(hidpi.y * 1.25)).toBe(true);
    expect(fitDeck({ width: 0, height: 0 }, deck, 2, shipStage().fit.margin).scale).toBe(0);
  });
});

describe("the Deck on the screen", () => {
  it("is offered in a web renderer on the wide layout, and nowhere else, with no switch to set", () => {
    expect(deckOffered("web", false)).toBe(true);
    expect(deckOffered("ios", false)).toBe(false);
    expect(deckOffered("android", false)).toBe(false);
    expect(deckOffered("web", true)).toBe(false);
  });
});

function fakeHost(width = 640, height = 300): DeckHost & { children: unknown[] } {
  const children: unknown[] = [];
  return { children, clientWidth: width, clientHeight: height, appendChild: (node: unknown) => children.push(node) };
}

interface FakeEngine extends DeckEngine {
  starts: Array<{ host: DeckHost; scene: DeckScene; size: { width: number; height: number } }>;
  drawings: Array<DeckDrawing & { updates: DeckScene[]; resizes: number[][]; focuses: Array<string | null>; destroyed: number }>;
  loads: number;
  probes: number;
  stops: number;
  resize?: (width: number, height: number) => void;
  hover?: (hover: DeckHover | null) => void;
  select?: (key: string | null, action?: "attention") => void;
  firstMate?: ((anchor: DeckHover | null) => void) | undefined;
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

function fakeEngine(options: { webgl?: "webgl2" | "webgl" | null; load?: () => Promise<StartDeck>; startFails?: Error; hold?: Promise<void>; presentation?: DeckPresentation } = {}): FakeEngine {
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
      return Promise.resolve<StartDeck>(async (host, scene, size, onHover, onSelect, onFirstMate) => {
        engine.starts.push({ host, scene, size });
        engine.hover = onHover;
        engine.select = onSelect;
        engine.firstMate = onFirstMate;
        if (options.hold !== undefined) await options.hold;
        if (options.startFails !== undefined) throw options.startFails;
        const drawing = {
          renderer: "webgl",
          ...(options.presentation === undefined ? {} : { presentation: options.presentation }),
          updates: [] as DeckScene[],
          resizes: [] as number[][],
          focuses: [] as Array<string | null>,
          destroyed: 0,
          update(next: DeckScene) {
            drawing.updates.push(next);
          },
          focus(key: string | null) {
            drawing.focuses.push(key);
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
    for (const name of ["addChild", "removeChild", "destroy", "label", "position", "scale", "rotation", "zIndex", "sortableChildren", "visible", "alpha", "tint"]) {
      expect(container.has(name), name).toBe(true);
    }
    const graphics = methods(pixi.Graphics);
    for (const name of ["clear", "rect", "circle", "ellipse", "fill", "stroke", "addChild", "destroy", "tint"]) expect(graphics.has(name), name).toBe(true);
    for (const name of ["cacheAsTexture", "updateCacheTexture"]) expect(methods(pixi.Container).has(name), name).toBe(true);
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

  it("fetches Pixi and each setting once a session, decodes every image of it, and tries again after a failure", async () => {
    let sources = 0;
    let settings = 0;
    const asked: string[] = [];
    const decoded: string[] = [];
    const good = { version: "1.2.3", source: `var PIXI = { VERSION: '1.2.3', ${FAKE_PIXI_PARTS} };` };
    const setting = { manifest: shipManifest(), images: shipImages() };
    const decode = (png: string) => {
      decoded.push(png);
      return Promise.resolve({ decoded: png });
    };
    const source = () => {
      sources += 1;
      return Promise.resolve(good);
    };
    const failing = browserDeckEngine(
      source,
      (id) => {
        settings += 1;
        asked.push(id);
        return Promise.reject(new Error("pack away"));
      },
      "mount-test",
      decode,
    );
    await expect(failing.load()).rejects.toThrow("pack away");
    const engine = browserDeckEngine(
      source,
      (id) => {
        settings += 1;
        asked.push(id);
        return Promise.resolve(setting);
      },
      "mount-test",
      decode,
    );
    const [first, second] = await Promise.all([engine.load(), engine.load()]);
    expect(typeof first).toBe("function");
    expect(typeof second).toBe("function");
    await engine.load();
    // Pixi once, kept from the failing open; the setting once more after its failure, then kept.
    expect([sources, settings]).toEqual([1, 2]);
    expect(asked).toEqual(["mount-test", "mount-test"]);
    expect(decoded).toHaveLength(Object.keys(setting.images).length);
  });

  it("decodes each image of a setting on its own, and says which did not", async () => {
    const setting = { manifest: shipManifest(), images: shipImages() };
    const { "sky-dusk": dusk, ...missing } = setting.images;
    const pack = await decodePack({ ...setting, images: missing }, (png) => (png === setting.images["sails-main-sail"] ? Promise.reject(new Error("bad png")) : Promise.resolve({ png })));
    expect(pack.images.get("deck")).toEqual({ png: setting.images.deck });
    expect([...pack.failed.keys()].sort()).toEqual(["sails-main-sail", "sky-dusk"]);
    expect(String(pack.failed.get("sky-dusk"))).toContain("sent no sky-dusk");
    expect(pack.images.size + pack.failed.size).toBe(Object.keys(setting.images).length);
    expect(dusk).toBeDefined();
  });

  it("draws what decoded: nothing without the backdrop, each part, element and extra on its own, a fallback in its place, a flat sea with neither", async () => {
    const setting = { manifest: shipManifest(), images: shipImages() };
    const cut = (image: unknown, size: readonly [number, number]) => Promise.resolve([image, size, "mask"] as const);
    const failing = (ids: readonly string[]) =>
      decodePack(setting, (png) => (ids.some((id) => setting.images[id] === png) ? Promise.reject(new Error("bad png")) : Promise.resolve({ png })));
    const warnings: string[] = [];
    const warn = (message: string) => warnings.push(message);

    const whole = await packArt(await failing([]), warn, cut);
    expect(whole.image).toEqual({ png: setting.images.deck });
    expect(whole.parts.parts.map((part) => part.id)).toEqual(["tall-mast", "topmast", "access-ladder", "sail"]);
    expect(whole.parts.pieces.map((piece) => [piece.id, piece.by])).toEqual([
      ["near", null],
      ["mast", "tall-mast"],
      ["bollard-bow-aft", null],
      ["bollard-bow-fore", null],
      ["bollard-gunwale-fore", null],
      ["bollard-gunwale-aft", null],
      ["plank", null],
      ["nest-rim", null],
    ]);
    expect(whole.effects).toEqual(shipManifest().effects);
    expect(whole.ambience.elements.map((element) => element.id)).toEqual(["sky", "overcast", "stars", "lightning", "clouds", "gull", "sea", "wake", "foam", "spindrift", "weather-serpent", "weather-kraken"]);
    expect(whole.ambience.flats).toEqual([]);
    expect(whole.masks.size).toBe(10);
    expect(warnings).toEqual([]);

    // Without a phase of it the sky is not drawn, nor what is drawn in it or under its clouds; the gull is on its own.
    // Without a frame of the sea and its still tile, the sea is a flat fill; without the wake's, no wake. Without the tall
    // mast, no topmast and no sail: the hull's own masthead in the topmast's place, its mast piece its own.
    const partial = await packArt(
      await failing(["sky-dusk", "water-sea-frame-1", "sea-water-tile", "gull-flap-strip", "water-wake-frame-0", "polish-crew-navigator", "mast-tall-mast", "plank-plank"]),
      warn,
      cut,
    );
    expect(partial.ambience.elements.map((element) => element.id)).toEqual(["foam", "spindrift", "weather-serpent", "weather-kraken"]);
    expect(partial.ambience.flats.map((element) => element.id)).toEqual(["sea"]);
    expect(partial.parts.parts.map((part) => [part.id, part.place])).toEqual([["masthead", "topmast"]]);
    expect(partial.parts.pieces.map((piece) => [piece.id, piece.by])).toEqual([
      ["near", null],
      ["mast", null],
      ["bollard-bow-aft", null],
      ["bollard-bow-fore", null],
      ["bollard-gunwale-fore", null],
      ["bollard-gunwale-aft", null],
    ]);
    const skyless = await packArt(await failing(["sky-dusk", "water-foam-frame-2"]), warn, cut);
    expect(skyless.ambience.elements.map((element) => element.id)).toEqual(["gull", "sea", "wake", "foam-still", "spindrift", "weather-serpent", "weather-kraken"]);
    // A look is the cast's: its image is the pack's, by id, and one that did not decode is not handed out.
    expect(partial.images.has("polish-crew-navigator")).toBe(false);
    expect(partial.images.has("polish-crew-bosun")).toBe(true);
    expect(partial.stage.transits.size).toBe(0);
    const without = (path: string) => `[firstmate] the deck's ${path} did not load; drawing without it:`;
    expect(warnings).toEqual([
      ...["mast/tall-mast.png", "plank/plank.png"].map(without),
      ...["gull/flap-strip.png", "sea/water-tile.png", "sky/dusk.png", "water/sea/frame-0.png", "water/sea/frame-1.png", "water/wake/frame-0.png", "polish/crew-navigator.png"].map(without),
      ...["sky/dusk.png", "water/foam/frame-2.png"].map(without),
    ]);

    await expect(packArt(await failing(["deck"]), warn, cut)).rejects.toThrow("bad png");
    await expect(packArt(await failing(["polish-crew-base"]), warn, cut)).rejects.toThrow("bad png");
    const withoutLadder = await packArt(await failing(["polish-ladder"]), warn, cut);
    expect(withoutLadder.stage.transits.size).toBe(0);
  });

  it("warns once for a missing effect image shared by keys, while retaining other decoded frames", async () => {
    const manifest = structuredClone(shipManifest());
    manifest.effects.doors = { size: [64, 64], points: { anchor: [32, 50] }, frames: { closed: { image: "shark-fin" }, open: { image: "shark-chomp" }, again: { image: "shark-fin" } } };
    const images = new Map(Object.keys(manifest.images).filter((id) => id !== "shark-fin").map((id) => [id, { image: id }]));
    const warnings: string[] = [];
    const art = await packArt({ manifest, images, failed: new Map([["shark-fin", new Error("bad png")]]) }, (message) => warnings.push(message), async () => ["a", "b", "c"]);
    expect(warnings).toEqual(["[firstmate] the deck's shark/fin.png did not load; drawing without it:"]);
    expect(art.effects.doors).toEqual(manifest.effects.doors);
    expect(art.images.has("shark-chomp")).toBe(true);
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

const viewEngine = (options: Parameters<typeof fakeEngine>[0] = {}) => fakeEngine({ presentation: deckPresentation(shipManifest()), ...options });

describe("the ship deck view", () => {
  it("opens every decision indicator through the same action, preserving the server counts and revision", async () => {
    const engine = viewEngine(), open = vi.fn();
    const snapshot = attentionSnapshot([attentionRequest("w1"), attentionRequest("unassigned", "seen")]);
    snapshot.requests[0]!.revision = 7;
    const before = structuredClone(snapshot);
    await act(async () => { renderer = create(createElement(ShipDeckView, { cards: fixture, theme, engine, needsYou: snapshot, onOpenDecision: open }), { createNodeMock: () => fakeHost() }); });
    await act(flush);
    const root = renderer!;
    expect(text(root)).toContain("Needs you · 2 · 1 new");
    expect(text(root)).toContain("1 more for you with the first mate at the wheel");
    await act(async () => engine.select?.("w1"));
    expect(open).toHaveBeenLastCalledWith({ requestId: "local:w1", homeId: snapshot.homeId, recordRevision: 7 });
    await act(async () => engine.select?.("@first-mate"));
    expect(open).toHaveBeenLastCalledWith({ requestId: "local:unassigned", homeId: snapshot.homeId, recordRevision: 1 });
    await act(async () => engine.firstMate?.({ key: "@first-mate", x: 300, top: 160, bottom: 200, width: 640, height: 300, floor: null }));
    await act(async () => root.root.findByProps({ testID: "firstmate-deck-decision-tag" }).props.onPress());
    expect(open).toHaveBeenLastCalledWith({ requestId: "local:unassigned", homeId: snapshot.homeId, recordRevision: 1 });
    await act(async () => root.root.findByProps({ accessibilityLabel: "Needs you, 2 decisions, 1 new. Open decisions" }).props.onPress());
    expect(open).toHaveBeenLastCalledWith({ requestId: "next", homeId: snapshot.homeId });
    expect(snapshot).toEqual(before); // Viewing, focus and clicking cannot acknowledge locally.
  });

  it("keeps the shared action reachable without WebGL and says unavailable instead of zero", async () => {
    const engine = viewEngine(), open = vi.fn(), snapshot = attentionSnapshot();
    snapshot.actionCount = null; snapshot.newCount = null; snapshot.freshness.status = "unknown";
    await act(async () => { renderer = create(createElement(ShipDeckView, { cards: fixture, theme, engine, os: "ios", needsYou: snapshot, onOpenDecision: open })); });
    expect(engine.probes).toBe(0);
    expect(text(renderer!)).toContain("Needs you · unavailable");
    expect(text(renderer!)).not.toContain("0 needs you");
    await act(async () => renderer!.root.findByProps({ accessibilityLabel: "Needs you, count unavailable, unavailable. FirstMate cannot confirm the backlog. The last known decisions are read-only. Open decisions" }).props.onPress());
    expect(open).toHaveBeenCalledWith({ requestId: "next", homeId: snapshot.homeId });
  });
  it("labels the server's last count as stale even when no sailor carries a gate", async () => {
    const snapshot = attentionSnapshot([]);
    snapshot.actionCount = 6;
    snapshot.freshness.status = "stale";
    await act(async () => { renderer = create(createElement(ShipDeckView, { cards: fixture, theme, engine: viewEngine(), needsYou: snapshot })); });
    expect(text(renderer!)).toContain("Needs you · 6 · stale");
    expect(text(renderer!)).not.toContain("0 needs you");
  });
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

  it("destroys and recreates the mount when only the setting id changes, clearing the old focus", async () => {
    const engine = viewEngine();
    const props = { cards: fixture, theme, engine, os: "web", renderFocus: () => createElement("FocusCard") };
    await act(async () => { renderer = create(createElement(ShipDeckView, { ...props, setting: "ship" }), { createNodeMock: () => fakeHost() }); });
    await act(flush);
    await act(async () => engine.select?.("w1"));
    expect(engine.drawings[0]!.focuses).toContain("w1");
    await act(async () => renderer!.update(createElement(ShipDeckView, { ...props, setting: "studio" })));
    await act(flush);
    expect(engine.loads).toBe(2);
    expect(engine.drawings[0]!.destroyed).toBe(1);
    expect(engine.stops).toBe(1);
    expect(engine.drawings[1]!.focuses).not.toContain("w1");
    expect(renderer!.root.findAllByProps({ testID: "firstmate-deck-focus" })).toEqual([]);
  });

  it("uses the selected pack's pane, actor and zone wording", async () => {
    const manifest = structuredClone(shipManifest());
    manifest.id = "studio";
    manifest.copy.title = "Studio";
    manifest.copy.aboard = "in the studio";
    manifest.copy.actor = { one: "maker", many: "makers" };
    manifest.copy.zones.station = "at the workbench";
    const engine = viewEngine({ presentation: deckPresentation(manifest) });
    await act(async () => { renderer = create(createElement(ShipDeckView, { cards: fixture, theme, engine, os: "web", setting: "studio" }), { createNodeMock: () => fakeHost() }); });
    await act(flush);
    expect(text(renderer!)).toContain("Studio");
    expect(text(renderer!)).toContain("8 in the studio");
    expect(text(renderer!)).not.toContain("at the workbench");
    expect(renderer!.root.findByProps({ accessibilityHint: "at the workbench" })).toBeDefined();
    expect(text(renderer!)).toContain("Point at a maker");
    expect(text(renderer!)).not.toContain("Ship deck");
  });

  it("mounts in a web renderer and draws the fixture fleet into its host view", async () => {
    const engine = viewEngine();
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
    expect(text(root)).toContain("Drawn with WebGL · 8 on deck");
    expect(text(root)).toContain("2 working | 2 waiting | 2 blocked | 2 idle");
    for (const place of ["hauling amidships", "by the helm", "in the bow", "resting below deck"]) {
      expect(text(root)).not.toContain(place);
      const attributes: Record<string, string> = {};
      root.root.findByProps({ accessibilityHint: place }).props.ref({ setAttribute: (key: string, value: string) => { attributes[key] = value; } });
      expect(attributes.title).toBe(place);
    }
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
    const engine = viewEngine();
    await act(async () => {
      renderer = create(createElement(ShipDeckView, { cards: fixture, theme, engine, os: "web", stale: true }), {
        createNodeMock: () => fakeHost(),
      });
    });
    await act(flush);
    const root = renderer!;
    expect(text(root)).toContain("The crew's feed is lost: the deck shows where everyone last stood, greyed.");
    expect(text(root)).toContain("2 idle | 8 stale");
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
    const engine = viewEngine();
    await act(async () => {
      renderer = create(createElement(ShipDeckView, { cards: fixture, theme, engine, os: "ios" }));
    });
    const root = renderer!;
    expect(text(root)).toContain("The deck draws only in the Paseo desktop app.");
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
    const engine = viewEngine({ webgl: null });
    await act(async () => {
      renderer = create(createElement(ShipDeckView, { cards: fixture, theme, engine, os: "web" }), {
        createNodeMock: () => fakeHost(),
      });
    });
    expect(text(renderer!)).toContain("This display has no WebGL, so the deck cannot draw.");
    expect(engine.loads).toBe(0);
  });

  it("labels the sailor under the pointer with who it is, over the canvas, and takes it away after", async () => {
    const engine = viewEngine();
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

    const where = { x: 300, top: 200, bottom: 260, width: 640, height: 300, floor: null };
    await act(async () => engine.hover?.({ key: "i1", ...where }));
    expect(labels()).toHaveLength(1);
    expect(words(labels()[0]!)).toBe("Task i1 | Idle · its turn ended with no status line | ariadne · This machine");
    // Above the sailor, centred on it; it never takes the pointer from the canvas.
    expect(labels()[0]!.props.style).toMatchObject({ position: "absolute", pointerEvents: "none", left: 170, width: 260, bottom: 106 });
    // Asleep in the rest area with room under the near rail: hung there, over no one.
    await act(async () => engine.hover?.({ key: "i1", ...where, height: 500, floor: 280 }));
    expect(labels()[0]!.props.style).toMatchObject({ left: 170, width: 260, top: 286 });
    expect(labels()[0]!.props.style.bottom).toBeUndefined();
    await act(async () => engine.hover?.({ key: "i1", ...where }));
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

  describe("focusing a sailor", () => {
    /** The screen's card, stood in for: its key and title, and a close button that calls back. */
    const closers: Array<() => void> = [];
    const renderFocus = (focused: FleetCard, close: () => void) => {
      closers.push(close);
      return createElement("Text", {}, `card for ${focused.key}`);
    };
    const panels = (root: ReactTestRenderer) => root.root.findAll((node) => node.props.testID === "firstmate-deck-focus" && (node.type as unknown) === "View");

    async function mounted(withCard = true) {
      const engine = viewEngine();
      await act(async () => {
        renderer = create(createElement(ShipDeckView, { cards: fixture, theme, engine, os: "web", ...(withCard ? { renderFocus } : {}) }), {
          createNodeMock: () => fakeHost(),
        });
      });
      await act(flush);
      const root = renderer!;
      const canvasHost = root.root.find((node) => node.props.accessibilityRole === "image");
      await act(async () => canvasHost.props.onLayout({ nativeEvent: { layout: { width: 900, height: 500 } } }));
      return { engine, root, drawing: engine.drawings[0]! };
    }

    it("opens the sailor's own card beside it on a click, and closes the camera in on it", async () => {
      const { engine, root, drawing } = await mounted();
      expect(panels(root)).toHaveLength(0);
      await act(async () => engine.select?.("i1"));
      expect(panels(root)).toHaveLength(1);
      expect(text(root)).toContain("card for i1");
      expect(drawing.focuses.at(-1)).toBe("i1");
      // A dialog, named for the card, placed where the camera left room for it.
      const panel = panels(root)[0]!;
      expect(panel.props.role).toBe("dialog");
      expect(panel.props["aria-label"]).toBe("Task i1: details and actions");
      expect(panel.props.style).toMatchObject({ position: "absolute", ...focusLayout({ width: 900, height: 500 }).panel });
      // No hover label while focused, even when the canvas reports one.
      await act(async () => engine.hover?.({ key: "w1", x: 300, top: 200, bottom: 260, width: 900, height: 500, floor: null }));
      expect(root.root.findAll((node) => node.props.accessibilityRole === "text")).toHaveLength(0);
      // Clicking the focused sailor keeps it; clicking another, or open deck, lets it go.
      await act(async () => engine.select?.("i1"));
      expect(panels(root)).toHaveLength(1);
      await act(async () => engine.select?.("w1"));
      expect(panels(root)).toHaveLength(0);
      expect(drawing.focuses.at(-1)).toBeNull();
      await act(async () => engine.select?.("w1"));
      await act(async () => engine.select?.(null));
      expect(panels(root)).toHaveLength(0);
      // Unfocused, hover labels are back.
      await act(async () => engine.hover?.({ key: "w1", x: 300, top: 200, bottom: 260, width: 900, height: 500, floor: null }));
      expect(root.root.findAll((node) => node.props.accessibilityRole === "text")).toHaveLength(1);
    });

    it("closes from the card's close button, and when the sailor leaves the deck", async () => {
      const { engine, root, drawing } = await mounted();
      await act(async () => engine.select?.("b1"));
      await act(async () => closers.at(-1)?.());
      expect(panels(root)).toHaveLength(0);
      expect(drawing.focuses.at(-1)).toBeNull();
      await act(async () => engine.select?.("b1"));
      expect(panels(root)).toHaveLength(1);
      // Ended: its card is off deck now, and the focus goes with it.
      await act(async () => {
        root.update(createElement(ShipDeckView, { cards: fixture.filter((each) => each.key !== "b1"), theme, engine, os: "web", renderFocus }));
      });
      expect(panels(root)).toHaveLength(0);
      expect(drawing.focuses.at(-1)).toBeNull();
    });

    it("focuses no one without a card to show, and says only how to point", async () => {
      const { engine, root, drawing } = await mounted(false);
      await act(async () => engine.select?.("i1"));
      expect(panels(root)).toHaveLength(0);
      expect(drawing.focuses.every((key) => key === null)).toBe(true);
      expect(text(root)).toContain("Point at a sailor to see who it is and what it is on.");
    });

    it("tells the pointer and the keyboard how to focus one", async () => {
      const { root } = await mounted();
      expect(root.root.findByProps({ accessibilityLabel: "Shark suggestions" })).toBeDefined();
      expect(text(root)).toContain("Point at a sailor");
      const canvasHost = root.root.find((node) => node.props.accessibilityRole === "image");
      expect(canvasHost.props.accessibilityLabel).toBe("Ship deck: 2 working, 2 waiting, 2 blocked, 2 idle. Arrow keys focus a sailor.");
      expect(canvasHost.props.focusable).toBe(true);
    });

    it("takes the arrows and Enter on the deck, Esc and Tab while a sailor is focused", async () => {
      const listeners: Array<(event: { key: string; shiftKey: boolean; preventDefault(): void }) => void> = [];
      const doc = {
        activeElement: null as unknown,
        body: {},
        addEventListener: (_type: string, listener: (typeof listeners)[number]) => listeners.push(listener),
        removeEventListener: () => undefined,
      };
      const saved = (globalThis as { document?: unknown }).document;
      (globalThis as { document?: unknown }).document = doc;
      try {
        const host = fakeHost();
        const engine = viewEngine();
        await act(async () => {
          renderer = create(createElement(ShipDeckView, { cards: fixture, theme, engine, os: "web", renderFocus }), { createNodeMock: () => host });
        });
        await act(flush);
        const root = renderer!;
        const press = async (key: string) => {
          let prevented = false;
          await act(async () => listeners.forEach((listener) => listener({ key, shiftKey: false, preventDefault: () => (prevented = true) })));
          return prevented;
        };
        // Not on the deck: the arrows are the page's.
        expect(await press("ArrowRight")).toBe(false);
        expect(panels(root)).toHaveLength(0);
        doc.activeElement = host;
        expect(await press("ArrowRight")).toBe(true);
        expect(text(root)).toContain("card for w1");
        expect(await press("ArrowRight")).toBe(true);
        expect(text(root)).toContain("card for w2");
        expect(await press("Escape")).toBe(true);
        expect(panels(root)).toHaveLength(0);
        // Enter goes back to the sailor last focused.
        expect(await press("Enter")).toBe(true);
        expect(text(root)).toContain("card for w2");
        expect(await press("ArrowLeft")).toBe(true);
        expect(text(root)).toContain("card for w1");
        await press("Escape");
        expect(await press("Escape")).toBe(false);
      } finally {
        (globalThis as { document?: unknown }).document = saved;
      }
    });
  });

  describe("replies on deck", () => {
    it("opens all suggestions in file order without focusing crew; preserves answered, retry and empty states", async () => {
      const engine = viewEngine();
      const suggestions = [{ label: "Coffee", prompt: "Make coffee." }, { label: "Discuss task-c", prompt: "Discuss task-c" }];
      const picked: unknown[] = [];
      const props = { cards: [card("b", "blocked")], theme, engine, os: "web", suggestions,
        onReply: (reply: typeof suggestions[number]) => picked.push(reply),
        renderFocus: (card: FleetCard) => createElement("FocusCard", { card }) };
      await act(async () => { renderer = create(createElement(ShipDeckView, props), { createNodeMock: () => fakeHost() }); });
      await act(flush);
      const root = renderer!;
      const popups = () => root.root.findAllByProps({ testID: "firstmate-deck-suggestions" });
      const choices = () => popups()[0]!.findAll(node => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel?.includes(": send"));
      await act(async () => {
        engine.hover?.({ key: "suggestions", action: "attention", x: 50, top: 200, bottom: 240, width: 800, height: 400, floor: null });
        engine.select?.("suggestions", "attention");
      });
      expect(engine.drawings[0]!.updates.at(-1)?.suggestionsOpen).toBe(true);
      expect(root.root.findAll(node => (node.type as unknown) === "FocusCard")).toEqual([]);
      expect(choices().map(node => node.props.accessibilityLabel.split(":")[0])).toEqual(["Coffee", "Discuss task-c"]);
      await act(async () => choices()[0]!.props.onPress());
      expect(picked).toEqual([suggestions[0]]);
      await act(async () => answeredReplies.mark(suggestions[0]!.prompt));
      expect(choices()[0]!.props.disabled).toBe(true);
      expect(choices()[1]!.props.disabled).toBe(false);
      await act(async () => answeredReplies.unmark(suggestions[0]!.prompt));
      expect(choices()[0]!.props.disabled).toBe(false);
      await act(async () => root.update(createElement(ShipDeckView, { ...props, replyBlocked: "Sending" })));
      expect(choices().every(node => node.props.disabled)).toBe(true);
      await act(async () => engine.select?.("suggestions", "attention"));
      expect(popups()).toEqual([]);
      const trigger = root.root.find(node => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "Shark suggestions");
      await act(async () => trigger.props.onPress());
      expect(popups().length).toBeGreaterThan(0);
      await act(async () => engine.select?.(null));
      expect(popups()).toEqual([]);
      await act(async () => {
        root.update(createElement(ShipDeckView, { ...props, suggestions: [], cards: [] }));
        engine.select?.("suggestions", "attention");
      });
      expect(text(root)).toContain("Nothing to suggest right now.");
      expect(engine.drawings[0]!.updates.at(-1)?.hasSuggestions).toBe(false);
      expect(engine.starts).toHaveLength(1);
    });
    /** One suggestion names b1's crewmate by its agent id; the other names no one. */
    const land = { label: "Land b1", prompt: "Merge agent-b1's branch, captain's word." };
    const coffee = { label: "Coffee", prompt: "Make coffee." };
    const bubbles = (root: ReactTestRenderer) => root.root.findAll((node) => node.props.testID === "firstmate-deck-bubble" && typeof node.props.onPointerEnter === "function");
    const chips = (root: ReactTestRenderer) =>
      bubbles(root)[0]?.findAll((node) => node.props.accessibilityRole === "button" && typeof node.props.onPress === "function") ?? [];
    const where = { x: 300, top: 200, bottom: 260, width: 900, height: 500, floor: null };
    afterEach(() => answeredReplies.keepOnly([]));

    async function mounted(options: { replyBlocked?: string | null } = {}) {
      const engine = viewEngine({ presentation: { ...deckPresentation(shipManifest()), attentionCarrier: false } });
      const picked: Array<{ label: string; prompt: string }> = [];
      const focusReplies: unknown[] = [];
      const props = {
        cards: fixture,
        theme,
        engine,
        os: "web",
        suggestions: [coffee, land],
        onReply: (reply: { label: string; prompt: string }) => picked.push(reply),
        replyBlocked: options.replyBlocked ?? null,
        renderFocus: (focused: FleetCard, _close: () => void, replies: unknown) => {
          focusReplies.push(replies);
          return createElement("Text", {}, `card for ${focused.key}`);
        },
      };
      await act(async () => {
        renderer = create(createElement(ShipDeckView, props), { createNodeMock: () => fakeHost() });
      });
      await act(flush);
      const root = renderer!;
      const canvasHost = root.root.find((node) => node.props.accessibilityRole === "image");
      await act(async () => canvasHost.props.onLayout({ nativeEvent: { layout: { width: 900, height: 500 } } }));
      return { engine, root, picked, focusReplies };
    }

    it("marks the sailor a suggestion names, and says so in the legend and to a screen reader", async () => {
      const { engine, root } = await mounted();
      const scene = engine.drawings[0]!.updates.at(-1) ?? engine.starts[0]!.scene;
      expect(scene.sailors.filter((sailor) => sailor.asks === true).map((sailor) => sailor.key)).toEqual(["b1"]);
      expect(text(root)).toContain("1 with a reply for you");
      const canvasHost = root.root.find((node) => node.props.accessibilityRole === "image");
      expect(canvasHost.props.accessibilityLabel).toContain("1 with a reply for you to pick");
    });

    it("speaks in a bubble on hover instead of the label, its chips sending through the board's own send", async () => {
      const { engine, root, picked } = await mounted();
      await act(async () => engine.hover?.({ key: "b1", ...where }));
      expect(bubbles(root)).toHaveLength(1);
      expect(root.root.findAll((node) => node.props.accessibilityRole === "text")).toHaveLength(0);
      expect(text(root)).toContain("Task b1");
      expect(chips(root).map((chip) => chip.props.accessibilityLabel)).toEqual([`Land b1: send "${land.prompt}" to the first mate`]);
      // Over the sailor, by its bottom, inside the canvas.
      expect(bubbles(root)[0]!.props.style).toMatchObject({ position: "absolute", bottom: 500 - 200 + 8 });
      await act(async () => chips(root)[0]!.props.onPress());
      expect(picked).toEqual([land]);
      // Another sailor under the pointer: its own label, and the bubble comes down.
      await act(async () => engine.hover?.({ key: "w1", ...where }));
      expect(bubbles(root)).toHaveLength(0);
      expect(root.root.findAll((node) => node.props.accessibilityRole === "text")).toHaveLength(1);
    });

    it("lingers while the pointer crosses to its chips, and stays while it is over them", async () => {
      const { engine, root } = await mounted();
      await act(async () => engine.hover?.({ key: "b1", ...where }));
      await act(async () => engine.hover?.(null));
      expect(bubbles(root)).toHaveLength(1);
      await act(async () => bubbles(root)[0]!.props.onPointerEnter());
      await act(() => new Promise((resolve) => setTimeout(resolve, BUBBLE_LINGER_MS + 50)));
      expect(bubbles(root)).toHaveLength(1);
      await act(async () => bubbles(root)[0]!.props.onPointerLeave());
      await act(() => new Promise((resolve) => setTimeout(resolve, BUBBLE_LINGER_MS + 50)));
      expect(bubbles(root)).toHaveLength(0);
    });

    it("clears the marker and the bubble once a reply is picked, and offers it again if the send fails", async () => {
      const { engine, root } = await mounted();
      await act(async () => engine.hover?.({ key: "b1", ...where }));
      await act(async () => answeredReplies.mark(land.prompt));
      expect(bubbles(root)).toHaveLength(0);
      expect(engine.drawings[0]!.updates.at(-1)!.sailors.some((sailor) => sailor.asks === true)).toBe(false);
      expect(text(root)).not.toContain("with a reply for you");
      await act(async () => answeredReplies.unmark(land.prompt));
      expect(engine.drawings[0]!.updates.at(-1)!.sailors.find((sailor) => sailor.key === "b1")?.asks).toBe(true);
    });

    it("lets go of a bubble answered under the pointer, so it never comes back without one", async () => {
      const { engine, root } = await mounted();
      await act(async () => engine.hover?.({ key: "b1", ...where }));
      await act(async () => bubbles(root)[0]!.props.onPointerEnter());
      await act(async () => engine.hover?.(null));
      // The chip is pressed: the bubble goes with the pointer still on it, so no leave is heard.
      await act(async () => answeredReplies.mark(land.prompt));
      expect(bubbles(root)).toHaveLength(0);
      await act(async () => answeredReplies.unmark(land.prompt));
      expect(bubbles(root)).toHaveLength(0);
    });

    it("disables its chips and says why while a reply cannot go", async () => {
      const { engine, root, picked } = await mounted({ replyBlocked: "A message to the first mate is on its way; wait for it to go." });
      await act(async () => engine.hover?.({ key: "b1", ...where }));
      expect(chips(root).map((chip) => [chip.props.disabled, chip.props.accessibilityHint])).toEqual([
        [true, "A message to the first mate is on its way; wait for it to go."],
      ]);
      expect(text(root)).toContain("on its way");
      expect(picked).toHaveLength(0);
    });

    it("focused, speaks over the sailor where the canvas reports it and hands its card the same replies", async () => {
      const { engine, root, focusReplies } = await mounted();
      await act(async () => engine.select?.("b1"));
      expect(focusReplies.at(-1)).not.toBeNull();
      // The canvas reports where the focused sailor stands: the bubble hangs there, inside the panel's room.
      await act(async () => engine.hover?.({ key: "b1", ...where, x: 290 }));
      expect(bubbles(root)).toHaveLength(1);
      const style = bubbles(root)[0]!.props.style as { left: number; width: number };
      const panel = focusLayout({ width: 900, height: 500 }).panel as { left: number };
      expect(style.left + style.width).toBeLessThanOrEqual(panel.left);
      await act(async () => engine.select?.(null));
      await act(async () => engine.select?.("w1"));
      expect(focusReplies.at(-1)).toBeNull();
      expect(bubbles(root)).toHaveLength(0);
    });

    it("offers nothing without a way to send", async () => {
      const engine = viewEngine();
      await act(async () => {
        renderer = create(createElement(ShipDeckView, { cards: fixture, theme, engine, os: "web", suggestions: [land] }), { createNodeMock: () => fakeHost() });
      });
      await act(flush);
      expect(engine.starts[0]!.scene.sailors.some((sailor) => sailor.asks === true)).toBe(false);
    });
  });

  it("maps each key to what it does on the deck", () => {
    expect(deckKeyAction("Escape", { focused: true, onCanvas: false })).toBe("close");
    expect(deckKeyAction("Escape", { focused: false, onCanvas: true })).toBeNull();
    expect(deckKeyAction("Tab", { focused: true, onCanvas: false })).toBe("trap");
    expect(deckKeyAction("Tab", { focused: false, onCanvas: true })).toBeNull();
    expect(deckKeyAction("ArrowRight", { focused: false, onCanvas: true })).toBe("next");
    expect(deckKeyAction("ArrowDown", { focused: true, onCanvas: true })).toBe("next");
    expect(deckKeyAction("ArrowLeft", { focused: false, onCanvas: true })).toBe("previous");
    expect(deckKeyAction("ArrowUp", { focused: false, onCanvas: true })).toBe("previous");
    expect(deckKeyAction("ArrowRight", { focused: true, onCanvas: false })).toBeNull();
    expect(deckKeyAction("Enter", { focused: false, onCanvas: true })).toBe("open");
    expect(deckKeyAction(" ", { focused: false, onCanvas: true })).toBe("open");
    expect(deckKeyAction("Enter", { focused: true, onCanvas: true })).toBeNull();
    expect(deckKeyAction("a", { focused: false, onCanvas: true })).toBeNull();
  });

  it("says where each state stands in the ship pack's own words", () => {
    const { copy, zones } = shipManifest();
    for (const state of DECK_STATES) expect(deckPresentation(shipManifest()).places[state], state).toBe(copy.zones[zones.byState[state]]);
  });

  it("words every status", () => {
    expect(deckStatusText({ kind: "drawing", renderer: "webgl" })).toBeNull();
    expect(deckStatusText({ kind: "starting" }, deckPresentation(shipManifest()))).toBe("Raising the deck…");
    expect(deckStatusText({ kind: "failed", message: "boom" }, deckPresentation(shipManifest()))).toBe("The ship deck could not start: boom");
    expect(deckStatusText({ kind: "unsupported", reason: "no-host" })).toContain("desktop app");
  });
});

describe("the drifters, cut into their masks", () => {
  it("cuts every cloud and thunderhead that decoded, by its own palette, and leaves out one that did not or will not cut", async () => {
    const images = new Map(Object.keys(shipManifest().images).map((id) => [id, { image: id }]));
    const cut = (image: unknown, size: readonly [number, number], palette?: readonly string[]) => Promise.resolve([image, size, palette?.[0] ?? "mask"] as const);
    const clouds = shipManifest().ambience.find((element) => element.id === "clouds")!.behaviour;
    if (clouds.kind !== "drifters") throw new Error("the clouds drift");
    const all = await drifterMasks({ manifest: shipManifest(), images }, cut);
    // Each cloud from its own decoded image, at its size; each thunderhead by its own palette.
    expect([...all.keys()]).toEqual([...clouds.sprites.map((sprite) => sprite.image), ...clouds.sprites.map((sprite) => sprite.variants![0]!.frames[0]!.image)]);
    expect(all.get("clouds-puff")).toEqual([{ image: "clouds-puff" }, [36, 14], "#A8B9BD"]);
    expect(all.get("storm-clouds-puff")).toEqual([{ image: "storm-clouds-puff" }, [36, 14], "#1D314E"]);
    const failed: string[] = [];
    const some = await drifterMasks(
      { manifest: shipManifest(), images: new Map([...images].filter(([id]) => id !== "clouds-wisp")) },
      (image, size) => (size[0] === 62 ? Promise.reject(new Error("no canvas")) : cut(image, size)),
      (id) => failed.push(id),
    );
    // One that did not arrive is not cut; one that would not cut is said.
    expect(failed).toEqual(["clouds-cumulus", "storm-clouds-cumulus"]);
    expect([...some.keys()]).toEqual(["clouds-puff", "clouds-long-bank", "clouds-twin-bank", "storm-clouds-wisp", "storm-clouds-puff", "storm-clouds-long-bank", "storm-clouds-twin-bank"]);
  });
});
