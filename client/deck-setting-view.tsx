import { useEffect, useState, type ComponentProps } from "react";
import { Text, View } from "react-native";
import { DEFAULT_DECK_SETTING } from "../shared/deck-rpc";
import { resolveDeckSetting } from "./deck-setting";
import { useDeckSettings } from "./deck-setting-query";
import { ShipDeckView } from "./ship-deck";

/** Selection and fallback surround the engine; the engine receives just one resolved pack id. */
export function SelectedDeckView({ setting = DEFAULT_DECK_SETTING, ...props }: Omit<ComponentProps<typeof ShipDeckView>, "onFailure">) {
  const installed = useDeckSettings();
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => setFailed(null), [setting]);
  const selected = resolveDeckSetting({ deckSetting: setting }, { kind: "fleet" }, installed.data);
  const unavailable = installed.isError && installed.data === undefined;
  const fallback = unavailable || failed === setting;
  const id = fallback ? DEFAULT_DECK_SETTING : selected.id;
  const notice = failed === setting ? `The setting "${setting}" could not start. Showing the default setting.`
    : unavailable ? "Deck settings could not be checked. Showing the default setting." : selected.notice;
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      {notice === null ? null : <Text accessibilityRole="alert" style={{ color: props.theme.colors.statusWarning, fontSize: 12, marginHorizontal: 12, marginTop: 12 }}>{notice}</Text>}
      {id === null ? <Text style={{ color: props.theme.colors.foregroundMuted, padding: 12 }}>Loading deck settings...</Text> : (
        <ShipDeckView {...props} setting={id} onFailure={() => { if (id !== DEFAULT_DECK_SETTING) setFailed(setting); }} />
      )}
    </View>
  );
}
