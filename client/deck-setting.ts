/** Global selection today. A future project scope changes this resolver, never the engine or pack schema. */
import { DEFAULT_DECK_SETTING, type DeckSettingSummary } from "../shared/deck-rpc";
import type { DisplaySettings } from "../shared/settings";
import type { SettingManifest, ActivityState } from "../shared/deck-setting";

export type DeckScope = { kind: "fleet" };
export interface DeckSelection { id: string | null; notice: string | null }

export function resolveDeckSetting(display: Pick<DisplaySettings, "deckSetting">, _scope: DeckScope, installed: readonly DeckSettingSummary[] | undefined): DeckSelection {
  const requested = display.deckSetting;
  if (installed === undefined) return { id: requested === DEFAULT_DECK_SETTING ? requested : null, notice: null };
  const found = installed.find((pack) => pack.id === requested);
  if (found?.compatible === true) return { id: requested, notice: null };
  const reason = found === undefined ? `The setting "${requested}" is not installed.` : `${found.name} is unavailable: ${found.reason ?? "it needs a newer FirstMate"}.`;
  return { id: DEFAULT_DECK_SETTING, notice: `${reason} Showing the default setting.` };
}

/** Pack-owned words sent alongside a started drawing; counts, state labels and interaction stay engine-owned. */
export interface DeckPresentation {
  id: string;
  copy: SettingManifest["copy"];
  places: Record<ActivityState, string>;
}
export function deckPresentation(manifest: SettingManifest): DeckPresentation {
  const place = (state: ActivityState) => manifest.copy.zones[manifest.zones.byState[state]]!;
  return { id: manifest.id, copy: manifest.copy, places: { working: place("working"), waiting: place("waiting"), blocked: place("blocked"), idle: place("idle") } };
}

/** Neutral words until a pack has loaded, and on platforms where the engine cannot start. */
export const LOADING_DECK: DeckPresentation = {
  id: "", copy: { pane: "Deck", tooltip: "Show the crew in a scene.", title: "Deck", noun: "the deck", starting: "Loading the deck...", aboard: "present", actor: { one: "worker", many: "workers" }, zones: {} },
  places: { working: "", waiting: "", blocked: "", idle: "" },
};
