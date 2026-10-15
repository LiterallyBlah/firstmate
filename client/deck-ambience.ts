/**
 * A setting's ambience compiled from its pack (`ambience` and `dayCycle` in `shared/deck-setting.ts`): which of its
 * elements are drawn, each with what it is drawn from, and how each moves on a deck that moves less. Pure, once per
 * pack (`client/deck-mount.ts`); `client/deck-environment.ts` draws what it says.
 *
 * - **Each element stands alone.** One whose images did not all arrive is left out by itself, and `missing` names
 *   what it lacked. Its `fallback` is drawn in its place, and an element named as a fallback is drawn only there. One
 *   that `needs` another goes with it, and so does one drawn in another's space or under it: an overlay or drifters in
 *   a backdrop's pixels, a flash under drifters.
 * - **Drifters lose a sprite at a time**: one whose image did not arrive, or would not cut into its slot masks, is left
 *   out and the field is drawn from the rest. A sprite's variant is left out on its own when its frame did not arrive
 *   or cut, or is not one frame of the sprite's size.
 * - **Motion by the element's own word** (`elementMotion`): a deck in full motion runs every element; on a software
 *   renderer (`lite`) and under reduced motion (`still`) each runs, holds still, or is not drawn, as it says.
 *
 * Until step 5b of the migration the sea, the foam, the wake and the cycles are read through the legacy views
 * (`client/deck-legacy.ts`); only the kinds in `FROM_PACK` are compiled here.
 */
import type { AmbienceBehaviour, SettingManifest } from "../shared/deck-setting";
import type { MotionPlan } from "./deck-ambient";

type Kind = AmbienceBehaviour["kind"];
type Element = SettingManifest["ambience"][number];
/** One kind of the catalogue's behaviours, as the pack writes it. */
export type Behaviour<K extends Kind> = Extract<AmbienceBehaviour, { kind: K }>;
export type DayCycle = NonNullable<SettingManifest["dayCycle"]>;

/** An element the scenery draws: the pack's own, its drifters down to the sprites and variants that can be drawn. */
export interface AmbientElement<K extends Kind = Kind> {
  id: string;
  slot: Element["slot"];
  order: number;
  lite: Element["lite"];
  still: Element["still"];
  behaviour: Behaviour<K>;
}

export interface DeckAmbience {
  /** The elements drawn, back to front within each slot. */
  elements: readonly AmbientElement[];
  /** The pack's day, which the backdrops follow; null without one. */
  dayCycle: DayCycle | null;
  /** Every image something was left out for lacking, once each, in the pack's order. */
  missing: readonly string[];
  /** Each image's size, as the pack declares it: a sprite without a rectangle is the whole image. */
  sizes: ReadonlyMap<string, readonly [number, number]>;
}

/** The kinds drawn from the pack itself; the rest are still the legacy views' until step 5b. */
const FROM_PACK: ReadonlySet<Kind> = new Set<Kind>(["backdrop-cycle", "overlay", "flash", "drifters", "flyby"]);

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
    const head = { id: element.id, slot: element.slot, order: element.order, lite: element.lite, still: element.still };
    switch (behaviour.kind) {
      case "backdrop-cycle": {
        const phases = manifest.dayCycle?.phases ?? [];
        return phases.length > 0 && arrived(phases.map((phase) => behaviour.phases[phase.id])) ? { ...head, behaviour } : null;
      }
      case "overlay":
        return arrived([behaviour.image]) ? { ...head, behaviour } : null;
      case "flash":
        return arrived(behaviour.frames.map((frame) => frame.sprite.image)) ? { ...head, behaviour } : null;
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
      default:
        return null;
    }
  }

  const inScope = manifest.ambience.filter((element) => FROM_PACK.has(element.behaviour.kind));
  const own = new Map(inScope.map((element) => [element.id, drawable(element)]));
  const scoped = new Set(own.keys());
  /** Who stands in for whom: each fallback, by the element it is drawn in place of. */
  const standsInFor = new Map(inScope.flatMap((element) => (element.fallback === undefined ? [] : [[element.fallback, element.id] as const])));
  const needs = (element: Element) => [
    ...(element.needs ?? []),
    ...(element.behaviour.kind === "overlay" || element.behaviour.kind === "drifters" ? [element.behaviour.space] : []),
    ...(element.behaviour.kind === "flash" ? [element.behaviour.under] : []),
  ];
  // Left out until nothing changes: what did not arrive, what stands in for something drawn, what needs something not drawn.
  const blocked = new Set(inScope.filter((element) => own.get(element.id) === null).map((element) => element.id));
  const shown = () =>
    new Set(
      inScope
        .filter((element) => !blocked.has(element.id))
        .filter((element) => !standsInFor.has(element.id) || blocked.has(standsInFor.get(element.id)!))
        .map((element) => element.id),
    );
  for (let drawn = shown(), changed = true; changed; drawn = shown()) {
    changed = false;
    for (const element of inScope) {
      if (!drawn.has(element.id) || needs(element).every((id) => !scoped.has(id) || drawn.has(id))) continue;
      blocked.add(element.id);
      changed = true;
    }
  }
  const drawn = shown();
  const elements = inScope
    .map((element, index) => ({ element, index }))
    .filter(({ element }) => drawn.has(element.id))
    .sort((a, b) => a.element.order - b.element.order || a.index - b.index)
    .map(({ element }) => own.get(element.id)!);
  const order = Object.keys(manifest.images);
  return {
    elements,
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
