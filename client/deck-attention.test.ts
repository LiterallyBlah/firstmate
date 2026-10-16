import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { shipFile, shipManifest } from "../test/ship-pack";
import { decodePng } from "../test/png";
import { SettingManifestSchema } from "../shared/deck-setting";
import { carrierAt, carrierHit, carrierHover, carrierRipples } from "./deck-attention";

describe("attention-carrier@1", () => {
  const carrier = shipManifest().attentionCarrier!;
  it("validates references, frame geometry, fit and the exact required version with no expression escape hatch", () => {
    const changed = (edit: (m: ReturnType<typeof shipManifest>) => void) => { const m = structuredClone(shipManifest()); edit(m); return SettingManifestSchema.safeParse(m).success; };
    expect(changed(m => { m.id = "arbitrary-setting"; })).toBe(true);
    expect(changed(m => { m.requires = m.requires.filter(x => x !== "attention-carrier@1"); })).toBe(false);
    expect(changed(m => { m.attentionCarrier!.frames[0]!.image = "missing"; })).toBe(false);
    expect(changed(m => { m.attentionCarrier!.frames[0]!.rect = [0, 0, 1, 1]; })).toBe(false);
    expect(changed(m => { m.attentionCarrier!.at = [-1, 10]; })).toBe(false);
    expect(changed(m => { m.attentionCarrier!.loiter.amplitude = [999, 1]; })).toBe(false);
    expect(changed(m => { m.attentionCarrier!.bubbleHeight = 48; })).toBe(false);
    expect(changed(m => { m.attentionCarrier!.bubbleHeight = -1; })).toBe(false);
    expect(SettingManifestSchema.safeParse({ ...shipManifest(), attentionCarrier: { ...carrier, script: "openWorker()" } }).success).toBe(false);
  });

  it("loiters only on the existing motion clock and uses the same no-bob coordinates for hover and hit testing", () => {
    for (let ms = 0; ms < 12000; ms += 37) {
      const at = carrierAt(carrier, ms, true);
      expect(Math.abs(at.x - carrier.at[0])).toBeLessThanOrEqual(2);
      expect(Math.abs(at.y - carrier.at[1])).toBeLessThanOrEqual(1);
      expect(at.frame).toBeGreaterThanOrEqual(0); expect(at.frame).toBeLessThan(4);
      expect(carrierHit(carrier, at, { x: at.x + 32, y: at.y + 24 })).toBe(true);
      expect(carrierHit(carrier, at, { x: at.x - 1, y: at.y + 24 })).toBe(false);
      expect(carrierAt(carrier, ms, false)).toEqual({ x: 4, y: 122, frame: 0 });
    }
    expect(carrierHover("remote:host:worker", carrier, { x: 4, y: 122 }, { scale: 2, x: 10, y: 20 }, { width: 800, height: 400 }))
      .toEqual({ key: "remote:host:worker", action: "attention", x: 82, top: 264, bottom: 360, width: 800, height: 400, floor: null });
  });

  it("ships four registered 64x48 generated frames, eight colours, binary alpha, a clear border and an identical bubble", () => {
    const palette = new Set([0x151e2d,0x1d314e,0x2c4869,0x45617a,0x64849a,0x8fa8b4,0xbecac6,0xd9d4be]);
    const frames = carrier.frames.map(sprite => decodePng(readFileSync(shipFile(shipManifest().images[sprite.image]!.path))));
    expect(frames).toHaveLength(4);
    for (const frame of frames) {
      expect([frame.width, frame.height]).toEqual([64, 48]);
      for (let y=0;y<48;y++) for(let x=0;x<64;x++) {
        const alpha = frame.alpha(x,y);
        expect([0,255]).toContain(alpha);
        if (alpha) expect(palette.has(frame.at(x,y) >>> 8)).toBe(true);
        if (x<2||x>=62||y<2||y>=46) expect(alpha).toBe(0);
        if (y<24) expect(frame.at(x,y)).toBe(frames[0]!.at(x,y));
      }
    }
  });
});

describe("carrier-surface@1", () => {
  const manifest = () => JSON.parse(readFileSync(new URL("../art/settings/japanese-ship/setting.json", import.meta.url), "utf8"));
  it("requires a surface inside the body, an existing water clock and explicit engine support", () => {
    expect(SettingManifestSchema.safeParse(manifest()).success).toBe(true);
    for (const change of [
      (m: ReturnType<typeof shipManifest>) => { m.attentionCarrier!.surface!.row = 18; },
      (m: ReturnType<typeof shipManifest>) => { m.attentionCarrier!.surface!.row = 43; },
      (m: ReturnType<typeof shipManifest>) => { m.attentionCarrier!.surface!.ripple.clock = "missing"; },
      (m: ReturnType<typeof shipManifest>) => { m.requires = m.requires.filter(x => x !== "carrier-surface@1"); },
    ]) {
      const m = manifest(); change(m);
      expect(SettingManifestSchema.safeParse(m).success).toBe(false);
    }
  });

  it("keeps moving and still ripples attached to the waterline, inside the target and below the marker", () => {
    const carrier = SettingManifestSchema.parse(manifest()).attentionCarrier!;
    const still = carrierRipples(carrier, 0, false);
    for (let ms = 0; ms < 6000; ms += 100) {
      expect(carrierRipples(carrier, ms, false)).toEqual(still);
      for (const arc of carrierRipples(carrier, ms, true)) {
        expect(arc.x).toBeGreaterThanOrEqual(0);
        expect(arc.x + arc.width).toBeLessThanOrEqual(carrier.size[0]);
        expect(arc.y).toBeGreaterThan(carrier.bubbleHeight!);
        expect(Math.abs(arc.y - carrier.surface!.row)).toBeLessThanOrEqual(2);
      }
    }
    expect(carrierRipples(carrier, 600, true)).not.toEqual(still);
    expect(carrierRipples(shipManifest().attentionCarrier!, 600, true)).toEqual([]);
  });
});
