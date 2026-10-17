import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import { decodePng } from "./png";

describe.each(["ship", "japanese-ship"])("%s rain direction", (id) => {
  it("advances eight pixels down at every frame, including the loop boundary", () => {
    const root = new URL(`../art/settings/${id}/`, import.meta.url);
    const pack = JSON.parse(readFileSync(new URL("setting.json", root), "utf8"));
    const rain = pack.ambience.find((element: { id: string }) => element.id === (id === "ship" ? "rain" : "rain-spray"));
    const frames = rain.behaviour.variants[0].frames.map((sprite: { image: string }) =>
      decodePng(readFileSync(new URL(pack.images[sprite.image].path, root))),
    );
    expect(frames).toHaveLength(4);
    expect(rain.behaviour.frames.sprites).toHaveLength(4);
    // Keep the full-height weather tiling contract, including above the stage in tall panes.
    expect(rain.behaviour.bands).toEqual([{ slot: "front", fromRow: 0 }]);
    expect(rain.behaviour.origin).toBe(0);
    for (let frame = 0; frame < frames.length; frame++) {
      const a = frames[frame]!, b = frames[(frame + 1) % frames.length]!;
      expect([a.width, a.height]).toEqual([96, 64]);
      expect(a.rgba).not.toEqual(b.rgba);
      for (let row = 0; row < a.height; row++) {
        const next = (row + 8) % a.height;
        expect(b.rgba.subarray(next * a.width * 4, (next + 1) * a.width * 4))
          .toEqual(a.rgba.subarray(row * a.width * 4, (row + 1) * a.width * 4));
      }
    }
  });
});
