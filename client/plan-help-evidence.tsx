/** Ordinary evidence review: real inventory, accepted sources and a selected saved rollback report. */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { readHandoverEvidence } from "../shared/plan-help";
import type { MigrationCommand } from "../shared/supervision-activation";
import { HelpButton } from "./plan-help";
type Evidence = NonNullable<Extract<MigrationCommand, { op: "prepare" | "resume" }>["evidence"]>;
export function PlanHelpEvidence({ theme, homeId, plan, reviewHash, disabled, onChoose }: {
  theme: PluginTheme; homeId: string; plan: string; reviewHash: string; disabled: boolean;
  onChoose(evidence: Evidence): void;
}) {
  const read = useRpc(readHandoverEvidence), [open, setOpen] = useState(false), [folder, setFolder] = useState("data"), [path, setPath] = useState<string>();
  const [inventory, setInventory] = useState<string>(), [policy, setPolicy] = useState<string>(), [rollback, setRollback] = useState<string>();
  const query = useQuery({ queryKey: ["firstmate", "handover-evidence", homeId, plan, reviewHash, folder, path],
    queryFn: () => read({ homeId, plan, folder, ...(path ? { rollbackPath: path } : {}) }), enabled: open, retry: false });
  const data = query.data, foreground = { color: theme.colors.foreground }, muted = { color: theme.colors.foregroundMuted };
  const held = disabled || query.isFetching || !!query.error || !data || data.homeId !== homeId || data.reviewHash !== reviewHash || data.problems.length > 0 || !data.inventory || data.inventory.problems.length > 0 || !data.policy;
  return <View style={{ gap: 8 }}>
    <Text accessibilityRole="header" style={foreground}>Review the handover evidence</Text>
    <Text style={muted}>Check pending deliveries and the project's already accepted permissions. Then choose a saved report showing which retained FirstMate build can safely recover this handover.</Text>
    <HelpButton theme={theme} label={open ? "Refresh handover evidence" : "Check handover evidence"} disabled={disabled || query.isFetching} onPress={() => { if (open) void query.refetch(); else setOpen(true); }} />
    {open ? <>
      {query.isPending ? <Text style={muted}>Checking saved evidence…</Text> : null}
      {query.error ? <Text accessibilityRole="alert" style={foreground}>Evidence couldn't be checked. Refresh handover evidence to try again. Your current owner is kept.</Text> : null}
      {data ? <>
        {data.problems.map(p => <Text key={p} style={foreground}>{p}</Text>)}
        <Text accessibilityRole="header" style={foreground}>Pending deliveries</Text>
        {data.inventory?.summary.map(s => <Text key={s} style={muted}>{s}</Text>)}
        {data.inventory?.problems.map(p => <Text key={p} style={foreground}>{p}</Text>)}
        <HelpButton theme={theme} label="I reviewed pending deliveries" disabled={held} onPress={() => setInventory(data.inventory?.hash)} />
        <Text accessibilityRole="header" style={foreground}>Accepted project permissions</Text>
        <Text style={muted}>These sources were accepted in project setup. This review adds no permission.</Text>
        {data.policy?.sources.map(s => <View key={s.path} style={{ gap: 4 }}><Text style={foreground}>{s.path} · lines {s.lines}</Text><Text selectable style={muted}>{s.content}</Text></View>)}
        <HelpButton theme={theme} label="I reviewed accepted permissions" disabled={held} onPress={() => setPolicy(data.policy?.hash)} />
        <Text accessibilityRole="header" style={foreground}>Choose a rollback report</Text>
        <Text style={muted}>The report must identify the retained build and its location, confirm it supports this handover's saved history, and include tested recovery evidence. Reading a file does not certify its claims. If you cannot confirm them, keep the current owner.</Text>
        <Text style={muted}>No report yet? Return to FirstMate and ask for a rollback-readiness report with that evidence, saved in Home files. Return here to choose and review it. No terminal or restart is needed.</Text>
        <Text style={foreground}>Home files / {data.folder || "Home"}</Text>
        {folder ? <HelpButton theme={theme} label="Up one folder" disabled={disabled} onPress={() => setFolder(folder.split("/").slice(0, -1).join("/"))} /> : null}
        <ScrollView style={{ maxHeight: 180 }} contentContainerStyle={{ gap: 6 }}>
          {data.entries.map(e => <HelpButton key={e.path} theme={theme} label={`${e.kind === "dir" ? "Open folder" : "Read"} ${e.name}`} disabled={disabled || query.isFetching} onPress={() => { if (e.kind === "dir") setFolder(e.path); else { setPath(e.path); setRollback(undefined); } }} />)}
          {!data.entries.length ? <Text style={muted}>No text reports in this folder. Use Up one folder to choose another.</Text> : null}
        </ScrollView>
        {data.rollback ? <View style={{ gap: 8 }}>
          <Text style={foreground}>Selected report: {data.rollback.path}</Text>
          <ScrollView style={{ maxHeight: 240 }}><Text selectable style={foreground}>{data.rollback.content}</Text></ScrollView>
          <Text style={muted}>By choosing this report, you confirm you reviewed its build, location and recovery evidence. Paseo cannot verify who makes this confirmation.</Text>
          <HelpButton theme={theme} label="Use this rollback report" disabled={held} onPress={() => setRollback(data.rollback?.hash)} />
        </View> : <Text style={muted}>Choose a rollback report above before continuing.</Text>}
        <HelpButton theme={theme} label="Use reviewed evidence" disabled={held || !data.rollback || inventory !== data.inventory?.hash || policy !== data.policy?.hash || rollback !== data.rollback?.hash}
          onPress={() => { if (!held && data.inventory && data.policy && data.rollback) onChoose({ inventory: data.inventory.hash, policy: data.policy.hash, rollback: { path: data.rollback.path, hash: data.rollback.hash } }); }} />
      </> : null}
    </> : null}
  </View>;
}
