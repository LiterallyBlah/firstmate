/**
 * A setting's ambience compiled from its pack (`ambience` and `dayCycle` in `shared/deck-setting.ts`): which of its
 * elements are drawn, each with what it is drawn from, and how each moves on a deck that moves less. Pure, once per
 * pack (`client/deck-mount.ts`); `client/deck-environment.ts` draws what it says.
 *
 * - **Each element stands alone.** One whose images did not all arrive is left out by itself, and `missing` names
 *   what it lacked. Its `fallback` is drawn in its place, and an element named as a fallback is drawn only there. One
 *   that `needs` another goes with it, and so does one drawn in another's space or under it: an overlay or drifters in
 *   a backdrop's pixels, a flash under drifters.
 * - **A tile is never a hole.** A tile none of whose art can be drawn — not its own, not its fallback's — is filled flat
 *   with the pack's `fallbackFill` across its bands (`flats`), so the stage never stands on the theme's background.
 * - **Variants are left out one at a time**: a tile's, strip's or cycle's when a frame of it did not arrive or it does
 *   not line up — as many frames as its element, each the element's frame size — and the element stands as it is.
 *   Drifters lose a sprite at a time too: one whose image did not arrive, or would not cut into its slot masks, is
 *   left out and the field is drawn from the rest; a sprite's variant on its own when its frame did not arrive or
 *   cut, or is not one frame of the sprite's size.
 * - **Motion by the element's own word** (`elementMotion`): a deck in full motion runs every element; on a software
 *   renderer (`lite`) and under reduced motion (`still`) each runs, holds still, or is not drawn, as it says.
 */
import type { AmbienceBehaviour, SettingManifest } from "../shared/deck-setting";
import type { MotionPlan } from "./deck-ambient";

type Kind = AmbienceBehaviour["kind"];
type Element = SettingManifest["ambience"][number];
/** One kind of the catalogue's behaviours, as the pack writes it. */
export type Behaviour<K extends Kind> = Extract<AmbienceBehaviour, { kind: K }>;
export type DayCycle = NonNullable<SettingManifest["dayCycle"]>;

/** An element the scenery draws: the pack's own, its variants and drifters down to those that can be drawn. */
export interface AmbientElement<K extends Kind = Kind> {
  id: string;
  /** The element whose place it is drawn in: its own id, or for a fallback the id of the element it stands in for. */
  place: string;
  slot: Element["slot"];
  order: number;
  lite: Element["lite"];
  still: Element["still"];
  behaviour: Behaviour<K>;
}

export interface DeckAmbience {
  /** Scene salt for precipitation; optional for older synthetic scenery fixtures. */
  sceneId?: string;
  /** The elements drawn, back to front within each slot. */
  elements: readonly AmbientElement[];
  /** The tiles with nothing to draw them with, filled flat with `fallbackFill` across their bands, in the same order. */
  flats: ReadonlyArray<AmbientElement<"tile">>;
  /** The pack's flat colour for a tile that cannot be drawn, as a number. */
  fallbackFill: number;
  /** The pack's day, which the backdrops follow; null without one. */
  dayCycle: DayCycle | null;
  /** Every image something was left out for lacking, once each, in the pack's order. */
  missing: readonly string[];
  /** Each image's size, as the pack declares it: a sprite without a rectangle is the whole image. */
  sizes: ReadonlyMap<string, readonly [number, number]>;
}

/**
 * Which of `elements` are drawn: those that can be (`can`), less any a drawn element stands in for, and less any
 * that `needs` one not drawn — until nothing changes. A fallback is drawn only once what it stands in for is not, and
 * then in its place (`standsInFor`). Names `needs` gives that are not among `elements` are taken as drawn. The
 * ambience's elements and the stage's parts are resolved alike.
 */
