/** In-app opt-in. Reads and review navigation never create a session or acquire a writer. */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { FEATURE_CAPABILITIES, FeatureCapacitySchema, FeatureReadResultSchema, FeatureSetResultSchema, readFeatureSettings, setFeatureSettings,
  type FeatureReadResult, type FeatureSetInput } from "../shared/feature-settings";
import { CAPABILITY_LABELS, HELP, changedCapabilities, helpSelection, helpState, retainedWork, type HelpKind } from "./feature-settings-model";
import { workflowRequestId } from "./workflow-plans";
import { errorText } from "./format";

export const FEATURE_SETTINGS_QUERY_KEY = ["firstmate", "feature-settings"] as const;
type Review = { kind: HelpKind | "keep" | "capacity"; enabled: boolean; snapshot: FeatureReadResult;
  slots: string; headroom: string; request: FeatureSetInput | null };

function HelpButton({ label, onPress, disabled = false, primary = false, theme }: {
  label: string; onPress(): void; disabled?: boolean; primary?: boolean; theme: PluginTheme;
}) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onPress={onPress}
    style={{ minHeight: 44, maxWidth: "100%", minWidth: 0, justifyContent: "center", paddingHorizontal: 12, paddingVertical: 10,
      borderWidth: 2, borderRadius: 8, borderColor: focused ? theme.colors.accent : primary ? theme.colors.accent : theme.colors.border,
      backgroundColor: primary && !focused ? theme.colors.accent : theme.colors.surface1, opacity: disabled ? 0.5 : 1 }}>
    <Text style={{ color: primary && !focused ? theme.colors.accentForeground : theme.colors.foreground, fontSize: 14, flexShrink: 1 }}>{label}</Text>
  </Pressable>;
}

