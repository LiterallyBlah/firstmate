import type { PluginTheme } from "@getpaseo/plugin";
import { useSettings } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useRef, useState } from "react";
import { DEFAULT_DECK_SETTING } from "../shared/deck-rpc";
import { displaySettings } from "../shared/settings";
import { useDeckSettings } from "./deck-setting-query";
import { OptionPicker } from "./option-picker";

/** Saves the same global document as plugin settings; the fleet follows the saved value. */
export function DeckSceneSwitcher({ theme, compact = false }: { theme: PluginTheme; compact?: boolean }) {
  const display = useSettings(displaySettings);
  const installed = useDeckSettings();
  const toast = useToast();
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);

  async function select(deckSetting: string): Promise<void> {
    if (
      display.status !== "ready" ||
      saving.current ||
      deckSetting === display.values.deckSetting ||
      !installed.data?.some((pack) => pack.id === deckSetting && pack.compatible)
    )
      return;
    saving.current = true;
    setBusy(true);
    try {
      const ok = await display.save({ ...display.values, deckSetting }, display.revision);
      if (!ok) toast.error("The scene was not saved. Please try again.");
    } catch {
      toast.error("The scene was not saved. Please try again.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <OptionPicker
      inline
      label="Scene"
      title="Deck scene"
      hint={
        installed.isError
          ? "The installed scenes could not be refreshed. This choice applies to the whole fleet."
          : "Choose a scene for the whole fleet. Your choice is saved across sessions."
      }
      value={display.status === "ready" ? display.values.deckSetting : DEFAULT_DECK_SETTING}
      options={(installed.data ?? []).map((pack) => ({
        label: pack.name,
        value: pack.id,
        disabled: !pack.compatible,
        detail: pack.compatible ? pack.version : (pack.reason ?? "Needs a newer FirstMate"),
        ...(pack.preview === null ? {} : { preview: `data:image/png;base64,${pack.preview}` }),
      }))}
      disabled={busy || display.status !== "ready" || installed.data === undefined}
      theme={theme}
      compact={compact}
      onSelect={(id) => {
        void select(id);
      }}
    />
  );
}
