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
 * a host or WebGL never asks for either. **The generated sea, sky and gull** come the same way, from
 * `firstmate.deck.environment`, but are not needed to draw: when they fail to load the deck draws its
 * ship and crew on a flat sea, says so in the console, and asks again the next time it is opened. **The
 * sail and the crew's extra looks** likewise, from `firstmate.deck.extras`, image by image: whatever
 * decodes is drawn, whatever does not is left out with a warning — a bare mast, or fewer looks to go round.
 * The sky's clouds are among them; each is also cut into three white masks to be tinted (`cutCloudMasks`),
 * and one that cannot be is left out the same way.
 *
 * **Motion is the browser's too.** `browserMotion` hands the deck `requestAnimationFrame`, the
 * `prefers-reduced-motion` query and `document.hidden`, so `client/deck-loop.ts` can cap, pause and still it;
 * and the local clock with a timer, so the sky follows the time of day.
 *
 * Every way it can fail ends in a status, never a throw: no host, no WebGL, Pixi or the art failing to
 * load, Pixi failing to start. A mount torn down while Pixi is still starting destroys what starts.
 */
import { environmentImagePaths, extrasImagePaths, type DeckArt, type DeckEngineSource, type DeckEnvironment, type DeckExtras } from "../shared/ship-deck";
import { cloudSlotMasks } from "./deck-clouds";
import type { DeckEnvironmentImages } from "./deck-environment";
import type { DeckExtrasImages } from "./deck-extras";
import type { DeckHover } from "./deck-hover";
import type { FrameScheduler, MotionSignals } from "./deck-loop";
import { startDeck, type DeckArtImage, type DeckMotionEnvironment, type PixiModule } from "./deck-pixi";
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
  /** Closes the camera in on the sailor with this key, or pulls it back to the whole deck for null. */
  focus(key: string | null): void;
  resize(width: number, height: number): void;
  destroy(): void;
}

export type StartDeck = (
  host: DeckHost,
  scene: DeckScene,
  size: { width: number; height: number },
  onHover: (hover: DeckHover | null) => void,
  onSelect: (key: string | null) => void,
) => Promise<DeckDrawing>;

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
  /** The sailor the camera should focus, or null; kept until Pixi is up, like the scene. */
  focus(key: string | null): void;
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
 * Starts the deck in `node` and reports how it goes through `onStatus`, which sailor the pointer is
 * over through `onHover`, and which a click landed on through `onSelect`. The returned mount takes newer
 * scenes and the sailor to focus — kept until Pixi is up, then drawn — and tears everything down.
 */
