import { describe, expect, it } from "vitest";
import { compileAmbience } from "../client/deck-ambience";
import { precipManifest } from "../test/precip-fixture";
import { SettingManifestSchema, settingImageIds } from "./deck-setting";

describe("precip@1 pack contract", () => {
  it("declares the capability and atlas references, compiles independently of other ambience", () => {
    const manifest = precipManifest();
    expect(SettingManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest.requires).toContain("precip@1");
    expect(settingImageIds(manifest)).toContain("rain-test");
    const compiled = compileAmbience(manifest, (id) => id !== "rain-test");
    expect(compiled.missing).toContain("rain-test");
    expect(compiled.elements.some((element) => element.id === "test-rain")).toBe(false);
    expect(compiled.elements.some((element) => element.id === "sky")).toBe(true);
  });
  it.each(["range", "duplicate-kind", "drop-ref", "crop", "wind", "expression", "many-emitters", "capability"])("rejects %s", (problem) => {
    const manifest = precipManifest();
    const element = manifest.ambience.at(-1)!;
    const rain = element.behaviour;
    if (rain.kind !== "precip") throw new Error("fixture");
    if (problem === "range") rain.kinds[0]!.speed = [200, 50];
    if (problem === "duplicate-kind") rain.kinds[1]!.id = rain.kinds[0]!.id;
    if (problem === "drop-ref") rain.kinds[0]!.drops = ["missing"];
    if (problem === "crop") rain.drops[0]!.sprite.rect = [95, 0, 6, 10];
    if (problem === "wind") rain.wind.angle = 70;
    if (problem === "expression") Object.assign(rain, { expression: "sin(time)" });
    if (problem === "many-emitters") manifest.ambience.push({ ...element, id: "another" });
    if (problem === "capability") manifest.requires = manifest.requires.filter((id) => id !== "precip@1");
    expect(SettingManifestSchema.safeParse(manifest).success).toBe(false);
  });
});
