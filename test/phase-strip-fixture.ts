import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { capabilitiesUsed, type SettingManifest } from "../shared/deck-setting";
import { shipManifest } from "./ship-pack";

/** Only test ambience is new; the established stage/cast make it renderable by the full host harness. */
export function phaseStripFixture(): SettingManifest {
  const scene = JSON.parse(readFileSync(new URL("./fixtures/phase-strip/scene.json", import.meta.url), "utf8")) as Pick<SettingManifest, "ambience" | "dayCycle" | "atmosphere" | "images">;
  return applyPhaseStripFixture(shipManifest(), scene);
}

export function applyPhaseStripFixture(source: SettingManifest, scene: Pick<SettingManifest, "ambience" | "dayCycle" | "atmosphere" | "images">): SettingManifest {
  const ship = structuredClone(source);
  // Keep the host stage still and independent of the fixture's deliberately different clock/phase ids.
  ship.stage.motion = undefined;
  ship.stage.tintByPhase = undefined;
  ship.stage.parts = ship.stage.parts.map((part) => ({ ...part, behaviour: undefined }));
  ship.stage.lights = [];
  ship.attentionCarrier = undefined;
  const manifest = { ...ship, ...scene, images: { ...ship.images, ...scene.images } };
  manifest.requires = capabilitiesUsed(manifest);
  return manifest;
}
