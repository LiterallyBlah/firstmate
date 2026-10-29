/** One review and explicit confirmation; status reads never continue a child. */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { ProjectSetupCatalog, ProjectSetupChoices } from "../shared/project-setup";
import { cancelProjectBatch, commitProjectBatch, continueProjectBatch, previewProjectBatch, readProjectBatches,
  ProjectBatchPreviewSchema, ProjectBatchStatusSchema, type ProjectBatchCommit, type ProjectBatchPreview } from "../shared/project-setup-batch";
import { permissionPower, SetupAction, type ProjectSetupProps } from "./project-setup";
import { errorText } from "./format";
import { HelpSettings } from "./help-settings";

/** Retained by the setup destination while moving between the chooser and review. */
export type ProjectBatchDraft = { batchId: string; review: ProjectBatchPreview | null; exact: ProjectBatchCommit | null };

export function ProjectBatchPanel({ theme, home, hostId, online = true, navigation, onClose, onBack, onRefresh, data, choices, draft }: {
  theme: PluginTheme; home: string; hostId: string; online?: boolean; navigation?: ProjectSetupProps["navigation"]; onClose(): void;
  onBack(): void; onRefresh(): Promise<void>; data?: ProjectSetupCatalog | undefined; choices?: ProjectSetupChoices[]; draft: { current: ProjectBatchDraft };
}) {
  const preview = useRpc(previewProjectBatch), commit = useRpc(commitProjectBatch), status = useRpc(readProjectBatches), resume = useRpc(continueProjectBatch), cancel = useRpc(cancelProjectBatch);
  const attempt = draft.current;
  const [review, setReviewState] = useState<ProjectBatchPreview | null>(attempt.exact ? attempt.review : null), [busy, setBusy] = useState(false), [failure, fail] = useState<string | null>(null), [details, showDetails] = useState(false);
  const gate = useRef(false), mounted = useRef(true);
  function setReview(next: ProjectBatchPreview | null) { attempt.review = next; setReviewState(next); }
  const started = useRef(false), [capacityOpen, openCapacity] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const saved = useQuery({ queryKey: ["firstmate", "project-batches", hostId, home], queryFn: async () => ProjectBatchStatusSchema.array().parse(await status({ homeId: home })), retry: false, refetchInterval: busy ? 1000 : false });
  const text = { color: theme.colors.foreground, fontSize: 14, lineHeight: 22 }, note = { ...text, color: theme.colors.foregroundMuted };
  async function act(work: () => Promise<void>) {
    if (!online || gate.current) return; gate.current = true; setBusy(true); fail(null);
    try { await work(); } catch (e) { if (mounted.current) fail(`Check saved setup before continuing. ${errorText(e)}`); }
    finally { await saved.refetch(); await onRefresh(); gate.current = false; if (mounted.current) setBusy(false); }
  }
  async function recheck() {
    if (!choices) return;
    const before = await saved.refetch({ cancelRefetch: false });
    if (before.isError || !before.data) throw Error("Saved setup couldn't be checked. Keep the original confirmation and try checking again.");
    if (before.data.some(s => s.commit.manifest.batchId === attempt.batchId)) return;
    const next = ProjectBatchPreviewSchema.parse(await preview({ homeId: home, batchId: attempt.batchId, choices }));
    const after = await saved.refetch({ cancelRefetch: false });
    if (after.isError || !after.data) throw Error("Saved setup couldn't be checked. Keep the original confirmation and try checking again.");
    if (after.data.some(s => s.commit.manifest.batchId === attempt.batchId)) return;
    // Rechecking changes no identity. A late original confirmation still owns this same batch
    // ID and must either match or conflict at publication; it cannot create a second batch.
    attempt.exact = null; if (mounted.current) setReview(next);
  }
  const current = saved.data?.find(s => s.commit.manifest.batchId === attempt.batchId), disabled = busy || !online || saved.isError;
  const reviewedNames = attempt.exact?.manifest.children.map(c => c.review.name) ?? choices?.map(c => c.name) ?? [];
  useEffect(() => {
    if (choices && !started.current) { started.current = true; void act(attempt.exact ? async () => {} : recheck); }
  }, [choices]);
  if (capacityOpen) return <HelpSettings theme={theme} home={home} hostId={hostId} online={online} capacityReview={{ onClose: () => { openCapacity(false); setReview(null); } }} />;
  return <View style={{ gap: 16 }}>
    {choices && !current ? <>
      <Text style={{ ...text, fontWeight: "600", fontSize: 18 }}>Review selected project mates</Text>
      <Text style={text}>{reviewedNames.length} selected: {reviewedNames.join(", ")}. Each keeps its own model, permissions, allocation and total turn limit.</Text>
      {!review ? <Text style={note}>Check the whole selection before creating anything. FirstMate's reserved capacity and every project's existing spending limits stay in place.</Text> : null}
      {review?.capacity ? <Text style={text}>{reviewedNames.length} selected; room for {review.capacity.available}. FirstMate retains {review.capacity.generalHeadroom} of {review.capacity.slots} plugin slots. Provider quota is unknown.</Text> : null}
      {review?.reasons.map((r, i) => <Text key={i} style={text}>{review.capacity && r.startsWith(`${reviewedNames.length} selected; room for `) ? "Choose fewer projects or review capacity before creating mates." : r}</Text>)}
      {review && data ? <BatchReview theme={theme} data={data} review={review} /> : null}
      {review?.commit ? <Text style={text}>What starts now: {reviewedNames.length} separate project conversations and {reviewedNames.length} opening messages. Each project keeps its own result if another needs a change. Plan execution and release actions keep their separate approvals. Your FirstMate chat stays where it is.</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {!review || review.reasons.length || failure || attempt.exact ? <SetupAction theme={theme} label="Re-check selected projects" disabled={disabled} onPress={() => { void act(recheck); }} /> : null}
        {review?.commit ? <SetupAction theme={theme} primary label={`Create ${reviewedNames.length} project ${reviewedNames.length === 1 ? "mate" : "mates"}`} disabled={disabled || !!attempt.exact} onPress={() => { void act(async () => {
          const input = attempt.exact ?? review.commit!; attempt.exact = input;
          await commit(input);
        }); }} /> : null}
        {review?.capacity && choices.length > review.capacity.available ? <SetupAction theme={theme} label="Review capacity" disabled={busy} onPress={() => openCapacity(true)} /> : null}
      </View>
      {attempt.exact ? <Text style={text}>The original confirmation is kept. Check saved setup after a lost reply. Re-checking keeps this batch's identity and never changes an already saved request.</Text> : null}
      {attempt.exact && !current ? <SetupAction theme={theme} label="Check original confirmation" disabled={disabled} onPress={() => { void act(async () => { await commit(attempt.exact!); }); }} /> : null}
    </> : null}
    {choices ? <SetupAction theme={theme} label="Back to projects" disabled={busy} onPress={onBack} /> : null}
    {failure ? <Text accessibilityRole="alert" style={text}>{failure}</Text> : null}
    {saved.isError ? <Text style={text}>Saved batches couldn't be checked. Reconnect and check saved setup before starting another batch.</Text> : null}
    {saved.data?.map(s => <View key={s.commit.manifest.batchId} style={{ gap: 14 }}>
      <Text style={{ ...text, fontSize: 18, fontWeight: "600" }}>Project mate setup · {s.children.length} projects</Text>
      {s.problems.map((p, i) => <Text key={i} style={text}>{p}</Text>)}
      {s.children.map(child => <View key={child.requestId} style={{ gap: 6, paddingBottom: 14, borderBottomWidth: 1, borderColor: theme.colors.border }}>
        <Text accessibilityLiveRegion="polite" style={{ ...text, fontWeight: "600" }}>{child.name} · {({ ready: "Ready", waiting: "Waiting to start", "needs-change": "Needs a change", checking: "Checking whether setup finished", cancelled: "Cancelled" })[child.state]}</Text>
        {child.reason !== "Ready" ? <Text style={note}>{child.reason}</Text> : null}
        <Text style={note}>{child.sessions} {child.sessions === 1 ? "session" : "sessions"} · {child.turns} of {s.commit.manifest.children.find(c => c.requestId === child.requestId)?.review.limits.supervisorTurns} turns used.</Text>
        {child.state === "ready" && child.agentId && navigation ? <SetupAction theme={theme} label={`Open ${child.name} conversation`} onPress={() => { navigation.openAgent({ agentId: child.agentId!, ...(hostId === "local" ? {} : { serverId: hostId }) }); onClose(); }} /> : null}
      </View>)}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {s.children.some(c => c.canContinue) ? <SetupAction theme={theme} label="Continue saved batch" disabled={disabled} onPress={() => { void act(async () => {
          await resume({ homeId: home, batchId: s.commit.manifest.batchId });
        }); }} /> : null}
        {s.children.some(c => c.canCancel) ? <SetupAction theme={theme} label="Cancel waiting projects" disabled={disabled} onPress={() => { void act(async () => {
          await cancel({ homeId: home, batchId: s.commit.manifest.batchId });
        }); }} /> : null}
      </View>
      {s.children.some(c => c.canCancel || c.state === "cancelled") ? <Text style={note}>Cancellation stops only projects whose admission has not started. Existing work, uncertain operations, identity and spend are kept.</Text> : null}
      <SetupAction theme={theme} label={details ? "Hide saved setup details" : "Saved setup details"} onPress={() => showDetails(!details)} />
      {details ? <Text selectable style={note}>{JSON.stringify(s.commit, null, 2)}</Text> : null}
    </View>)}
  </View>;
}
function BatchReview({ theme, data, review }: { theme: PluginTheme; data: ProjectSetupCatalog; review: ProjectBatchPreview }) {
  const [details, showDetails] = useState(false), groups = new Map<string, ProjectBatchPreview["reviews"]>();
  for (const r of review.reviews) {
    const key = r.review ? JSON.stringify([r.review.profile, r.review.limits, r.review.budget]) : r.choices.name;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const text = { color: theme.colors.foreground, fontSize: 14, lineHeight: 22 }, note = { ...text, color: theme.colors.foregroundMuted };
  return <View style={{ gap: 16 }}>
    {[...groups].map(([key, rows]) => {
      const r = rows[0]!.review, model = data.models.find(m => m.provider === r?.profile.provider), mode = model?.modes.find(m => m.id === r?.profile.modeId);
      return <View key={key} style={{ gap: 8, paddingBottom: 16, borderBottomWidth: 1, borderColor: theme.colors.border }}>
        <Text style={{ ...text, fontSize: 16, fontWeight: "600" }}>{rows.map(r => r.choices.name).join(" and ")}</Text>
        {r ? <>
          <Text style={text}>Model: {model?.label ?? r.profile.provider} · {r.profile.provider}</Text>
          <Text style={text}>Permissions: {mode?.label ?? r.profile.modeId} ({r.profile.modeId}). {permissionPower(r.profile.modeId)} Plugin limits do not restrict tools outside the plugin.</Text>
          <Text style={text}>Per project: {r.limits.supervisorSessions} persistent session; {r.limits.supervisorTurns} total conversation turns, including setup and replies.</Text>
          <Text style={text}>Project allocation: {r.budget.agents} agents and {r.budget.turns} turns per project.</Text>
          {rows.map(row => <Text key={row.choices.name} style={text}>Existing spend for {row.choices.name}: {row.review!.spent.sessions} sessions and {row.review!.spent.turns} turns.</Text>)}
        </> : <Text style={text}>Needs a change. Return to projects and review this project's settings.</Text>}
      </View>;
    })}
    <SetupAction theme={theme} label={details ? "Hide review details" : "Review details and instructions"} onPress={() => showDetails(!details)} />
    {details ? review.reviews.map(row => row.review ? <View key={row.choices.name} style={{ gap: 8 }}>
      <Text style={text}>{row.choices.name} · {row.review.source.path}</Text>
      <Text selectable style={text}>{data.sources.find(s => s.path === row.review!.source.path)?.text ?? "Instructions unavailable. Return to projects and refresh before confirming."}</Text>
      <Text selectable style={note}>Opening message: {row.review.opening}</Text>
      <Text selectable style={note}>Review {row.reviewDigest}. Recorded app action; caller identity is unverified.</Text>
    </View> : null) : null}
  </View>;
}