export function mountDeck(
  node: unknown,
  scene: DeckScene,
  engine: DeckEngine,
  onStatus: (status: DeckStatus) => void,
  onHover: (hover: DeckHover | null) => void = function () {},
  onSelect: (key: string | null) => void = function () {},
): DeckMount {
  const idle: DeckMount = { update() {}, focus() {}, destroy() {} };
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
  let focused: string | null = null;
  let drawing: DeckDrawing | null = null;
  let stopObserving: (() => void) | null = null;
  let gone = false;
  onStatus({ kind: "starting" });

  engine
    .load()
    .then(function (start) {
      if (gone) return null;
      const drawn = latest;
      return start(
        host,
        drawn,
        { width: host.clientWidth, height: host.clientHeight },
        function (hover) {
          if (!gone) onHover(hover);
        },
        function (key) {
          if (!gone) onSelect(key);
        },
      ).then(function (started) {
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
      if (focused !== null) started.focus(focused);
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
    focus(key) {
      focused = key;
      drawing?.focus(key);
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

interface MediaQueryLike {
  matches: boolean;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
}

type MotionGlobals = {
  requestAnimationFrame?: (callback: (nowMs: number) => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
  setTimeout?: (callback: () => void, ms: number) => number;
  clearTimeout?: (handle: number) => void;
  setInterval?: (callback: () => void, ms: number) => number;
  clearInterval?: (handle: number) => void;
  performance?: { now(): number };
  matchMedia?: (query: string) => MediaQueryLike;
  document?: {
    hidden?: boolean;
    addEventListener?: (type: "visibilitychange", listener: () => void) => void;
    removeEventListener?: (type: "visibilitychange", listener: () => void) => void;
  };
};

/**
 * The browser's frames and motion signals: `requestAnimationFrame` (which the browser itself throttles in
 * a background tab), `prefers-reduced-motion`, and `document.hidden` with its `visibilitychange`; the
 * local clock, and `setInterval` for the still deck's sky (none where there is no timer).
 */
export function browserMotion(web: MotionGlobals = globalThis as MotionGlobals): DeckMotionEnvironment {
  const scheduler: FrameScheduler =
    typeof web.requestAnimationFrame === "function" && typeof web.cancelAnimationFrame === "function"
      ? { request: (callback) => web.requestAnimationFrame!(callback), cancel: (handle) => web.cancelAnimationFrame!(handle) }
      : {
          request: (callback) => web.setTimeout?.(() => callback(web.performance?.now() ?? Date.now()), 33) ?? 0,
          cancel: (handle) => web.clearTimeout?.(handle),
        };
  let query: MediaQueryLike | null = null;
  try {
    query = web.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
  } catch {
    query = null;
  }
  const signals: MotionSignals = {
    reducedMotion: () => query?.matches === true,
    documentHidden: () => web.document?.hidden === true,
    subscribe(onChange) {
      query?.addEventListener?.("change", onChange);
      web.document?.addEventListener?.("visibilitychange", onChange);
      return function () {
        query?.removeEventListener?.("change", onChange);
        web.document?.removeEventListener?.("visibilitychange", onChange);
      };
    },
  };
  return {
    scheduler,
    signals,
    clock: () => new Date(),
    every(ms, run) {
      if (typeof web.setInterval !== "function") return function () {};
      const handle = web.setInterval(run, ms);
      return function () {
        web.clearInterval?.(handle);
      };
    },
  };
}

/**
 * The environment with every image it names decoded; refused when one is missing or will not decode.
 * `browserDeckEngine` turns a refusal into no environment, so the deck draws without it rather than not at all.
 */
export function decodeEnvironment(environment: DeckEnvironment, decode: (png: string) => Promise<unknown>): Promise<DeckEnvironmentImages> {
  const paths = environmentImagePaths(environment.manifest);
  return Promise.all(
    paths.map(function (path) {
      const png = environment.images[path];
      if (png === undefined) return Promise.reject(new Error(`the environment has no ${path}`));
      return decode(png).then((image) => [path, image] as const);
    }),
  ).then(function (decoded) {
    return { manifest: environment.manifest, images: new Map(decoded) };
  });
}

/**
 * The extras with every image that decodes; one that is missing or will not decode is left out, and
 * `onMissing` hears which. Never refused: the deck draws whatever arrived (`client/deck-extras.ts`).
 */
export function decodeExtras(
  extras: DeckExtras,
  decode: (png: string) => Promise<unknown>,
  onMissing: (path: string, error: unknown) => void = function () {},
  cutCloud: CutCloud = cutCloudMasks,
): Promise<DeckExtrasImages> {
  return Promise.all(
    extrasImagePaths(extras.manifest).map(function (path) {
      const png = extras.images[path];
      const decoded = png === undefined ? Promise.reject(new Error(`the extras have no ${path}`)) : decode(png);
      return decoded.then(
        (image) => [path, image] as const,
        function (error: unknown) {
          onMissing(path, error);
          return null;
        },
      );
    }),
  ).then(function (decoded) {
    const images = new Map(decoded.filter((entry) => entry !== null));
    // Each cloud that decoded, cut into its three slot masks; one that will not cut is left out like a missing image.
    // A cloud's variant likewise (`client/deck-variants.ts`), by its own palette, only where there are clouds to lay it over.
    const clouds = extras.manifest.clouds;
    const variants = clouds === undefined ? [] : (extras.manifest.variants ?? []).filter((variant) => variant.variantOf.startsWith("cloud:"));
    const sprites = [
      ...(clouds?.sprites ?? []).map((sprite) => ({ texture: sprite.texture, size: sprite.size, palette: clouds!.palette })),
      ...variants.map((variant) => ({ texture: variant.frames[0]!, size: variant.frameSize, palette: variant.palette ?? clouds!.palette })),
    ].filter((sprite) => images.has(sprite.texture));
    return Promise.all(
      sprites.map((sprite) =>
        Promise.resolve()
          .then(() => cutCloud(images.get(sprite.texture), sprite.size, sprite.palette))
          .then(
            (masks) => [sprite.texture, masks] as const,
            function (error: unknown) {
              onMissing(sprite.texture, error);
              return null;
            },
          ),
      ),
    ).then(function (cut) {
      return { manifest: extras.manifest, images, cloudMasks: new Map(cut.filter((entry) => entry !== null)) };
    });
  });
}

/** Cuts a decoded cloud of `size` into one white mask per slot of `palette`, each an image Pixi can draw. */
export type CutCloud = (image: unknown, size: readonly [number, number], palette: readonly string[]) => Promise<readonly [unknown, unknown, unknown]>;

interface PixelCanvas {
  width: number;
  height: number;
  getContext(
    kind: "2d",
    options?: { willReadFrequently?: boolean },
  ): { drawImage(image: unknown, x: number, y: number): void; getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray } } | null;
}

type PixelGlobals = {
  document?: { createElement?: (tag: string) => unknown };
  ImageData?: new (data: Uint8ClampedArray, width: number, height: number) => unknown;
  createImageBitmap?: (data: unknown) => Promise<unknown>;
};

/**
 * The browser's way: the cloud drawn on a scratch canvas, its pixels read back and cut (`cloudSlotMasks`), and
 * each mask made an `ImageBitmap`. Refused where the renderer has no canvas or bitmaps; the sky then has no clouds.
 */
export function cutCloudMasks(
  image: unknown,
  size: readonly [number, number],
  palette: readonly string[],
  web: PixelGlobals = globalThis as PixelGlobals,
): Promise<readonly [unknown, unknown, unknown]> {
  const [width, height] = size;
  const canvas = web.document?.createElement?.("canvas") as PixelCanvas | undefined;
  const { ImageData, createImageBitmap } = web;
  if (canvas === undefined || typeof canvas.getContext !== "function" || typeof ImageData !== "function" || typeof createImageBitmap !== "function") {
    return Promise.reject(new Error("this renderer cannot read pixels"));
  }
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) return Promise.reject(new Error("this renderer has no 2D canvas"));
  context.drawImage(image, 0, 0);
  const masks = cloudSlotMasks(context.getImageData(0, 0, width, height).data, palette);
  return Promise.all(masks.map((mask) => createImageBitmap(new ImageData(mask, width, height)))).then(([shadow, body, highlight]) => [shadow, body, highlight] as const);
}

/** Pixi and the art for this app session: fetched once, kept; a failure is not kept, so reopening the deck tries again. */
let engineOnce: Promise<{ pixi: PixiModule; art: Omit<DeckArtImage, "environment" | "extras"> }> | null = null;
/** The generated environment likewise, apart: its failure is a deck without a sky, not no deck. */
let environmentOnce: Promise<DeckEnvironmentImages | null> | null = null;
/** The sail and the crew's looks likewise, apart: their failure is a bare mast and the atlas's two outfits. */
let extrasOnce: Promise<DeckExtrasImages | null> | null = null;

/** The real thing: the browser's WebGL, and Pixi, the art, the environment and the extras fetched from the daemon on first use. */
export function browserDeckEngine(
  loadSource: () => Promise<DeckEngineSource>,
  loadArt: () => Promise<DeckArt>,
  loadEnvironment: () => Promise<DeckEnvironment>,
  loadExtras: () => Promise<DeckExtras>,
  decode: (png: string) => Promise<unknown> = decodeAtlas,
  motion: () => DeckMotionEnvironment = browserMotion,
): DeckEngine {
  return {
    probe: () => probeWebGL(),
    load() {
      engineOnce ??= Promise.all([
        loadSource().then(evaluatePixi),
        loadArt().then(function (art) {
          return decode(art.png).then(function (image) {
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
      environmentOnce ??= loadEnvironment()
        .then((environment) => decodeEnvironment(environment, decode))
        .catch(function (error: unknown) {
          console.warn("[firstmate] the ship deck's sea and sky did not load; drawing a plain sea:", error);
          environmentOnce = null;
          return null;
        });
      extrasOnce ??= loadExtras()
        .then((extras) =>
          decodeExtras(extras, decode, function (path, error) {
            console.warn(`[firstmate] the ship deck's ${path} did not load; drawing without it:`, error);
          }),
        )
        .catch(function (error: unknown) {
          console.warn("[firstmate] the ship deck's sail and crew looks did not load; drawing a bare mast and the atlas's two outfits:", error);
          extrasOnce = null;
          return null;
        });
      return Promise.all([engineOnce, environmentOnce, extrasOnce]).then(function ([{ pixi, art }, environment, extras]): StartDeck {
        return function (host, scene, size, onHover, onSelect) {
          return startDeck(pixi, { ...art, environment, extras }, host, scene, size, motion(), onHover, onSelect);
        };
      });
    },
    observeSize: observeHostSize,
  };
}
