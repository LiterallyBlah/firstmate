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
 * setting**, alongside it: `firstmate.deck.setting` sends the pack (`shared/deck-setting.ts`) — its manifest
 * and every image, base64 — and `decodePack` decodes each image on its own with `decodeAtlas`. Pixi once per
 * app session, each pack once per session by id, kept; a failure is not kept, and a renderer without a host or
 * WebGL never asks for either. An image that does not decode costs only what draws with it (`packArt`): the
 * backdrop is needed to draw at all; the rest — an ambience element (`client/deck-ambience.ts`), which its fallback
 * stands in for or, for a tile with none, a flat fill; the sail, a crew look, a cloud — is left out with a warning.
 * Each drifter is cut into three white masks to be tinted (`cutCloudMasks`), and one that cannot be is left out the
 * same way.
 *
 * **Motion is the browser's too.** `browserMotion` hands the deck `requestAnimationFrame`, the
 * `prefers-reduced-motion` query and `document.hidden`, so `client/deck-loop.ts` can cap, pause and still it;
 * and the local clock with a timer, so the sky follows the time of day.
 *
 * Every way it can fail ends in a status, never a throw: no host, no WebGL, Pixi or the art failing to
 * load, Pixi failing to start. A mount torn down while Pixi is still starting destroys what starts.
 */
import type { DeckEngineSource, DeckSetting } from "../shared/deck-rpc";
import type { SettingManifest } from "../shared/deck-setting";
import { compileAmbience } from "./deck-ambience";
import { compileAtmosphere } from "./deck-atmosphere";
import { cloudSlotMasks, type DrifterMasks } from "./deck-clouds";
import { compileParts } from "./deck-parts";
import type { DeckHover } from "./deck-hover";
import type { FrameScheduler, MotionSignals } from "./deck-loop";
import { startDeck, type DeckArtImage, type DeckMotionEnvironment, type PixiModule } from "./deck-pixi";
import { compileCast } from "./deck-cast";
import { compileStage } from "./deck-stage";
import { deckPresentation, type DeckPresentation } from "./deck-setting";
import type { DeckScene } from "./deck-scene";

export type DeckStatus =
  | { kind: "starting" }
  | { kind: "drawing"; renderer: string; presentation?: DeckPresentation }
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
  readonly presentation?: DeckPresentation;
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
      onStatus({ kind: "drawing", renderer: started.renderer, ...(started.presentation === undefined ? {} : { presentation: started.presentation }) });
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

/** A setting pack with its images decoded: each image that decoded, by id, and why each that did not, did not. */
export interface DecodedPack {
  manifest: SettingManifest;
  images: ReadonlyMap<string, unknown>;
  failed: ReadonlyMap<string, unknown>;
}

/**
 * Decodes every image a pack sent, each on its own: one that will not decode is only that one. The server sends every
 * image the manifest draws with; one it did not is missing from what is drawn, as one that failed would be.
 */
export function decodePack(setting: DeckSetting, decode: (png: string) => Promise<unknown>): Promise<DecodedPack> {
  const ids = [...new Set([...Object.keys(setting.manifest.images), ...Object.keys(setting.images)])];
  return Promise.all(
    ids.map(function (id) {
      const png = setting.images[id];
      const decoded = png === undefined ? Promise.reject(new Error(`the setting sent no ${id}`)) : decode(png);
      return decoded.then(
        (image) => ({ id, image, error: null }),
        (error: unknown) => ({ id, image: undefined, error }),
      );
    }),
  ).then(function (results) {
    const images = new Map<string, unknown>();
    const failed = new Map<string, unknown>();
    for (const result of results) {
      if (result.error === null) images.set(result.id, result.image);
      else failed.set(result.id, result.error);
    }
    return { manifest: setting.manifest, images, failed };
  });
}

/**
 * Every drifter's image that decoded, and each of its variants', cut into its three slot masks by its palette, by
 * image id (`client/deck-clouds.ts`). One that will not cut is left out like a missing image, and `onFailed` hears it.
 */
export function drifterMasks(
  pack: Pick<DecodedPack, "manifest" | "images">,
  cutCloud: CutCloud = cutCloudMasks,
  onFailed: (image: string, error: unknown) => void = function () {},
): Promise<Map<string, DrifterMasks>> {
  const sprites: Array<{ image: string; size: readonly [number, number]; palette: readonly string[] }> = [];
  for (const element of pack.manifest.ambience) {
    if (element.behaviour.kind !== "drifters") continue;
    const { palette } = element.behaviour;
    for (const sprite of element.behaviour.sprites) sprites.push({ image: sprite.image, size: sprite.size, palette });
    for (const sprite of element.behaviour.sprites)
      for (const variant of sprite.variants ?? []) {
        const frame = variant.frames[0]!.image;
        sprites.push({ image: frame, size: pack.manifest.images[frame]?.size ?? sprite.size, palette: variant.palette ?? palette });
      }
  }
  const once = sprites.filter((sprite, index) => pack.images.has(sprite.image) && sprites.findIndex((other) => other.image === sprite.image) === index);
  return Promise.all(
    once.map((sprite) =>
      Promise.resolve()
        .then(() => cutCloud(pack.images.get(sprite.image), sprite.size, sprite.palette))
        .then(
          (masks) => [sprite.image, masks] as const,
          function (error: unknown) {
            onFailed(sprite.image, error);
            return null;
          },
        ),
    ),
  ).then((cut) => new Map(cut.filter((entry) => entry !== null)));
}

