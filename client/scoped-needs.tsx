/** Presentation adapter only. Scoped answers never enter the backlog answer/send ledger. */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState, useSyncExternalStore } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { NeedsYouRequest, NeedsYouSnapshot } from "../shared/needs-you";
import { answerScopeDecision, readScopeNeeds } from "../shared/supervision-rpc";
import type { ScopedAnswer } from "../shared/scoped-commands";
import { DecisionTask } from "./decision-tasks";
import { drafts } from "./draft";
import { NEEDS_YOU_QUERY_KEY } from "./needs-you-query";
import { mergeDecisionSnapshot } from "./needs-you-state";
import { workflowRequestId, useWorkflowPlans } from "./workflow-plans";
import { errorText } from "./format";
import { ScopedCaptainDecisionDetails } from "./scoped-captain-decision";
import type { ScopedCaptainDecision } from "../shared/scoped-captain-decision";
import { answerMaintenanceFromUi } from "../shared/maintenance-runtime";

type Row = NonNullable<NeedsYouSnapshot["scopedDecisions"]>[number];
export function scopedDecisionRequest(row: Row): NeedsYouRequest {
  const d = row.decision;
  return { id: d.id, source: { key: JSON.stringify(["scope-decision", d.ownerScopeId, d.id]), taskId: d.nodeId, hostId: "local", project: null,
    title: d.title, ask: d.question, url: null, reportPath: null, gateToken: null, section: "in-flight", disposition: "open", blockedBy: row.waitingFor },
    generation: 1, revision: d.revision, state: d.state === "answered" ? "answer-sent" : "seen", detectedAt: 0, updatedAt: 0,
    originalAsk: d.question, baseline: true, seenAt: null, seenRevision: null, snoozedUntil: null, submissions: [], resolution: null };
}
export function ScopedNeeds({ snapshot, theme, compact = false, offline = false }: { snapshot?: NeedsYouSnapshot | undefined; theme: PluginTheme; compact?: boolean; offline?: boolean }) {
  if (!snapshot) return null;
  const holds = [...new Set(snapshot?.scopedHolds?.map(h => h.planId) ?? [])];
  if (!snapshot?.scopedDecisions?.length && !holds.length && !snapshot?.scopedProblems?.length) return null;
  return <View testID="scoped-needs" style={{ gap: 12 }}>
    {(snapshot.scopedProblems ?? []).map((p, i) => <Text key={i} style={{ color: theme.colors.statusWarning }}>{p}</Text>)}
    {holds.map(plan => <View key={plan} style={{ gap: 4 }}><Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>Plan {plan} is held</Text>
      {snapshot.scopedHolds?.filter(h => h.planId === plan).map(h => <Text key={h.id} style={{ color: theme.colors.foregroundMuted }}>{h.reason}</Text>)}</View>)}
    {snapshot.scopedDecisions?.map(row => <ScopedDecisionRow key={`${snapshot.homeId}:${row.decision.id}:${row.decision.revision}:${row.decision.subjectHash}`}
      row={row} snapshot={snapshot} theme={theme} compact={compact} offline={offline} />)}
  </View>;
}
function ScopedDecisionRow({ row, snapshot, theme, compact, offline }: { row: Row; snapshot: NeedsYouSnapshot; theme: PluginTheme; compact: boolean; offline: boolean }) {
  const answer = useRpc(answerScopeDecision), maintenanceAnswer = useRpc(answerMaintenanceFromUi), read = useRpc(readScopeNeeds), cache = useQueryClient(), plans = useWorkflowPlans();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), gate = useRef(false);
  const d = row.decision, maintenance = !!d.maintenance, key = JSON.stringify(["firstmate.scope-answer/1", snapshot.homeId, d.id, d.revision, d.subjectHash]);
  const presentation: ScopedCaptainDecision = row.captain ?? { format: "firstmate.scoped-captain-decision/1", homeId: snapshot.homeId!,
    scope: { kind: maintenance ? "maintenance" : "plan", id: d.ownerScopeId }, origin: { kind: maintenance ? "maintenance" : "plan", id: d.maintenance?.incidentId ?? d.planId }, decisionId: d.id, revision: d.revision, subjectHash: d.subjectHash,
    title: d.title, question: d.question, options: d.options.map((o, i) => ({ ...o, number: i + 1 })), recommendation: null,
    evidence: d.maintenance?.evidence ?? d.sourceVector.map(v => ({ ref: `${v.kind}/${v.id}@${v.version}`, digest: v.digest ?? null })), projectIds: [], permittedActions: ["answer"] };
  const text = useSyncExternalStore(drafts.subscribe, () => drafts.get(key));
  const option = useSyncExternalStore(drafts.subscribe, () => drafts.get(`${key}:option`));
  const pending = useSyncExternalStore(drafts.subscribe, () => drafts.get(`${key}:pending`));
  const rejected = useSyncExternalStore(drafts.subscribe, () => drafts.get(`${key}:rejected`));
  const errorKey = JSON.stringify(["firstmate.scope-answer-error/1", snapshot.homeId, d.id]);
  const error = useSyncExternalStore(drafts.subscribe, () => drafts.get(errorKey));
  const enabled = maintenance ? snapshot.maintenanceAnswersEnabled : snapshot.scopedAnswersEnabled;
  const context = maintenance ? row.maintenanceAnswerContext : row.answerContext;
  const answered = d.state === "answered", disabled = busy || !!pending || answered || offline || !row.ready || !context || !enabled || snapshot.scopedComplete !== true;
  async function refresh() {
    const next = await read({});
    if (next.homeId !== snapshot.homeId) throw new Error("The decision home changed. Preserve the draft and reopen its original host.");
    cache.setQueryData<NeedsYouSnapshot>(NEEDS_YOU_QUERY_KEY, old => mergeDecisionSnapshot(old, next));
    if (next.scopedComplete === true && (next.scopedSequence ?? -1) >= (snapshot.scopedSequence ?? 0)) drafts.set(`${key}:rejected`, "");
  }
  async function submit() {
    if (disabled || rejected || !option || !context || gate.current || drafts.get(`${key}:pending`)) return;
    gate.current = true; setBusy(true); drafts.set(errorKey, "");
    const input = { ...context, submissionId: workflowRequestId(), option, text };
    drafts.set(`${key}:pending`, JSON.stringify(input));
    try {
      // The durable origin chooses the transport. Presentation cannot authorize a plan/backlog send.
      const result = maintenance ? await maintenanceAnswer({ ...row.maintenanceAnswerContext!, submissionId: input.submissionId, option, text }) : await answer(input as ScopedAnswer);
      if ("outcome" in result) {
        if (result.outcome !== "refused") throw new Error(result.message);
        drafts.set(`${key}:rejected`, JSON.stringify(input));
        drafts.set(`${key}:pending`, "");
        drafts.set(errorKey, `${result.code}: ${result.message}`);
        // No automatic resend: a complete refreshed context permits a new explicit submission.
        await refresh();
        return;
      }
      if (maintenance && !("decisions" in result && result.decisions.some(decision => decision.id === d.id && decision.answer?.submissionId === input.submissionId)))
        throw new Error("No matching maintenance answer receipt returned. The original submission stays retained; refresh before continuing.");
      // Keep the confirmed answer disabled if the combined read fails; never advance on a ledger-only result.
      await refresh();
    } catch (e) { drafts.set(errorKey, errorText(e)); }
    finally { gate.current = false; setBusy(false); }
  }
  const button = (label: string, onPress: () => void, off = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={off} accessibilityState={{ disabled: off }} onPress={onPress}
    style={{ minHeight: 44, padding: 10, justifyContent: "center", borderWidth: 1, borderColor: theme.colors.border, borderRadius: 7, backgroundColor: theme.colors.surface1, opacity: off ? 0.5 : 1 }}><Text style={{ color: theme.colors.foreground }}>{label}</Text></Pressable>;
  return <View style={{ gap: 8 }}>
    <DecisionTask request={scopedDecisionRequest(row)} snapshot={snapshot} theme={theme} compact={compact} presentation="card" waitingLabel={answered ? "Answer committed · waiting for owner" : row.ready ? "Scoped decision" : row.waitingFor ?? "Waiting"}
      onConverse={() => {}} onChanged={() => { void refresh().catch(e => drafts.set(errorKey, errorText(e))); }} onAnswer={() => setOpen(v => !v)} />
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Scope {d.ownerScopeId} · {maintenance ? "Maintenance job" : "Plan"} {d.planId} · {row.ownerEpoch === null ? "owner unavailable or transferring" : `owner epoch ${row.ownerEpoch}`}</Text>
    {!maintenance && plans.canDiscussPlan?.(d.planId) ? button("Discuss with this plan's owner", () => plans.discussPlan?.(d.planId)) : null}
    {plans.canDiscussScope?.(d.ownerScopeId, snapshot.homeId!) ? button("Open decision scope", () => plans.discussScope?.(d.ownerScopeId, snapshot.homeId!)) : null}
    {open ? <View style={{ gap: 8 }}>
      {snapshot.scopeFiltersEnabled || maintenance ? <ScopedCaptainDecisionDetails decision={presentation} theme={theme} selected={option} onSelect={id => drafts.set(`${key}:option`, id)} disabled={disabled || !presentation.permittedActions.includes("answer")} /> : <>
        <Text style={{ color: theme.colors.foreground }}>{d.question}</Text>
        {d.options.map(o => <View key={o.id}>{button(`${option === o.id ? "Selected: " : ""}${o.label}`, () => drafts.set(`${key}:option`, o.id), disabled)}</View>)}
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Evidence: {d.sourceVector.map(v => `${v.kind}/${v.id}@${v.version}`).join(", ")}</Text>
      </>}
      <TextInput accessibilityLabel={`Answer notes: ${d.title}`} multiline value={text} editable={!disabled} onChangeText={value => drafts.set(key, value)}
        style={{ color: theme.colors.foreground, backgroundColor: theme.colors.surface0, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 7, minHeight: 44, padding: 10 }} />
      {maintenance ? <Text style={{ color: theme.colors.foregroundMuted }}>This records a captain choice by app convention, not verified identity. It changes no budget and grants no work authority.</Text> : null}
      {!enabled ? <Text style={{ color: theme.colors.foregroundMuted }}>{maintenance ? "Maintenance" : "Scoped"} answers are disabled pending activation.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>{error}</Text> : null}
      {button(answered ? "Answer committed" : pending ? "Answer unconfirmed · original submission retained" : rejected ? "Refresh before reconsidering answer" : "Submit scoped answer", () => { void submit(); }, disabled || !!rejected || !option)}
      {button("Refresh scoped decisions", () => { void refresh().catch(e => drafts.set(errorKey, errorText(e))); }, busy)}
    </View> : null}
  </View>;
}