export function HelpSettings({ theme, home, hostId, online = true }: { theme: PluginTheme; home: string; hostId: string; online?: boolean }) {
  const read = useRpc(readFeatureSettings), set = useRpc(setFeatureSettings), cache = useQueryClient();
  const key = [...FEATURE_SETTINGS_QUERY_KEY, hostId, home];
  const query = useQuery({ queryKey: key, queryFn: async () => FeatureReadResultSchema.parse(await read({ home })),
    refetchInterval: 5000, retry: false });
  const snapshot = query.data;
  const [review, setReview] = useState<Review | null>(null), [open, setOpen] = useState(false), [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const pending = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const text = { color: theme.colors.foreground, fontSize: 14, lineHeight: 21 };
  const note = { ...text, color: theme.colors.foregroundMuted };
  const mutable = !!snapshot && snapshot.state === "ready" && snapshot.writesAvailable && snapshot.runtimeEnforced && snapshot.revision !== null && online && !query.isError;
  // Correct only known legacy capacity. Unknown/corrupt revisions cannot become a new default.
  const capacityRepair = !!snapshot && snapshot.source === "legacy-environment" && snapshot.revision === 0 && snapshot.capacity === null && snapshot.runtimeEnforced && online && !query.isError;
  function begin(kind: Review["kind"], enabled = true) {
    if (!snapshot || pending.current || review?.request) return;
    setReview({ kind, enabled, snapshot, slots: snapshot.capacity ? String(snapshot.capacity.slots) : "",
      headroom: snapshot.capacity ? String(snapshot.capacity.generalHeadroom) : "", request: null });
    setFailure(null); setNotice(null); setOpen(true);
  }
  async function refresh() {
    // Read-only, also safe after a lost reply. No settings mutation retry is automatic.
    void cache.invalidateQueries({ queryKey: ["firstmate", "config", hostId] });
    const result = await query.refetch({ cancelRefetch: false });
    if (!mounted.current) return;
    if (result.isError) setFailure("Can't check help settings right now. Try reading them again; your review is kept.");
    else if (review?.request && result.data?.policy?.updated.requestId === review.request.requestId) {
      setNotice("Your settings are saved and applied here."); setReview(null); setOpen(false); setFailure(null);
    }
  }
  async function reviewCurrent() {
    void cache.invalidateQueries({ queryKey: ["firstmate", "config", hostId] });
    const result = await query.refetch({ cancelRefetch: false });
    if (!mounted.current) return;
    if (result.isError) setFailure("Can't check the current setup. Your original review is kept; try reading settings again.");
    else { setReview(null); setOpen(false); setFailure(null); setNotice("Current settings loaded. Review any change before saving."); }
  }
  const capacity = review && /^\d+$/.test(review.slots) && /^\d+$/.test(review.headroom) ? FeatureCapacitySchema.safeParse({ slots: Number(review.slots), generalHeadroom: Number(review.headroom) }) : null;
  const draft = review ? review.request?.change ?? { requested: review.kind === "keep" || review.kind === "capacity" ? { ...review.snapshot.requested } :
    helpSelection(review.snapshot.requested, review.kind, review.enabled), capacity: review.kind === "capacity" ? (capacity?.success ? capacity.data : null) : review.snapshot.capacity } : null;
  const stale = !!review && !!snapshot && (review.snapshot.homeId !== snapshot.homeId || review.snapshot.revision !== snapshot.revision);
  async function save() {
    if (!review || !draft?.capacity || pending.current || !online || (!review.request && (!(mutable || review.kind === "capacity" && capacityRepair) || stale))) return;
    const request = review.request ?? { home: review.snapshot.homeId, expectedRevision: review.snapshot.revision!, requestId: workflowRequestId(),
      change: { requested: draft.requested, capacity: draft.capacity } };
    setReview({ ...review, request }); pending.current = true; setBusy(true); setFailure(null);
    try {
      const result = FeatureSetResultSchema.parse(await set(request));
      if (result.homeId !== request.home || result.requestId !== request.requestId) throw new Error("The settings reply does not match this review.");
      if (!mounted.current) return;
      // Retire any read begun before the save, then fetch actual running policy. Otherwise
      // a coalesced background read can replace the newly applied state with an old revision.
      await cache.cancelQueries({ queryKey: key, exact: true });
      const applied = await query.refetch();
      void cache.invalidateQueries({ queryKey: ["firstmate"], predicate: q => q.queryKey[1] !== "feature-settings" });
      if (!mounted.current) return;
      if (applied.isError) {
        setFailure("Settings were saved, but their applied state couldn't be checked. Check saved settings before continuing.");
      } else {
        setNotice(applied.data?.revision === result.policy.revision ? "Your settings are saved and applied here." : "Your change was saved. Settings changed again; review the current setup.");
        setReview(null); setOpen(false);
      }
    } catch (error) {
      if (mounted.current) setFailure(`Couldn't confirm this settings save. Your review is kept. Check saved settings, or retry this exact save. ${errorText(error)}`);
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  const title = !review ? "Help settings" : review.kind === "keep" ? "Keep your existing setup" : review.kind === "capacity" ? "Review capacity" :
    review.enabled ? HELP[review.kind].action : `Turn off ${HELP[review.kind].title.toLowerCase()}`;
  return <View style={{ gap: 20 }} testID="help-settings">
    <Text style={note}>Choose the help you want. Changes apply here without restarting. Each new helper still needs a separate review.</Text>
    {query.isPending ? <Text accessibilityLiveRegion="polite" style={note}>Loading help settings…</Text> : null}
    {query.isError ? <Text accessibilityRole="alert" style={text}>Can't read help settings right now. Your existing setup stays in use. Try again.</Text> : null}
    {!online ? <Text accessibilityRole="alert" style={text}>This host is offline. Reconnect, then refresh help settings before saving.</Text> : null}
    {snapshot?.source === "legacy-environment" ? <View style={{ gap: 8 }}>
      <Text style={text}>Using your existing setup</Text>
      <Text style={note}>Your previous choices stay in use until you save here. Saving keeps the exact choices shown or a change you review.</Text>
      <HelpButton theme={theme} label="Keep existing setup" disabled={!mutable || busy || !!review?.request} onPress={() => begin("keep")} />
    </View> : null}
    {snapshot?.state === "held" ? <Text accessibilityRole="alert" style={text}>Help settings couldn't be checked. Refresh settings; if this continues, review Advanced work details before changing anything.</Text> : null}
    {snapshot && !snapshot.runtimeEnforced ? <Text style={text}>This host can't apply help changes yet. Update FirstMate on this host, then refresh settings.</Text> : null}
    {capacityRepair ? <HelpButton theme={theme} label="Review capacity" onPress={() => begin("capacity")} /> : null}
    {snapshot?.state === "ready" && snapshot.runtimeEnforced && !snapshot.writesAvailable ? <Text style={text}>This host can't save help changes right now. Refresh settings before continuing.</Text> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={text}>{notice}</Text> : null}
    {snapshot?.pause ? <Text style={text}>{snapshot.pause}. Saved history and uncertain deliveries are retained.</Text> : null}
    {(Object.keys(HELP) as HelpKind[]).map(kind => <View key={kind} style={{ gap: 8, paddingBottom: 20, borderBottomWidth: 1, borderColor: theme.colors.border }}>
      <Text accessibilityRole="header" style={{ ...text, fontWeight: "600", fontSize: 16 }}>{HELP[kind].title}</Text>
      <Text style={note}>{HELP[kind].description}</Text>
      <Text style={text}>{snapshot ? `${helpState(snapshot, kind)}${query.isError || !online ? " · last checked state" : ""}` : "Checking setup…"}</Text>
      {snapshot?.dependencyRefusals.filter(r => HELP[kind].capabilities.some(k => k === r.capability)).map(r => <Text key={r.capability} style={note}>
        {r.code === "DEPENDENCY_DISABLED" ? "Contextual sending is paused. Review this setup to enable its conversation controls together." : "This help is unavailable. Refresh settings and review Advanced work details."}
      </Text>)}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <HelpButton theme={theme} label={HELP[kind].action} primary={kind === "projects"} disabled={!mutable || busy || !!review?.request} onPress={() => begin(kind)} />
        {snapshot && HELP[kind].owners.some(k => snapshot.requested[k]) ? <HelpButton theme={theme} label={`Turn off ${HELP[kind].title.toLowerCase()}`} disabled={!mutable || busy || !!review?.request} onPress={() => begin(kind, false)} /> : null}
      </View>
    </View>)}
    {review?.request && !open ? <HelpButton theme={theme} label="Review saved settings request" onPress={() => setOpen(true)} /> : null}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <HelpButton theme={theme} label={query.isFetching ? "Refreshing settings…" : "Refresh help settings"} disabled={query.isFetching || busy} onPress={() => { void refresh(); }} />
      <HelpButton theme={theme} label={advanced ? "Hide help details" : "Help details"} onPress={() => setAdvanced(!advanced)} />
    </View>
    {advanced && snapshot ? <View style={{ gap: 8 }}>
      <Text style={text}>Settings for {hostId}</Text><Text selectable style={note}>{snapshot.homeId}</Text>
      <Text style={note}>Source: {snapshot.source} · revision {snapshot.revision ?? "unknown"}. Saved choices override the old environment switches, including when saved off.</Text>
      {FEATURE_CAPABILITIES.map(k => <Text key={k} style={note}>{CAPABILITY_LABELS[k]}: requested {snapshot.requested[k] ? "on" : "off"}, effective {snapshot.state === "held" ? "unavailable" : snapshot.effective[k] ? "on" : "off"}</Text>)}
      <Text style={note}>{retainedWork(snapshot)}</Text>
      {[...snapshot.problems, ...snapshot.inventory.problems, ...snapshot.dependencyRefusals.map(r => r.reason)].map((p, i) => <Text selectable key={i} style={note}>{p}</Text>)}
      {!capacityRepair ? <HelpButton theme={theme} label="Review capacity" disabled={!mutable || busy || !!review?.request} onPress={() => begin("capacity")} /> : null}
    </View> : null}
    <Modal title={title} open={open} onOpenChange={setOpen}><Modal.Content>
      {review && draft ? <View style={{ gap: 16 }}>
        <Text style={text}>{review.kind === "capacity" ? "Review how many plugin slots are available and how many stay reserved for FirstMate." :
          review.kind === "keep" ? "Save your exact existing choices. No additional help will be enabled." : review.enabled ?
          "Turn on these controls now. Creating a helper still needs a separate review of its model, permissions, cumulative limits and opening message." :
          "This pauses new helper setup, messages, turns and work that hasn't been sent. It does not delete helpers, undo work or return spent budget."}</Text>
        {review.kind === "projects" && review.enabled ? <Text style={note}>Project controls and contextual conversations will be available. This does not register projects or grant project permissions. Advanced work details below shows existing reviewed projects and their setup controls. Existing plan help and routine-check choices stay as they are.</Text> : null}
        {review.kind === "plans" && review.enabled ? <Text style={note}>Plan execution, handover controls and contextual conversations will be available. Existing plans keep their current owner until a separate checked handover and the captain's review to connect a helper. Required backups and permissions still need to be checked in Advanced work details.</Text> : null}
        {review.kind === "checks" && review.enabled ? <Text style={note}>Only routine-check controls are enabled. Creating a checks helper, choosing jobs and schedules each need a separate review. This does not change timers. Automatic cleanup is unavailable.</Text> : null}
        <View style={{ gap: 6 }}>
          {review.kind === "keep" ? FEATURE_CAPABILITIES.map(k => <Text key={k} style={text}>{CAPABILITY_LABELS[k]}: keep {review.snapshot.requested[k] ? "on" : "off"}{review.snapshot.requested[k] !== review.snapshot.effective[k] ? " (currently unavailable)" : ""}</Text>) : null}
          {changedCapabilities(review.snapshot.requested, draft.requested).map(k => <Text key={k} style={text}>{CAPABILITY_LABELS[k]}: {draft.requested[k] ? "off → on" : "on → off"}</Text>)}
          {!changedCapabilities(review.snapshot.requested, draft.requested).length ? <Text style={note}>The help choices stay the same.</Text> : null}
        </View>
        {!review.enabled || review.kind === "capacity" ? <View style={{ gap: 8 }}>
          <Text style={text}>{retainedWork(review.snapshot)}</Text>
          <Text style={note}>Calls already in flight can finish. Saved identities, spend, history and uncertain deliveries stay available for checking. Nothing is automatically resent or refunded.</Text>
        </View> : null}
        {review.kind === "capacity" ? <View style={{ gap: 12 }}>
          <Text style={note}>Current capacity: {review.snapshot.capacity ? `${review.snapshot.capacity.slots} slots, ${review.snapshot.capacity.generalHeadroom} reserved for FirstMate` : "unavailable"}.</Text>
          <Text style={text}>Plugin slots</Text><TextInput accessibilityLabel="Plugin slots" keyboardType="number-pad" value={review.slots} editable={!review.request && !busy}
            onChangeText={slots => setReview({ ...review, slots })} style={{ ...text, minHeight: 44, padding: 10, borderWidth: 1, borderRadius: 8, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 }} />
          <Text style={text}>Slots reserved for FirstMate</Text><TextInput accessibilityLabel="Slots reserved for FirstMate" keyboardType="number-pad" value={review.headroom} editable={!review.request && !busy}
            onChangeText={headroom => setReview({ ...review, headroom })} style={{ ...text, minHeight: 44, padding: 10, borderWidth: 1, borderRadius: 8, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 }} />
          {draft.capacity ? <Text style={text}>Proposed: {draft.capacity.slots} slots; {draft.capacity.generalHeadroom} reserved for FirstMate; at most {draft.capacity.slots - draft.capacity.generalHeadroom} for other helpers.</Text> :
            <Text style={text}>Enter whole numbers: at least 2 slots, with at least 1 reserved for FirstMate and at least 1 left for other helpers.</Text>}
          <Text style={note}>More slots allow more helpers to run and may increase spending. Reducing capacity holds new work that no longer fits; it does not stop or remove existing helpers. Provider quota, project allocations and plan limits do not change.</Text>
        </View> : <Text style={note}>Capacity stays at {draft.capacity?.slots ?? "unknown"} slots, with {draft.capacity?.generalHeadroom ?? "unknown"} reserved for FirstMate. Model availability and permission choices are checked during each helper's separate setup; no model or permission is chosen here.</Text>}
        <Text style={note}>This save creates no session, sends no message and changes no plan ownership.</Text>
        {stale ? <Text accessibilityRole="alert" style={text}>Settings changed while this review was open. Keep this review for reference, then cancel and open a new review using the current setup.</Text> : null}
        {failure ? <Text accessibilityRole="alert" style={text}>{failure}</Text> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <HelpButton theme={theme} label={busy ? "Saving settings…" : review.request ? "Retry exact settings save" : "Save help settings"} primary disabled={busy || !online || !draft.capacity || (!review.request && (!(mutable || review.kind === "capacity" && capacityRepair) || stale))} onPress={() => { void save(); }} />
          {review.request ? <HelpButton theme={theme} label="Check saved settings" disabled={busy || query.isFetching} onPress={() => { void refresh(); }} /> : null}
          {review.request ? <HelpButton theme={theme} label="Review current setup" disabled={busy || query.isFetching} onPress={() => { void reviewCurrent(); }} /> : null}
          <HelpButton theme={theme} label={review.request ? "Close review" : "Cancel"} disabled={busy} onPress={() => { setOpen(false); if (!review.request) setReview(null); }} />
        </View>
      </View> : null}
    </Modal.Content></Modal>
  </View>;
}