export function resolveDrawn<E extends { id: string; fallback?: string | undefined }>(
  elements: readonly E[],
  can: (element: E) => boolean,
  needs: (element: E) => readonly string[],
): { drawn: ReadonlySet<string>; standsInFor: ReadonlyMap<string, string> } {
  const known = new Set(elements.map((element) => element.id));
  const standsInFor = new Map(elements.flatMap((element) => (element.fallback === undefined ? [] : [[element.fallback, element.id] as const])));
  // Left out until nothing changes: what cannot be drawn, what stands in for something drawn, what needs something not drawn.
  const blocked = new Set(elements.filter((element) => !can(element)).map((element) => element.id));
  const shown = () =>
    new Set(
      elements
        .filter((element) => !blocked.has(element.id))
        .filter((element) => !standsInFor.has(element.id) || blocked.has(standsInFor.get(element.id)!))
        .map((element) => element.id),
    );
  for (let drawn = shown(), changed = true; changed; drawn = shown()) {
    changed = false;
    for (const element of elements) {
      if (!drawn.has(element.id) || needs(element).every((id) => !known.has(id) || drawn.has(id))) continue;
      blocked.add(element.id);
      changed = true;
    }
  }
  return { drawn: shown(), standsInFor };
}

/** The elements of `kind`, in drawing order. */
export function elementsOf<K extends Kind>(ambience: DeckAmbience, kind: K): Array<AmbientElement<K>> {
  return ambience.elements.filter((element) => element.behaviour.kind === kind) as unknown as Array<AmbientElement<K>>;
}

/**
 * The elements of `manifest` that can be drawn, in their order: `has` says which images arrived, and `masked` which a
 * drifter could cut into its slot masks.
 */
