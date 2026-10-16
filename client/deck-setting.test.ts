import { describe, expect, it } from "vitest";
import { displaySettings } from "../shared/settings";
import type { DeckSettingSummary } from "../shared/deck-rpc";
import { deckPresentation, resolveDeckSetting } from "./deck-setting";
import { shipManifest } from "../test/ship-pack";

const pack = (id: string, compatible = true): DeckSettingSummary => ({ id, name: id.toUpperCase(), version: "1.0.0", formatVersion: 1, compatible, reason: compatible ? null : "needs walk-in@2", preview: null, bytes: 0 });
const scope = { kind: "fleet" } as const;

describe("global deck selection", () => {
  it("defaults existing settings documents to ship without a version migration", () => {
    expect(displaySettings.schema.parse({ pollSeconds: 10 }).deckSetting).toBe("ship");
    expect(displaySettings.version).toBe(1);
    expect(displaySettings.schema.parse({ deckSetting: "studio" }).deckSetting).toBe("studio");
    for (const id of ["", "../ship", "UPPER", "studio/code.js"]) expect(displaySettings.schema.safeParse({ deckSetting: id }).success).toBe(false);
  });

  it("uses an installed compatible choice, or explains its fallback without changing the saved choice", () => {
    const display = { deckSetting: "studio" };
    expect(resolveDeckSetting(display, scope, [pack("ship"), pack("studio")])).toEqual({ id: "studio", notice: null });
    expect(resolveDeckSetting(display, scope, [pack("ship")])).toEqual({ id: "ship", notice: 'The setting "studio" is not installed. Showing the default setting.' });
    expect(resolveDeckSetting(display, scope, [pack("ship"), pack("studio", false)]).notice).toContain("needs walk-in@2");
    expect(display.deckSetting).toBe("studio");
  });

  it("can open the default immediately but waits for metadata before loading another choice", () => {
    expect(resolveDeckSetting({ deckSetting: "ship" }, scope, undefined)).toEqual({ id: "ship", notice: null });
    expect(resolveDeckSetting({ deckSetting: "studio" }, scope, undefined)).toEqual({ id: null, notice: null });
  });

  it("falls back to ship when a saved office choice has been withdrawn", () => {
    const display = { deckSetting: "office" };
    expect(resolveDeckSetting(display, scope, [pack("ship")])).toEqual({
      id: "ship", notice: 'The setting "office" is not installed. Showing the default setting.',
    });
    expect(display.deckSetting).toBe("office");
  });

  it("reads all pane words and zone descriptions from a pack with arbitrary ids", () => {
    const manifest = structuredClone(shipManifest());
    manifest.id = "studio";
    manifest.copy.title = "Studio";
    manifest.copy.actor = { one: "maker", many: "makers" };
    manifest.zones.byState.working = "workbench";
    manifest.copy.zones.workbench = "at the workbench";
    expect(deckPresentation(manifest)).toMatchObject({ id: "studio", copy: { title: "Studio", actor: { one: "maker", many: "makers" } }, places: { working: "at the workbench" } });
  });
});
