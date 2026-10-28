import type { PluginTheme } from "@getpaseo/plugin";
import { useSettings, type SettingsState } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_DECK_SETTING } from "../shared/deck-rpc";
import { displaySettings } from "../shared/settings";
import { useDeckSettings } from "./deck-setting-query";
import { OptionPicker } from "./option-picker";

type Selection = { id: string; revision: string; nextRevision: string | null };

/** Saves the same global document as plugin settings; the fleet follows the saved value. */
export function DeckSceneSwitcher({ theme, compact = false }: { theme: PluginTheme; compact?: boolean }) {
  const display = useSettings(displaySettings);
  return useDeckSceneSwitcher({ theme, compact, display }).picker;
}

/** Keep this controller above the keyed canvas: refreshing a restored scene
 * remounts Home's caption controls, but must not discard the pending choice. */
export function useDeckSceneSwitcher({ theme, compact = false, enabled = true, display }: {
  theme: PluginTheme; compact?: boolean; enabled?: boolean; display: SettingsState<typeof displaySettings.schema>;
}) {
  const installed = useDeckSettings(enabled);
  const toast = useToast();
  const selection = useRef<Selection | null>(null);
  const refreshing = useRef(false);
  const [busy, setBusy] = useState(false);
  const latest = useRef(display);
  latest.current = display;
  const mounted = useRef(true);
  const [retry, setRetry] = useState<Selection | null>(null);
  const pendingRetry = useRef(retry);

  // Surface switches can leave and return before an async read completes (or
  // even within one render). Invalidate the attempt itself, not just enabled.
  const cancel = useCallback(() => {
    selection.current = null;
    pendingRetry.current = null;
    setRetry(null);
    setBusy(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      selection.current = null;
      pendingRetry.current = null;
    };
  }, []);

  useEffect(() => {
    if (!enabled && selection.current !== null) {
      if (display.status !== "ready")
        toast.error("The scene was not saved. Please try again.");
      cancel();
    }
  }, [enabled, display.status, toast, cancel]);

  // Revisions are opaque. Pin the first changed snapshot observed by this
  // attempt; a later restore must not become a new base for the same choice.
  useEffect(() => {
    const attempt = selection.current;
    if (attempt !== null && display.status === "ready" && display.revision !== attempt.revision && attempt.nextRevision === null)
      attempt.nextRevision = display.revision;
  }, [display]);

  // Restoring a settings file bypasses the host's change notification. Reread
  // while Deck is mounted so its scene and other display preferences catch up.
  const pollSeconds = display.status === "ready" ? display.values.pollSeconds : 5;
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      if (selection.current !== null || refreshing.current) return;
      refreshing.current = true;
      void latest.current.reload().catch(() => {}).finally(() => { refreshing.current = false; });
    }, pollSeconds * 1000);
    return () => clearInterval(timer);
  }, [enabled, pollSeconds]);

  function finish(attempt: Selection): void {
    if (selection.current !== attempt) return;
    selection.current = null;
    if (mounted.current) setBusy(false);
  }

  // reload() returns void, not the fresh snapshot. Retry from the next committed
  // render, merging only the requested scene into that document. Claim once even
  // when effects are replayed, and never turn another failure into a retry loop.
  useEffect(() => {
    if (retry === null || pendingRetry.current !== retry) return;
    pendingRetry.current = null;
    setRetry(null);
    if (selection.current !== retry) return;
    void (async () => {
      try {
        if (display.status !== "ready") {
          toast.error("The scene was not saved. Please try again.");
          return;
        }
        if (!enabled) return;
        if (display.revision !== retry.nextRevision ||
          !installed.data?.some(pack => pack.id === retry.id && pack.compatible)) {
          toast.error("The scene was not saved. Please try again.");
        } else if (display.values.deckSetting !== retry.id &&
          !await display.save({ ...display.values, deckSetting: retry.id }, display.revision) && selection.current === retry) {
          toast.error("The scene was not saved. Please try again.");
        }
      } catch {
        if (selection.current === retry) toast.error("The scene was not saved. Please try again.");
      } finally { finish(retry); }
    })();
  }, [retry, display, installed.data, toast, enabled]);

  async function select(deckSetting: string): Promise<void> {
    if (
      display.status !== "ready" ||
      !enabled ||
      selection.current !== null ||
      deckSetting === display.values.deckSetting ||
      !installed.data?.some((pack) => pack.id === deckSetting && pack.compatible)
    )
      return;
    const attempt: Selection = { id: deckSetting, revision: display.revision, nextRevision: null };
    selection.current = attempt;
    setBusy(true);
    try {
      const ok = await display.save({ ...display.values, deckSetting }, display.revision);
      if (selection.current !== attempt) return;
      if (ok) { finish(attempt); return; }
      // The SDK reports all refusals as false. Only a changed, readable revision
      // after reload permits the one retry; other failures remain visible.
      await display.reload();
      if (selection.current !== attempt) return;
      pendingRetry.current = attempt;
      setRetry(attempt);
    } catch {
      if (selection.current === attempt) toast.error("The scene was not saved. Please try again.");
      finish(attempt);
    }
  }

  return { cancel, picker: (
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
  ) };
}
