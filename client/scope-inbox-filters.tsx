import type { PluginTheme } from "@getpaseo/plugin";
import { Text, View } from "react-native";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import type { ScopeInboxFilter } from "../shared/scope-inbox";
import { OptionPicker, type PickerOption } from "./option-picker";
import { decisionCountText } from "./needs-you-state";
import { useDecisionReadState } from "./decision-read-context";
export function ScopeInboxFilters({ snapshot, value, onChange, theme, compact }: { snapshot: NeedsYouSnapshot; value: ScopeInboxFilter;
  onChange(value: ScopeInboxFilter): void; theme: PluginTheme; compact: boolean }) {
  const read = useDecisionReadState();
  const kinds = ["all", "general", "project", "plan", "maintenance"] as const;
  const label = (kind: string) => ({ all: "All projects", general: "FirstMate", project: "Projects", plan: "Plans", maintenance: "Routine checks" })[kind] ?? kind;
  const options: PickerOption[] = kinds.map(kind => ({ value: JSON.stringify({ kind }), label: label(kind), ...(kind === "project" ? { detail: "Projects and their plans" } : {}) }));
  for (const scope of snapshot.scopeDirectory ?? []) if (scope.kind === "project" || scope.kind === "plan")
    options.push({ value: JSON.stringify({ kind: scope.kind, id: scope.id }), label: scope.title, detail: scope.kind === "plan" ? "Plan" : "Project and its plans" });
  return <View testID="scope-inbox-filters" style={{ gap: 8 }}>
    <OptionPicker inline roomy label="Show" title="Filter Needs you" value={JSON.stringify(value)} options={options} onSelect={s => onChange(JSON.parse(s) as ScopeInboxFilter)} theme={theme} compact={compact} />
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{decisionCountText(snapshot, false, read)} across all projects. The total always includes all projects.</Text>
  </View>;
}
