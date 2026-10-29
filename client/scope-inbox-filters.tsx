import type { PluginTheme } from "@getpaseo/plugin";
import { Text, View } from "react-native";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import type { ScopeInboxFilter } from "../shared/scope-inbox";
import { OptionPicker, type PickerOption } from "./option-picker";
export function ScopeInboxFilters({ snapshot, value, onChange, theme, compact }: { snapshot: NeedsYouSnapshot; value: ScopeInboxFilter;
  onChange(value: ScopeInboxFilter): void; theme: PluginTheme; compact: boolean }) {
  const kinds = ["all", "general", "project", "plan", "maintenance"] as const;
  const label = (kind: string) => kind === "all" ? "All scopes" : kind[0]!.toUpperCase() + kind.slice(1);
  const options: PickerOption[] = kinds.map(kind => ({ value: JSON.stringify({ kind }), label: label(kind), ...(kind === "project" ? { detail: "Projects and their plans" } : {}) }));
  for (const scope of snapshot.scopeDirectory ?? []) if (scope.kind === "project" || scope.kind === "plan")
    options.push({ value: JSON.stringify({ kind: scope.kind, id: scope.id }), label: `${label(scope.kind)}: ${scope.title}`, detail: scope.planId ?? scope.id });
  return <View testID="scope-inbox-filters" style={{ gap: 8 }}>
    <OptionPicker inline label="Inbox scope" title="Filter Needs you" value={JSON.stringify(value)} options={options} onSelect={s => onChange(JSON.parse(s) as ScopeInboxFilter)} theme={theme} compact={compact} />
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Global Needs you: {snapshot.actionCount ?? "count unavailable"}{snapshot.scopedComplete === false || snapshot.freshness.status !== "fresh" ? " · incomplete or retained count" : ""}. Coming up is excluded. Unscoped quarantines remain visible in every filter.</Text>
  </View>;
}
