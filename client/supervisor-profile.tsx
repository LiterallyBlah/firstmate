/** Shared native form used by plan, project, maintenance and Supervisor reviews. */
import type { PluginTheme } from "@getpaseo/plugin";
import { Text, View } from "react-native";
import { profileProblem, type SupervisorCatalog, type SupervisorProfile } from "../shared/supervisor-profile";
import { OptionPicker } from "./option-picker";
export function SupervisorProfileFields({ theme, compact, catalog, profile, onChange, disabled = false, observer = false, modelLabel = "Model", permissionLabel = "Permissions" }: {
  theme: PluginTheme; compact: boolean; catalog: SupervisorCatalog; profile: SupervisorProfile | null;
  onChange(profile: SupervisorProfile): void; disabled?: boolean; observer?: boolean; modelLabel?: string; permissionLabel?: string;
}) {
  const model = catalog.find(m => m.provider === profile?.provider), problem = observer ? profileProblem(profile, catalog, true) : null;
  return <View style={{ gap: 12, minWidth: 0 }}>
    <OptionPicker roomy theme={theme} compact={compact} label={modelLabel} title="Choose a model" value={profile?.provider ?? ""}
      options={catalog.map(m => ({ label: m.label, value: m.provider }))} disabled={disabled} onSelect={provider => {
        const next = catalog.find(m => m.provider === provider);
        onChange({ provider, modeId: "", ...(next?.thinking?.some(t => t.id === "high") ? { thinkingOptionId: "high" } : {}) });
      }} />
    <OptionPicker roomy theme={theme} compact={compact} label={permissionLabel} title="Choose permissions" value={profile?.modeId ?? ""}
      options={(model?.modes ?? []).map(m => ({ label: `${m.label} (${m.id})`, value: m.id, ...(observer && m.id !== "read-only" ? { disabled: true } : {}) }))}
      disabled={disabled || !model} onSelect={modeId => onChange({ ...profile!, modeId })} />
    {model?.thinking?.length ? <OptionPicker roomy theme={theme} compact={compact} label="Reasoning" title="Choose reasoning" value={profile?.thinkingOptionId ?? ""}
      options={model.thinking.map(t => ({ label: t.label, value: t.id }))} disabled={disabled}
      onSelect={thinkingOptionId => onChange({ ...profile!, thinkingOptionId })} /> : null}
    {problem ? <Text accessibilityRole="alert" style={{ color: theme.colors.foreground, fontSize: 14, lineHeight: 21 }}>{problem}</Text> : null}
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 20 }}>Settings are captured for this Supervisor. Reasoning uses the explicit selection shown here. Permissions grant no plan, merge or deployment authority.</Text>
  </View>;
}
