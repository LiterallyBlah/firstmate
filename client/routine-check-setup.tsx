/** Separate, optional settings review. Reads, cancellation and inventory have no model effects. */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import { readMaintenance, readMaintenanceTimers, MaintenanceCensusSchema, MaintenanceRuntimeSnapshotSchema,
  type MaintenanceRuntimeSnapshot } from "../shared/maintenance-runtime";
import { MaintenanceAdmissionConfirmation } from "./maintenance-ownership";
import { SetupButton } from "./setup-button";

type Owner = MaintenanceRuntimeSnapshot["owners"][number];
export function RoutineCheckSetup({ theme, compact, homeId, hostId, online, canEnable, onEnable, onClose }: {
  theme: PluginTheme; compact: boolean; homeId: string; hostId: string; online: boolean; canEnable: boolean; onEnable(): void; onClose(): void;
}) {
  const read = useRpc(readMaintenance);
  const query = useQuery({ queryKey: ["firstmate", "routine-check-setup", hostId, homeId], retry: false, refetchInterval: 5000,
    queryFn: async () => {
      const data = MaintenanceRuntimeSnapshotSchema.parse(await read({}));
      if (data.homeId !== homeId) throw new Error("FirstMate's home changed. Reopen settings for the current home.");
      return data;
    } });
  const [admission, setAdmission] = useState<Owner | "new" | null>(null), [details, setDetails] = useState(false);
  const data = query.data, mutable = !!data && online && !query.isError && data.enabled && data.freshness !== "held" && !data.problems.length;
  const text = { color: theme.colors.foreground, fontSize: 14, lineHeight: 21 }, note = { ...text, color: theme.colors.foregroundMuted };
  return <>
    <Modal title="Set up routine checks" open={!admission} onOpenChange={open => { if (!open) onClose(); }}><Modal.Content>
      <View testID="routine-check-setup" style={{ gap: 16 }}>
        <Text style={text}>Checks report problems for review. Automatic cleanup is unavailable.</Text>
        <Text style={note}>Project mates and plan help work without routine checks. Creating a checks conversation does not create jobs, change timers or repair projects.</Text>
        <Text accessibilityRole="header" style={{ ...text, fontSize: 16, fontWeight: "600" }}>Review before anything starts</Text>
        <Text style={note}>Choose a name, model, permissions and total turn limit. Jobs, computers and schedules need a separate checked setup.</Text>
        {query.isPending ? <Text accessibilityLiveRegion="polite" style={note}>Loading routine checks…</Text> : null}
        {query.isError ? <Text accessibilityRole="alert" style={text}>Can't check routine checks right now. Your saved setup stays in place. Reconnect and refresh before creating a conversation.</Text> : null}
        {!online ? <Text accessibilityRole="alert" style={text}>This host is offline. Reconnect and refresh before continuing.</Text> : null}
        {data?.pause ? <Text style={note}>{data.pause}</Text> : null}
        {data?.freshness === "held" || data?.problems.length ? <Text accessibilityRole="alert" style={text}>Some saved checks couldn't be checked. Review Details before continuing.</Text> : null}
        {data?.owners.map(owner => <View key={owner.scopeId} style={{ gap: 8 }}>
          <Text style={text}>{owner.admission?.name ?? "Checks conversation"} · {owner.state === "active" && owner.opening === "succeeded" ? "Ready" : "Setup needs review"}</Text>
          <Text style={note}>{owner.sessions} session reserved · {owner.turns} turns reserved{owner.uncertain ? ` · ${owner.uncertain} operations need checking` : ""}</Text>
          {owner.admission && owner.opening !== "succeeded" ? <SetupButton theme={theme} label={`Review saved setup for ${owner.admission.name}`} disabled={!mutable}
            onPress={() => setAdmission(owner)} /> : null}
        </View>)}
        {data && !data.enabled ? <SetupButton theme={theme} label="Review routine-check opt-in" disabled={!canEnable || !online || query.isError} onPress={onEnable} /> : null}
        {data?.enabled ? <SetupButton theme={theme} label="Review checks profile" disabled={!mutable} onPress={() => setAdmission("new")} /> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <SetupButton theme={theme} label="Details" onPress={() => setDetails(!details)} />
          <SetupButton theme={theme} label={query.isFetching ? "Refreshing checks…" : "Refresh checks"} disabled={query.isFetching} onPress={() => { void query.refetch({ cancelRefetch: false }); }} />
          <SetupButton theme={theme} label="Back to settings" onPress={onClose} />
        </View>
        {details ? <RoutineCheckInventory theme={theme} hostId={hostId} homeId={homeId} data={data} /> : null}
      </View>
    </Modal.Content></Modal>
    {admission ? <MaintenanceAdmissionConfirmation key={admission === "new" ? "new" : admission.scopeId} theme={theme} compact={compact} homeId={homeId}
      owner={admission === "new" ? null : admission} stale={!mutable} onClose={() => setAdmission(null)} onRead={() => { void query.refetch({ cancelRefetch: false }); }} /> : null}
  </>;
}

/** Inventory is read-only, including disabled and unknown-owner timers. */
export function RoutineCheckInventory({ theme, hostId, homeId, data }: { theme: PluginTheme; hostId: string; homeId: string; data: MaintenanceRuntimeSnapshot | undefined }) {
  const read = useRpc(readMaintenanceTimers);
  const timers = useQuery({ queryKey: ["firstmate", "routine-check-timers", hostId, homeId], retry: false, queryFn: async () => {
    const next = MaintenanceCensusSchema.parse(await read({}));
    if (next.homeId !== homeId) throw new Error("Timer inventory belongs to another home");
    return next;
  } });
  const text = { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 20 };
  return <View style={{ gap: 8 }}>
    <Text style={text}>Jobs, resource changes and timer retirement keep their existing checked flows. This view changes none of them.</Text>
    {data?.problems.map(p => <Text selectable key={p} style={text}>{p}</Text>)}
    {data?.owners.map(o => <Text selectable key={o.scopeId} style={text}>Scope {o.scopeId} · epoch {o.epoch} · agent {o.agentId ?? "not recorded"} · opening {o.opening ?? "not recorded"}</Text>)}
    {data?.jobs.map(j => <Text selectable key={j.id} style={text}>{j.name} · {j.state} · {j.mode} · {j.hosts.join(", ")} · {j.schedule.at} {j.schedule.zone}</Text>)}
    {data?.hosts.map(h => <Text selectable key={`${h.occurrenceId}:${h.hostId}`} style={text}>Host {h.hostId} · {h.state}</Text>)}
    {data?.incidents.map(i => <Text selectable key={i.id} style={text}>{i.detail}</Text>)}
    {data?.reservations.map(r => <Text selectable key={r.id} style={text}>Resource {r.id} · {r.state}</Text>)}
    {data ? <Text selectable style={text}>{data.cleanup.reason}{data.cleanup.conditions.map(c => ` · ${c.id}: ${c.satisfied ? "met" : c.reasons.join("; ")}`).join("")}</Text> : null}
    {timers.isPending ? <Text accessibilityLiveRegion="polite" style={text}>Loading timer inventory…</Text> : null}
    {timers.isError ? <Text accessibilityRole="alert" style={text}>Timer inventory couldn't be checked. Close and reopen Details to read it again.</Text> : null}
    {timers.data ? <>
      <Text style={text}>{timers.data.complete ? "Timer inventory" : "Incomplete timer inventory"} · captured {timers.data.capturedAt}</Text>
      {timers.data.problems.map(p => <Text key={p} selectable style={text}>{p}</Text>)}
      {timers.data.rows.map(t => <Text key={t.id} selectable style={text}>{t.name} · {t.enabled ? "enabled" : "disabled"} · {t.schedule} · {t.zone} · owner {t.owner} · {t.disposition}</Text>)}
    </> : null}
  </View>;
}
