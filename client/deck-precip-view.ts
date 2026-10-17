/** Pixi adapter for `precip@1`. Textures are cut once; sprite pools never exceed the pane budget.
 * Lite freezes a seeded peak field as one texture; weather changes its alpha, layout refreshes it.
 */
import { elementMotion, type AmbientElement, type DeckAmbience } from "./deck-ambience";
import type { MotionPlan } from "./deck-ambient";
import type { VisibleWorld } from "./deck-environment";
import type { PixiModule, PixiSprite, PixiTexture } from "./deck-pixi";
import { createPrecip, precipDepth } from "./deck-precip";
import { opacityAt } from "./deck-variants";

export function precipLayer(pixi: PixiModule, element: AmbientElement<"precip">, scene: string, seed: number,
  texture: (sprite: { image: string; rect?: readonly [number, number, number, number] | undefined }) => PixiTexture, sizes: DeckAmbience["sizes"]) {
  const { behaviour } = element;
  const peak = behaviour.opacity.reduce((best, point) => point[1] > best[1] ? point : best, behaviour.opacity[0]!);
  const field = createPrecip(behaviour, `${scene}:${element.id}`, seed);
  const container = new pixi.Container();
  container.label = element.id;
  container.visible = false;
  const layers = Array.from({ length: 3 }, (_, i) => {
    const layer = new pixi.Container();
    layer.label = `${element.id}:depth:${i}`;
    container.addChild(layer);
    return layer;
  });
  const textures = behaviour.drops.map((drop) => texture(drop.sprite));
  const dimensions = behaviour.drops.map((drop) => drop.sprite.rect?.slice(2) ?? sizes.get(drop.sprite.image)!);
  const splashTextures = behaviour.splashes?.frames.map(texture) ?? [];
  const drops: PixiSprite[] = [], splashes: PixiSprite[] = [];
  let cached = false;
  function pool(sprites: PixiSprite[], count: number, splash: boolean): void {
    while (sprites.length > count) {
      const index = sprites.length - 1, sprite = sprites.pop()!;
      (splash ? container : layers[precipDepth(index)]!).removeChild(sprite);
      sprite.destroy();
    }
    while (sprites.length < count) {
      const index = sprites.length;
      const sprite = new pixi.Sprite(splash ? splashTextures[0]! : textures[0]!);
      sprite.anchor.set(0.5, splash ? 1 : 0.5);
      sprite.label = `${element.id}:${splash ? "splash" : "drop"}:${index}`;
      sprite.visible = false;
      (splash ? container : layers[precipDepth(index)]!).addChild(sprite);
      sprites.push(sprite);
    }
  }
  return {
    container,
    layout(visible: VisibleWorld, pane: { width: number; height: number }): void {
      field.layout(visible, pane);
      pool(drops, field.drops.length, false);
      pool(splashes, field.splashes.length, true);
    },
    draw(seconds: number, plan: MotionPlan, intensity: number | null): void {
      const motion = elementMotion(element, plan);
      const hold = motion === "hold";
      if (cached && !hold) { container.cacheAsTexture?.(false); cached = false; }
      const opacity = opacityAt(behaviour.opacity, intensity);
      container.visible = motion !== "hide" && opacity > 0;
      if (!container.visible) { field.draw(seconds, null, "hide"); return; }
      // The old lite policy is first-frame art with live weather opacity. Cache the peak field once;
      // easing intensity changes only its parent's alpha, never hundreds of drops or a texture upload.
      container.alpha = hold ? opacity / Math.max(0.001, peak[1]) : 1;
      if (!field.draw(seconds, hold ? peak[0] : intensity, motion)) return;
      field.drops.forEach((drop, i) => {
        const sprite = drops[i]!;
        sprite.visible = drop.alpha > 0;
        if (!sprite.visible) return;
        sprite.texture = textures[drop.sprite]!;
        sprite.position.set(drop.x, drop.y);
        // Register at the authored falling tip; padding must never set the streak's length.
        const authored = behaviour.drops[drop.sprite]!;
        const [width, height] = dimensions[drop.sprite]!;
        sprite.anchor.set(authored.anchor[0] / width!, authored.anchor[1] / height!);
        const scale = drop.length / authored.length;
        sprite.scale.set(scale);
        sprite.rotation = (authored.angle - drop.angle) * Math.PI / 180;
        sprite.alpha = drop.alpha;
      });
      field.splashes.forEach((splash, i) => {
        const sprite = splashes[i]!;
        sprite.visible = splash.alpha > 0;
        if (!sprite.visible) return;
        sprite.texture = splashTextures[splash.frame]!;
        sprite.position.set(splash.x, splash.y);
        sprite.scale.set(splash.scale);
        sprite.alpha = splash.alpha;
      });
      if (hold) {
        if (!cached) { container.cacheAsTexture?.({ resolution: 1, antialias: false }); cached = true; }
        else container.updateCacheTexture?.();
      }
    },
  };
}