/**
 * The art the engine draws from a decoded pack: its stage, cast and ambience compiled, each drifter cut into its masks,
 * and its effect definitions. The backdrop is required; an ambience element, look or effect frame is
 * left out on its own. `warn` hears what is missing.
 */
export function packArt(
  pack: DecodedPack,
  warn: (message: string, error: unknown) => void = function () {},
  cutCloud: CutCloud = cutCloudMasks,
): Promise<DeckArtImage> {
  const pathOf = (id: string) => pack.manifest.images[id]?.path ?? id;
  const backdrop = pack.manifest.stage.backdrop.sprite.image;
  const atlas = pack.images.get(backdrop);
  if (atlas === undefined) return Promise.reject(pack.failed.get(backdrop) ?? new Error(`the setting's ${backdrop} did not load`));
  // The stage's parts, pieces and lights: one that is not optional and did not load, and the stage cannot be drawn.
  const parts = compileParts(pack.manifest, (id) => pack.images.has(id));
  const lacking = parts.required[0];
  if (lacking !== undefined) return Promise.reject(pack.failed.get(lacking) ?? new Error(`the setting's ${lacking} did not load`));
  for (const id of parts.missing) warn(`[firstmate] the deck's ${pathOf(id)} did not load; drawing without it:`, pack.failed.get(id));
  const cast = compileCast(pack.manifest);
  const effectImages = new Set(Object.values(pack.manifest.effects).flatMap((effect) => Object.values(effect.frames).map((sprite) => sprite.image)));
  for (const id of effectImages) if (!pack.images.has(id)) warn(`[firstmate] the deck's ${pathOf(id)} did not load; drawing without it:`, pack.failed.get(id));
  const uncut = new Map<string, unknown>();
  return drifterMasks(pack, cutCloud, (id, error) => uncut.set(id, error)).then(function (masks) {
    const ambience = compileAmbience(
      pack.manifest,
      (id) => pack.images.has(id),
      (id) => masks.has(id),
    );
    // An element, or a drifter, whose image did not decode or would not cut is not drawn.
    for (const id of ambience.missing) warn(`[firstmate] the deck's ${pathOf(id)} did not load; drawing without it:`, pack.failed.get(id) ?? uncut.get(id));
    // A look whose image did not decode is not handed out.
    for (const look of cast.looks) {
      const failed = pack.failed.get(look.image);
      if (failed !== undefined) warn(`[firstmate] the deck's ${pathOf(look.image)} did not load; drawing without it:`, failed);
    }
    return { stage: compileStage(pack.manifest), cast, parts, ambience, atmosphere: compileAtmosphere(pack.manifest), images: pack.images, masks, image: atlas, effects: pack.manifest.effects, presentation: deckPresentation(pack.manifest) };
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

/** Pixi for this app session: fetched once, kept; a failure is not kept, so reopening the deck tries again. */
let engineOnce: Promise<PixiModule> | null = null;
/** Each setting's art for this app session, by id, likewise. */
const packOnce = new Map<string, Promise<DeckArtImage>>();

/** The real thing: the browser's WebGL, and Pixi and the setting `setting` fetched from the daemon on first use. */
export function browserDeckEngine(
  loadSource: () => Promise<DeckEngineSource>,
  loadSetting: (id: string) => Promise<DeckSetting>,
  setting: string,
  decode: (png: string) => Promise<unknown> = decodeAtlas,
  motion: () => DeckMotionEnvironment = browserMotion,
): DeckEngine {
  return {
    probe: () => probeWebGL(),
    load() {
      engineOnce ??= loadSource()
        .then(evaluatePixi)
        .catch(function (error: unknown) {
          engineOnce = null;
          throw error;
        });
      let art = packOnce.get(setting);
      if (art === undefined) {
        art = loadSetting(setting)
          .then((loaded) => decodePack(loaded, decode))
          .then((pack) => packArt(pack, (message, error) => console.warn(message, error)));
        packOnce.set(setting, art);
        art.catch(() => packOnce.delete(setting));
      }
      return Promise.all([engineOnce, art]).then(function ([pixi, drawn]): StartDeck {
        return function (host, scene, size, onHover, onSelect) {
          return startDeck(pixi, drawn, host, scene, size, motion(), onHover, onSelect);
        };
      });
    },
    observeSize: observeHostSize,
  };
}
