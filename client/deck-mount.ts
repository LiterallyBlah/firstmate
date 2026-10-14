/**
 * Puts the ship deck's canvas into a React Native Web view, or says why it cannot. Web-only.
 *
 * **The escape hatch.** On the web, react-native-web renders a `View` as a `<div>` and hands its `ref`
 * the DOM element itself. The deck's view is a childless `View`, so React owns the `<div>` and nothing
 * inside it, and Pixi's `<canvas>` is appended to it by hand — no DOM JSX in the tree, no host module a
 * plugin may not import. On native the same ref is a native view with no `appendChild`, so the deck says
 * it draws only in the desktop app and never loads Pixi.
 *
 * Like `client/web.ts`, every browser global here is declared in the narrow shape it is used in, so
 * `client/` still typechecks without the DOM library.
 *
 * **Pixi arrives from the daemon.** It is not in the client bundle (`client/deck-pixi.ts` says why):
 * once the host and WebGL have both been found, `firstmate.deck.engine` sends its browser build as text
 * and `evaluatePixi` runs it with `new Function` — the same permission the app itself uses to evaluate
 * every plugin bundle, `globalThis.eval` — keeping its names out of the page's globals. **So does the
 * art**, alongside it: `firstmate.deck.art` sends the atlas as base64, and `decodeAtlas` turns it into
 * an image the browser has decoded. Both are fetched once per app session and kept; a renderer without
 * a host or WebGL never asks for either.
 *
 * Every way it can fail ends in a status, never a throw: no host, no WebGL, Pixi or the art failing to
 * load, Pixi failing to start. A mount torn down while Pixi is still starting destroys what starts.
 */
import type { DeckArt, DeckEngineSource } from "../shared/ship-deck";
import { startDeck, type DeckArtImage, type PixiModule } from "./deck-pixi";
import type { DeckScene } from "./deck-scene";

export type DeckStatus =
  | { kind: "starting" }
  | { kind: "drawing"; renderer: string }
  | { kind: "unsupported"; reason: "native" | "no-host" | "no-webgl" }
  | { kind: "failed"; message: string };

/** What the deck needs of the view's DOM element. */
export interface DeckHost {
  appendChild(node: unknown): unknown;
  clientWidth: number;
  clientHeight: number;
}

/** A started deck. */
export interface DeckDrawing {
  /** Pixi's renderer: `webgl`, or whatever it fell back to. */
  readonly renderer: string;
  update(scene: DeckScene): void;
  resize(width: number, height: number): void;
  destroy(): void;
}

export type StartDeck = (host: DeckHost, scene: DeckScene, size: { width: number; height: number }) => Promise<DeckDrawing>;

/** Everything the mount does that touches the browser or Pixi, so the tests can stand in for it. */
export interface DeckEngine {
  /** The WebGL version this renderer offers, or null when it has none. */
  probe(): "webgl2" | "webgl" | null;
  load(): Promise<StartDeck>;
  /** Calls `onSize` whenever the host's size changes; returns the way to stop. */
  observeSize(host: DeckHost, onSize: (width: number, height: number) => void): () => void;
}

export interface DeckMount {
  update(scene: DeckScene): void;
  destroy(): void;
}