export function compileAmbience(manifest: SettingManifest, has: (image: string) => boolean, masked: (image: string) => boolean = has): DeckAmbience {
  const missing = new Set<string>();
  const sizeOf = (sprite: { image: string; rect?: readonly [number, number, number, number] | undefined }) =>
    sprite.rect === undefined ? manifest.images[sprite.image]?.size : ([sprite.rect[2], sprite.rect[3]] as const);
  const sameSize = (sprite: { image: string; rect?: readonly [number, number, number, number] | undefined }, size: readonly [number, number] | undefined) => {
    const own = sizeOf(sprite);
    return own !== undefined && size !== undefined && own[0] === size[0] && own[1] === size[1];
  };
  /** Whether every image arrived, noting each that did not. */
  const arrived = (images: ReadonlyArray<string | undefined>, cut = false) =>
    images.filter(function (image) {
      const there = image !== undefined && has(image) && (!cut || masked(image));
      if (!there && image !== undefined) missing.add(image);
      return !there;
    }).length === 0;

  /** The element as it can be drawn, or null when what it is drawn from did not arrive. */
  function drawable(element: Element): AmbientElement | null {
    const { behaviour } = element;
    const head = { id: element.id, place: standsInFor.get(element.id) ?? element.id, slot: element.slot, order: element.order, lite: element.lite, still: element.still };
    switch (behaviour.kind) {
      case "backdrop-cycle": {
        const phases = manifest.dayCycle?.phases ?? [];
        return phases.length > 0 && arrived(phases.map((phase) => behaviour.phases[phase.id])) ? { ...head, behaviour } : null;
      }
      case "overlay":
        return arrived([behaviour.image]) ? { ...head, behaviour } : null;
      case "flash":
        return arrived(behaviour.frames.map((frame) => frame.sprite.image)) ? { ...head, behaviour } : null;
      case "precip": {
        const drops = behaviour.drops.filter((drop) => arrived([drop.sprite.image]));
        const ids = new Set(drops.map((drop) => drop.id));
        const kinds = behaviour.kinds.map((kind) => ({ ...kind, drops: kind.drops.filter((id) => ids.has(id)) }));
        if (kinds.some((kind) => ["far", "mid", "near"].some((depth) => !drops.some((drop) => kind.drops.includes(drop.id) && drop.depth === depth)))) return null;
        const { splashes, ...base } = behaviour;
        return { ...head, behaviour: { ...base, drops, kinds,
          ...(splashes !== undefined && arrived(splashes.frames.map((sprite) => sprite.image)) ? { splashes } : {}) } };
      }
      case "phase-frames":
        return arrived(behaviour.frames.map((frame) => frame.image)) ? { ...head, behaviour } : null;
      case "phase-strip": {
        const { sprites } = behaviour.frames;
        if (!arrived(sprites.map((sprite) => sprite.image))) return null;
        const size = sizeOf(sprites[0]!);
        const byPhase = Object.fromEntries(Object.entries(behaviour.byPhase).filter(([, frames]) =>
          frames.length === sprites.length && frames.every((frame) => sameSize(frame, size)) && arrived(frames.map((frame) => frame.image))));
        return { ...head, behaviour: { ...behaviour, byPhase } };
      }
      case "flyby":
        return arrived(Object.values(behaviour.poses).map((sprite) => sprite.image)) ? { ...head, behaviour } : null;
      case "drifters": {
        const sprites = behaviour.sprites
          .filter((sprite) => arrived([sprite.image], true))
          .map(function (sprite) {
            const variants = (sprite.variants ?? []).filter(function (variant) {
              const size = sizeOf(variant.frames[0]!);
              return variant.frames.length === 1 && size?.[0] === sprite.size[0] && size[1] === sprite.size[1] && arrived([variant.frames[0]!.image], true);
            });
            return { ...sprite, variants };
          });
        return sprites.length > 0 ? { ...head, behaviour: { ...behaviour, sprites } } : null;
      }
      case "tile":
      case "strip":
      case "cycle": {
        const { sprites } = behaviour.frames;
        if (!arrived(sprites.map((sprite) => sprite.image))) return null;
        // A variant rides its element's frame index: as many frames, each of the element's frame size.
        const size = sizeOf(sprites[0]!);
        const variants = (behaviour.variants ?? []).filter(
          (variant) => variant.frames.length === sprites.length && variant.frames.every((frame) => sameSize(frame, size)) && arrived(variant.frames.map((frame) => frame.image)),
        );
        return { ...head, behaviour: { ...behaviour, variants } } as AmbientElement;
      }
    }
  }

  const inScope = manifest.ambience;
  /** Who stands in for whom: each fallback, by the element it is drawn in place of. */
  const standsInFor = new Map(inScope.flatMap((element) => (element.fallback === undefined ? [] : [[element.fallback, element.id] as const])));
  const own = new Map(inScope.map((element) => [element.id, drawable(element)]));
  const { drawn } = resolveDrawn(
    inScope,
    (element) => own.get(element.id) !== null,
    (element) => [
      ...(element.needs ?? []),
      ...(element.behaviour.kind === "overlay" || element.behaviour.kind === "drifters" ? [element.behaviour.space] : []),
      ...(element.behaviour.kind === "flash" ? [element.behaviour.under] : []),
    ],
  );
  const inOrder = (keep: (element: Element) => boolean) =>
    inScope
      .map((element, index) => ({ element, index }))
      .filter(({ element }) => keep(element))
      .sort((a, b) => a.element.order - b.element.order || a.index - b.index)
      .map(({ element }) => element);
  const elements = inOrder((element) => drawn.has(element.id)).map((element) => own.get(element.id)!);
  // A tile, not itself a fallback, drawn neither itself nor by its fallback.
  const flats = inOrder(
    (element) =>
      element.behaviour.kind === "tile" &&
      !standsInFor.has(element.id) &&
      !drawn.has(element.id) &&
      (element.fallback === undefined || !drawn.has(element.fallback)),
  ).map((element) => ({ id: element.id, place: element.id, slot: element.slot, order: element.order, lite: element.lite, still: element.still, behaviour: element.behaviour as Behaviour<"tile"> }));
  const order = Object.keys(manifest.images);
  return {
    sceneId: manifest.id,
    elements,
    flats,
    fallbackFill: Number.parseInt(manifest.palette.fallbackFill.slice(1), 16),
    dayCycle: manifest.dayCycle ?? null,
    missing: [...missing].sort((a, b) => order.indexOf(a) - order.indexOf(b)),
    sizes: new Map(Object.entries(manifest.images).map(([id, image]) => [id, image.size])),
  };
}

/** How an element moves under `plan`: as it does in full motion, held still, or not drawn at all. */
export function elementMotion(element: Pick<AmbientElement, "lite" | "still">, plan: Pick<MotionPlan, "level">): "run" | "hold" | "hide" {
  if (plan.level === "full") return "run";
  const word = plan.level === "lite" ? element.lite : element.still;
  return word === "run" ? "run" : word === "hide" ? "hide" : "hold";
}
