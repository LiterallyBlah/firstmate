/**
 * The ship deck, behind FIRSTMATE_SHIP_DECK: the scene from a fixture fleet, the mount's every way to
 * start or not, the vendored Pixi build evaluated as the client evaluates it, and the view mounted
 * through react-test-renderer with WebGL stood in for. Whether a real WebGL canvas paints is
 * `docs/ship-deck-canvas/render.mjs`, in a real browser.
 */
import { readFileSync } from "node:fs";
import { URL } from "node:url";
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
import { deckEngineSource } from "../server/ship-deck";
import {
  browserDeckEngine,
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
import { DECK_ZONES, deckOffered, deckScene, deckState, zoneSlots, type DeckScene } from "./deck-scene";
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

  it("draws one sailor per live crewmate from a fixture fleet, inside its zone", () => {
    const scene = deckScene(fixture, theme);
    expect(scene.counts).toEqual({ working: 2, waiting: 2, blocked: 2, idle: 2 });
    expect(scene.sailors.map((s) => s.key)).toEqual(["w1", "w2", "r1", "w3", "b1", "f1", "i1", "p1"]);
    for (const sailor of scene.sailors) {
      const zone = DECK_ZONES[sailor.state];
      expect(sailor.x).toBeGreaterThanOrEqual(zone.x);
      expect(sailor.x).toBeLessThanOrEqual(zone.x + zone.width);
      expect(sailor.y).toBeGreaterThanOrEqual(zone.y);
      expect(sailor.y).toBeLessThanOrEqual(zone.y + zone.height);
    }
    expect(new Set(scene.sailors.map((s) => `${s.x},${s.y}`)).size).toBe(scene.sailors.length);
    expect(scene.palette.states).toEqual({ working: "#6cb17b", waiting: "#c09664", blocked: "#d8847b", idle: "#A1A5A4" });
  });

  it("is the same deck for the same crew in any order", () => {
    expect(deckScene([...fixture].reverse(), theme)).toEqual(deckScene(fixture, theme));
  });

  it("squeezes a crowded zone rather than spilling out of it", () => {
    const slots = zoneSlots(DECK_ZONES.blocked, 40);
    expect(new Set(slots.map((s) => `${s.x},${s.y}`)).size).toBe(40);
    for (const slot of slots) {
      expect(slot.x).toBeGreaterThanOrEqual(DECK_ZONES.blocked.x);
      expect(slot.x).toBeLessThanOrEqual(DECK_ZONES.blocked.x + DECK_ZONES.blocked.width);
      expect(slot.y).toBeLessThanOrEqual(DECK_ZONES.blocked.y + DECK_ZONES.blocked.height);
    }
    expect(zoneSlots(DECK_ZONES.idle, 0)).toEqual([]);
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
      return Promise.resolve<StartDeck>(async (host, scene, size) => {
        engine.starts.push({ host, scene, size });
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
    for (const name of ["addChild", "addChildAt", "removeChild", "destroy", "label", "position", "scale"]) expect(container.has(name), name).toBe(true);
    const graphics = methods(pixi.Graphics);
    for (const name of ["poly", "rect", "circle", "moveTo", "lineTo", "fill", "stroke", "addChild", "destroy"]) expect(graphics.has(name), name).toBe(true);
  });

  it("refuses a build that is not the Pixi it claims to be", () => {
    const stub = (body: string) => ({ version: "8.22.0", source: body });
    expect(() => evaluatePixi(stub("var NOT_PIXI = {};"))).toThrow("no PIXI namespace");
    expect(() => evaluatePixi(stub("var PIXI = { VERSION: '8.22.0', Application() {}, Container() {} };"))).toThrow("no Graphics");
    expect(() => evaluatePixi(stub("var PIXI = { VERSION: '7.0.0', Application() {}, Container() {}, Graphics() {} };"))).toThrow(
      "says 7.0.0, not 8.22.0",
    );
  });

  it("fetches and evaluates Pixi once a session, and tries again after a failure", async () => {
    let calls = 0;
    const good = { version: "1.2.3", source: "var PIXI = { VERSION: '1.2.3', Application() {}, Container() {}, Graphics() {} };" };
    const failing = browserDeckEngine(() => {
      calls += 1;
      return Promise.reject(new Error("daemon away"));
    });
    await expect(failing.load()).rejects.toThrow("daemon away");
    const engine = browserDeckEngine(() => {
      calls += 1;
      return Promise.resolve(good);
    });
    const [first, second] = await Promise.all([engine.load(), engine.load()]);
    expect(typeof first).toBe("function");
    expect(typeof second).toBe("function");
    await engine.load();
    expect(calls).toBe(2);
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
    expect(text(root)).toContain("2 working | 2 waiting | 2 blocked | 2 idle");
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

  it("words every status", () => {
    expect(deckStatusText({ kind: "drawing", renderer: "webgl" })).toBeNull();
    expect(deckStatusText({ kind: "starting" })).toBe("Raising the deck…");
    expect(deckStatusText({ kind: "failed", message: "boom" })).toBe("The ship deck could not start: boom");
    expect(deckStatusText({ kind: "unsupported", reason: "no-host" })).toContain("desktop app");
  });
});