export function isDeckHost(node: unknown): node is DeckHost {
  return (
    typeof node === "object" &&
    node !== null &&
    typeof Reflect.get(node, "appendChild") === "function" &&
    typeof Reflect.get(node, "clientWidth") === "number" &&
    typeof Reflect.get(node, "clientHeight") === "number"
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Starts the deck in `node` and reports how it goes through `onStatus`. The returned mount takes newer
 * scenes — kept until Pixi is up, then drawn — and tears everything down.
 */
export function mountDeck(
  node: unknown,
  scene: DeckScene,
  engine: DeckEngine,
  onStatus: (status: DeckStatus) => void,
): DeckMount {
  const idle: DeckMount = { update() {}, destroy() {} };
  if (!isDeckHost(node)) {
    onStatus({ kind: "unsupported", reason: "no-host" });
    return idle;
  }
  let webgl: "webgl2" | "webgl" | null;
  try {
    webgl = engine.probe();
  } catch {
    webgl = null;
  }
  if (webgl === null) {
    onStatus({ kind: "unsupported", reason: "no-webgl" });
    return idle;
  }

  const host = node;
  let latest = scene;
  let drawing: DeckDrawing | null = null;
  let stopObserving: (() => void) | null = null;
  let gone = false;
  onStatus({ kind: "starting" });

  engine
    .load()
    .then(function (start) {
      if (gone) return null;
      const drawn = latest;
      return start(host, drawn, { width: host.clientWidth, height: host.clientHeight }).then(function (started) {
        return { started, drawn };
      });
    })
    .then(function (result) {
      if (result === null) return;
      const { started, drawn } = result;
      if (gone) {
        started.destroy();
        return;
      }
      drawing = started;
      if (latest !== drawn) started.update(latest);
      stopObserving = engine.observeSize(host, function (width, height) {
        drawing?.resize(width, height);
      });
      onStatus({ kind: "drawing", renderer: started.renderer });
    })
    .catch(function (error: unknown) {
      if (!gone) onStatus({ kind: "failed", message: message(error) });
    });

  return {
    update(next) {
      latest = next;
      drawing?.update(next);
    },
    destroy() {
      gone = true;
      stopObserving?.();
      stopObserving = null;
      try {
        drawing?.destroy();
      } catch (error) {
        console.warn("[firstmate] the ship deck did not tear down cleanly:", error);
      }
      drawing = null;
    },
  };
}

interface WebGLProbeCanvas {
  getContext(kind: string, options?: Record<string, unknown>): {
    getExtension(name: string): { loseContext(): void } | null;
  } | null;
}

interface ResizeObserverLike {
  observe(target: unknown): void;
  disconnect(): void;
}

type WebGlobals = {
  document?: { createElement?: (tag: string) => unknown };
  ResizeObserver?: new (callback: () => void) => ResizeObserverLike;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

/** Asks a throwaway canvas for a WebGL context, then gives the context straight back. */
export function probeWebGL(web: WebGlobals = globalThis as WebGlobals): "webgl2" | "webgl" | null {
  const canvas = web.document?.createElement?.("canvas") as WebGLProbeCanvas | undefined;
  if (canvas === undefined || typeof canvas.getContext !== "function") return null;
  for (const kind of ["webgl2", "webgl"] as const) {
    const context = canvas.getContext(kind);
    if (context !== null && context !== undefined) {
      // Browsers cap live WebGL contexts; this one only answered a question.
      context.getExtension("WEBGL_lose_context")?.loseContext();
      return kind;
    }
  }
  return null;
}

function observeHostSize(host: DeckHost, onSize: (width: number, height: number) => void): () => void {
  const web = globalThis as WebGlobals;
  const report = () => onSize(host.clientWidth, host.clientHeight);
  if (typeof web.ResizeObserver === "function") {
    const observer = new web.ResizeObserver(report);
    observer.observe(host);
    return () => observer.disconnect();
  }
  web.addEventListener?.("resize", report);
  return () => web.removeEventListener?.("resize", report);
}

/**
 * Runs Pixi's browser build and hands back its namespace, checked for what the deck uses and for the
 * version the daemon said it sent. The build declares `var PIXI`; inside a function it stays local.
 */
export function evaluatePixi(engine: DeckEngineSource): PixiModule {
  const run = new Function(`${engine.source}
;return typeof PIXI === "undefined" ? undefined : PIXI;`) as () => unknown;
  const pixi = run();
  if (typeof pixi !== "object" || pixi === null) throw new Error("the Pixi build defined no PIXI namespace");
  for (const name of ["Application", "Container", "Graphics", "Sprite", "ImageSource", "Texture", "Rectangle"]) {
    if (typeof Reflect.get(pixi, name) !== "function") throw new Error(`the Pixi build has no ${name}`);
  }
  const version: unknown = Reflect.get(pixi, "VERSION");
  if (version !== engine.version) throw new Error(`the Pixi build says ${String(version)}, not ${engine.version}`);
  return pixi as PixiModule;
}

interface DecodableImage {
  src: string;
  decode(): Promise<void>;
}

/** The atlas as an image the browser has decoded, ready to be a texture. */
export function decodeAtlas(png: string, web: { Image?: new () => DecodableImage } = globalThis as { Image?: new () => DecodableImage }): Promise<unknown> {
  if (typeof web.Image !== "function") return Promise.reject(new Error("this renderer cannot decode images"));
  const image = new web.Image();
  image.src = `data:image/png;base64,${png}`;
  return image.decode().then(function () {
    return image;
  });
}

/** Pixi and the art for this app session: fetched once, kept; a failure is not kept, so reopening the deck tries again. */
let engineOnce: Promise<{ pixi: PixiModule; art: DeckArtImage }> | null = null;

/** The real thing: the browser's WebGL, and Pixi and the art fetched from the daemon on first use. */
export function browserDeckEngine(
  loadSource: () => Promise<DeckEngineSource>,
  loadArt: () => Promise<DeckArt>,
  decode: (png: string) => Promise<unknown> = decodeAtlas,
): DeckEngine {
  return {
    probe: () => probeWebGL(),
    load() {
      engineOnce ??= Promise.all([
        loadSource().then(evaluatePixi),
        loadArt().then(function (art) {
          return decode(art.png).then(function (image): DeckArtImage {
            return { image, manifest: art.manifest };
          });
        }),
      ])
        .then(function ([pixi, art]) {
          return { pixi, art };
        })
        .catch(function (error: unknown) {
          engineOnce = null;
          throw error;
        });
      return engineOnce.then(function ({ pixi, art }): StartDeck {
        return function (host, scene, size) {
          return startDeck(pixi, art, host, scene, size);
        };
      });
    },
    observeSize: observeHostSize,
  };
}
