import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, Icon } from "@getpaseo/plugin/client/react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  markNeedsYouSeen,
  markNeedsYouNew,
  snoozeNeedsYou,
  unsnoozeNeedsYou,
  recordNeedsYouAnswer,
  type NeedsYouSnapshot,
  type NeedsYouRequest,
  quarantinesSource,
  readNeedsYou,
} from "../shared/needs-you";
import { actOnWorkflowPlan, type PlanNeed } from "../shared/workflow-rpc";
import { decisionCardSnapshot, planDecisionFor, planReviewFor } from "../shared/plan-decisions";
import { parseDecisionBrief } from "../shared/decision-brief";
import type { Suggestion } from "../shared/fleet";
import { useMateSender } from "./mate-send";
import { useDecisionChanged } from "./needs-you-query";
import {
  boundAnswers,
  decisionQueue,
  decisionProblems,
  decisionSession,
  decisionDraftKey,
  type DecisionDestination,
} from "./needs-you-state";
import {
  decisionTitle,
  decisionClock,
  decisionStateLabel,
  relativeDecisionTime,
  stableDecisionOrder,
  nextWaitingDecision,
} from "./decision-copy";
import { DecisionSnooze } from "./decision-snooze";
import { DecisionAsk, DecisionMaterials } from "./decision-context";
import { DecisionBrief, DecisionSummary, briefFor } from "./decision-brief";
import { FilesView } from "./files";
import {
  bindWebKeys,
  focusWebElement,
  cycleWebFocus,
  webAttributes,
  webSurfaceVisible,
} from "./web";
import { useKeyboardOverlap } from "./keyboard";
import { errorText } from "./format";
import { PlanNeeds, useWorkflowPlans, WORKFLOW_QUERY_KEY, workflowRequestId } from "./workflow-plans";
import { DecisionTask } from "./decision-tasks";

const readableContent = { width: "100%" as const, maxWidth: 760, alignSelf: "center" as const };

export function DecisionButton({
  theme,
  label,
  onPress,
  disabled = false,
  nativeID,
  compact = false,
  primary = false,
  icon,
  text,
}: {
  theme: PluginTheme;
  label: string;
  onPress(): void;
  disabled?: boolean;
  nativeID?: string;
  compact?: boolean;
  primary?: boolean;
  icon?: string;
  text?: string;
}) {
  const colors = theme.colors;
  const ink = primary ? colors.accentForeground : colors.foreground;
  return (
    <Pressable
      nativeID={nativeID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: compact ? 44 : 28,
        minWidth: compact ? 44 : 28,
        paddingHorizontal: 10,
        paddingVertical: compact ? 10 : 6,
        borderWidth: 1,
        borderRadius: 7,
        borderColor: primary ? colors.accent : colors.border,
        backgroundColor: primary ? colors.accent : colors.surface1,
        justifyContent: "center",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {icon ? <Icon name={icon} size={14} color={ink} /> : null}
      <Text
        style={{ color: ink, fontSize: 12, fontWeight: "500", flexShrink: 1 }}
      >
        {text ?? label}
      </Text>
    </Pressable>
  );
}

function SectionLabel({
  theme,
  children,
}: {
  theme: PluginTheme;
  children: ReactNode;
}) {
  return (
    <Text
      style={{
        color: theme.colors.foregroundMuted,
        fontSize: 11,
        letterSpacing: 0.5,
      }}
    >
      {children}
    </Text>
  );
}

function DecisionGroup({ theme, label, count, children }: { theme: PluginTheme; label: string; count: number; children: ReactNode }) {
  const colors = theme.colors;
  return <View testID="decision-group" style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, overflow: "hidden" }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, backgroundColor: colors.surface2 }}>
      <Text accessibilityRole="header" {...webAttributes({ "aria-level": "3" })} style={{ flex: 1, color: colors.foreground, fontSize: 14, fontWeight: "700" }}>{label}</Text>
      <Text accessibilityLabel={`${count} ${label}`} style={{ color: colors.foreground, fontSize: 13, fontWeight: "700",
        backgroundColor: colors.surface0, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 }}>{count}</Text>
    </View>
    <View style={{ paddingHorizontal: 12, backgroundColor: colors.surface1 }}>{children}</View>
  </View>;
}

function ParkedTitle({ title, theme }: { title: string; theme: PluginTheme }) {
  const [expanded, setExpanded] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={`Full title: ${title}`} accessibilityState={{ expanded }} aria-expanded={expanded}
    onPress={() => setExpanded(!expanded)} style={{ minHeight: 44, justifyContent: "center" }}>
    <Text numberOfLines={expanded ? undefined : 2} style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>{title}</Text>
  </Pressable>;
}

export function DecisionDrawer({
  theme,
  snapshot: sourceSnapshot,
  offline,
  destination,
  onSelect,
  onClose,
  mateId,
  suggestions,
  compact,
  modal = compact,
  onOpenBoard,
  onOpenChat,
  filtered = false,
  loading = false,
  returnLabel = "Home",
}: {
  theme: PluginTheme;
  snapshot?: NeedsYouSnapshot | undefined;
  offline: boolean;
  destination: DecisionDestination;
  onSelect(destination: DecisionDestination): void;
  onClose(): void;
  mateId: string | null;
  suggestions: readonly Suggestion[];
  compact: boolean;
  modal?: boolean;
  onOpenBoard?: (() => void) | undefined;
  onOpenChat?: ((destination: DecisionDestination) => void) | undefined;
  filtered?: boolean;
  loading?: boolean;
  returnLabel?: string;
}) {
  const snapshot = sourceSnapshot ? decisionCardSnapshot(sourceSnapshot) : undefined;
  const order = useRef<{ home: string | null; ids: string[] }>({
    home: null,
    ids: [],
  });
  if (order.current.home !== snapshot?.homeId)
    order.current = { home: snapshot?.homeId ?? null, ids: [] };
  order.current.ids = stableDecisionOrder(
    order.current.ids,
    decisionQueue(snapshot?.requests ?? []).filter(
      (r) => r.state === "new" || r.state === "seen",
    ),
  );
  const ids = order.current.ids;
  const queue = ids
    .map((id) => snapshot?.requests.find((r) => r.id === id))
    .filter((r): r is NeedsYouRequest => r?.state === "new" || r?.state === "seen");
  const sameHome =
    !destination.homeId || destination.homeId === snapshot?.homeId;
  const request = sameHome
    ? snapshot?.requests.find((r) => r.id === destination.requestId) ?? (["next", "empty"].includes(destination.requestId) ? queue[0] : undefined)
    : undefined;
  const index = queue.findIndex((r) => r.id === request?.id);
  const plans = useWorkflowPlans(), review = planReviewFor(snapshot, request?.id ?? "");
  const [expandedAll, setAll] = useState(false);
  const all = destination.requestId === "all" || expandedAll;
  const nestedAll = all && destination.requestId !== "all";
  const [receipt, setReceipt] = useState<{
    text: string;
    target: DecisionDestination;
    answered: boolean;
  } | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [planNotice, setPlanNotice] = useState<{ home: string | null; id: string; text: string } | null>(null);
  const selected = useRef(destination.requestId);
  selected.current = destination.requestId;
  const root = useRef<View>(null);
  const keyboard = useKeyboardOverlap(root);
  const headingId = `decisions-heading-${useId()}`;
  const sender = useMateSender(mateId ?? "none");
  useEffect(() => {
    if (!receipt?.answered) return;
    const timer = setTimeout(() => setReceipt(null), 3000);
    return () => clearTimeout(timer);
  }, [receipt]);
  useEffect(() => {
    if (!request || all) focusWebElement(headingId);
  }, [request?.id, all, headingId]);
  useEffect(
    () =>
      bindWebKeys(root.current, (key, shift) => {
        if (key === "Tab" && modal) return cycleWebFocus(root.current, shift);
        if (key !== "Escape") return false;
        onClose();
        return true;
      }),
    [onClose, modal],
  );
  function select(r: NeedsYouRequest) {
    onSelect({
      homeId: snapshot!.homeId!,
      requestId: r.id,
      recordRevision: r.revision,
    });
    setAll(false);
  }
  function completed(result: NeedsYouSnapshot, text: string, answered = false) {
    const next = decisionCardSnapshot(result);
    setReceipt({
      text,
      answered,
      target: {
        homeId: snapshot!.homeId!,
        requestId: request!.id,
        recordRevision: request!.revision,
      },
    });
    if (selected.current !== destination.requestId || next.homeId !== snapshot?.homeId)
      return;
    const following = nextWaitingDecision(
      stableDecisionOrder(order.current.ids, decisionQueue(next.requests)),
      request!.id,
      next.requests,
    );
    if (following) select(following);
    else if (answered) onClose();
  }
  const colors = theme.colors;
  const scopedRows = (snapshot?.quarantined ?? []).filter(row => all || !request || quarantinesSource([row], request.source));
  const problems = !all && request && !offline && snapshot?.freshness.status === "fresh"
    ? scopedRows.map(row => row.problem) : decisionProblems(snapshot, offline);
  const failure =
    !loading &&
    ((snapshot && snapshot.freshness.status !== "fresh") ||
      offline ||
      problems.length > 0);
  const chrome = (
    <>
      {filtered ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
          Filters don’t hide decisions
        </Text>
      ) : null}
      {failure ? (
        <View
          style={{
            padding: 12,
            gap: 10,
            borderWidth: 1,
            borderColor: colors.statusWarning,
            borderRadius: 8,
          }}
        >
          <Text
            accessibilityRole="alert"
            style={{ color: colors.statusWarning, fontWeight: "600" }}
          >
            {snapshot?.freshness.status === "stale" ||
            (offline && snapshot?.freshness.asOf)
              ? `Showing the list from ${decisionClock(snapshot!.freshness.asOf!)}. You can answer once FirstMate can read the backlog again.`
              : snapshot?.freshness.status === "disabled"
                ? "Decision observation is disabled"
                : snapshot?.freshness.status === "fresh"
                  ? "Some backlog lines need repair"
                  : "Can’t read decisions"}
          </Text>
          {problems.map((problem, i) => (
            <Text key={i} style={{ color: colors.foreground, fontSize: 13 }}>
              {problem}
            </Text>
          ))}
          {scopedRows
            .filter((r) => r.hasHold)
            .map((r, i) => (
              <Text
                key={i}
                style={{ color: colors.foreground, fontSize: 13 }}
              >{`Couldn't read this task${r.taskId ? `: ${r.taskId}` : ""}. Check the Board and data/backlog.md${r.line ? `, line ${r.line}` : ""}.`}</Text>
            ))}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <DecisionButton
              theme={theme}
              compact={compact}
              primary
              label="Ask the first mate to fix it"
              disabled={!mateId || offline || sender.sending}
              onPress={() => {
                if (
                  sender.send({
                    text: `Please inspect data/backlog.md and fix the unreadable decision records. FirstMate reports:\n${problems.join("\n")}\nPreserve existing decisions and do not treat this request as an answer to any hold.`,
                  })
                )
                  setNotice("Asked the first mate to check the backlog.");
              }}
            />
            <DecisionButton
              theme={theme}
              compact={compact}
              label="Open backlog.md"
              onPress={() => setFile("data/backlog.md")}
            />
            {onOpenBoard ? (
              <DecisionButton
                theme={theme}
                compact={compact}
                label="Open Board"
                onPress={onOpenBoard}
              />
            ) : null}
          </View>
        </View>
      ) : null}
      {notice ? (
        <Text accessibilityRole="alert" style={{ color: colors.foreground }}>
          {notice}
        </Text>
      ) : null}
    </>
  );
  function group(label: string, rows: NeedsYouRequest[]) {
    if (!rows.length) return null;
    return (
      <DecisionGroup theme={theme} label={label} count={rows.length} key={label}>
        {rows.map((r) => (
          r.state === "new" || r.state === "seen" ? <View key={r.id} style={{ paddingVertical: 12, gap: 8 }}>
            <DecisionTask request={r} snapshot={snapshot!} theme={theme} compact={compact} presentation="card"
              onAnswer={() => select(r)} onConverse={() => {}} onChanged={() => {}} />
            <DecisionSummary theme={theme} snapshot={snapshot} request={r} showQuestion={false} />
          </View> :
          <Pressable
            key={r.id}
            accessibilityRole="button"
            accessibilityLabel={`${r.source.title} · ${decisionStateLabel(r)}`}
            onPress={() => select(r)}
            style={{
              paddingVertical: 12,
              minHeight: 44,
              gap: 4,
              borderTopWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                color: colors.foreground,
                fontWeight: "600",
                fontSize: 13,
              }}
            >
              {decisionTitle(r.source.title)}
            </Text>
            <Text
              style={{
                color:
                  r.state === "delivery-uncertain"
                    ? colors.statusWarning
                    : colors.foregroundMuted,
                fontSize: 12,
              }}
            >
              {decisionStateLabel(r)}
            </Text>
          </Pressable>
        ))}
      </DecisionGroup>
    );
  }
  return (
    <View
      ref={root}
      accessibilityLabel="FirstMate decisions"
      accessibilityViewIsModal={modal}
      style={{
        flex: 1,
        minHeight: 0,
        paddingBottom: keyboard,
        backgroundColor: colors.surface0,
        borderLeftWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          flexWrap: compact ? "wrap" : "nowrap",
          alignItems: "center",
          padding: compact ? 12 : 10,
          gap: 8,
          borderBottomWidth: 1,
          borderColor: colors.border,
        }}
      >
        <DecisionButton
          theme={theme}
          compact={compact}
          icon="ChevronLeft"
          label={nestedAll ? "Back to Needs you" : `Back to ${returnLabel}`}
          text={nestedAll ? "Needs you" : compact && returnLabel === "Home files" ? "Files" : returnLabel}
          onPress={nestedAll ? () => setAll(false) : onClose}
        />
        <View style={{ flex: 1, minWidth: compact ? 100 : undefined, flexDirection: compact ? "column" : "row", gap: compact ? 2 : 6 }}>
          <Text
            nativeID={headingId}
            {...webAttributes({ tabindex: "-1", "aria-level": "2" })}
            accessibilityRole="header"
            style={{
              color: colors.statusWarning,
              fontSize: 13,
              fontWeight: "600",
              // This non-interactive heading takes focus to announce a new page.
              // Button/input focus indicators remain owned by the renderer.
              outlineWidth: 0,
            }}
          >
            {all ? "All" : "Decisions"}
          </Text>
          {!all && index >= 0 ? <Text style={{ color: colors.statusWarning, fontSize: 13 }}>
            {`${index + 1} of ${queue.length}`}
          </Text> : null}
        </View>
        {!all ? (
          <View style={{ flexDirection: "row", gap: 8, marginLeft: "auto" }}>
            <DecisionButton
              theme={theme}
              compact={compact}
              label="Previous decision"
              text="‹"
              disabled={queue.length < 2}
              onPress={() =>
                select(queue[index <= 0 ? queue.length - 1 : index - 1]!)
              }
            />
            <DecisionButton
              theme={theme}
              compact={compact}
              label="Next decision"
              text="›"
              disabled={queue.length < 2}
              onPress={() => select(queue[(index + 1) % queue.length]!)}
            />
            <DecisionButton
              theme={theme}
              compact={compact}
              label="All decisions"
              text="All"
              onPress={() => setAll(true)}
            />
          </View>
        ) : null}
      </View>
      {receipt?.answered ? (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.foregroundMuted, fontSize: 12, paddingHorizontal: 16, paddingTop: 8 }}>
          {receipt.text}
        </Text>
      ) : receipt ? (
        <View
          accessibilityLiveRegion="polite"
          style={{
            margin: 12,
            marginBottom: 0,
            padding: 10,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            borderWidth: 1,
            borderColor: colors.accent,
            borderRadius: 7,
          }}
        >
          <Text style={{ color: colors.foreground, fontSize: 12, flex: 1 }}>
            {receipt.text}
          </Text>
          <DecisionButton
            theme={theme}
            label="View last decision"
            text="View"
            onPress={() => {
              onSelect(receipt.target);
              setAll(false);
            }}
          />
        </View>
      ) : null}
      {all ? (
        <ScrollView
          contentContainerStyle={{ ...readableContent, padding: 16, gap: 24 }}
          style={{ flex: 1 }}
        >
          {failure ? chrome : null}
          {group(
            "Waiting for you",
            queue.filter((r) => r.state === "new" || r.state === "seen"),
          )}
          {!failure ? chrome : null}
          <PlanNeeds theme={theme} snapshot={snapshot} showReviews={false} />
          {group(
            "Answered · waiting for the first mate",
            snapshot?.requests.filter(
              (r) =>
                r.state === "answer-sent" || r.state === "delivery-uncertain",
            ) ?? [],
          )}
          {group(
            "Snoozed",
            snapshot?.requests.filter((r) => r.state === "snoozed") ?? [],
          )}
          {snapshot?.parked.length ? (
            <DecisionGroup theme={theme} label="Parked until something else happens" count={snapshot.parked.length}>
              {snapshot.parked.map((r) => (
                <View
                  key={r.key}
                  style={{
                    gap: 4,
                    borderTopWidth: 1,
                    borderColor: colors.border,
                    paddingVertical: 10,
                  }}
                >
                  <ParkedTitle title={r.title} theme={theme} />
                  <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
                    {r.blockedBy ?? "No question recorded"}
                  </Text>
                </View>
              ))}
            </DecisionGroup>
          ) : null}
          {group(
            "Settled today",
            snapshot?.requests.filter(
              (r) =>
                r.state === "resolved" &&
                new Date(r.resolution?.at ?? r.updatedAt).toDateString() ===
                  new Date().toDateString(),
            ) ?? [],
          )}
        </ScrollView>
      ) : request && review ? (
        <ScrollView contentContainerStyle={{ ...readableContent, padding: compact ? 16 : 20, gap: 16 }}>
          {chrome}
          <DecisionTask request={request} snapshot={snapshot!} theme={theme} compact={compact} review
            presentation="card" onAnswer={() => plans.open(review.plan)} onConverse={() => {}} onChanged={() => {}} />
          <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>{review.recommendation}</Text>
        </ScrollView>
      ) : request && planDecisionFor(snapshot, request.id) ? (
        <PlanDecisionDetails key={`${snapshot!.homeId}:${request.id}:${planDecisionFor(snapshot, request.id)!.decision!.subjectHash}`}
          theme={theme} request={request} snapshot={snapshot!} need={planDecisionFor(snapshot, request.id)!}
          offline={offline} compact={compact} onCompleted={completed} chrome={chrome} warning={!!failure}
          notice={planNotice?.home === snapshot!.homeId && planNotice.id === request.id ? planNotice.text : ""}
          onNotice={text => setPlanNotice({ home: snapshot!.homeId, id: request.id, text })} />
      ) : request ? (
        <DecisionDetails
          key={`${snapshot!.homeId}:${request.id}:${request.revision}`}
          theme={theme}
          request={request}
          snapshot={snapshot!}
          offline={offline}
          openedRevision={destination.recordRevision}
          mateId={mateId}
          suggestions={suggestions}
          compact={compact}
          onOpenChat={onOpenChat}
          onCompleted={completed}
          chrome={chrome}
        />
      ) : (
        <ScrollView contentContainerStyle={{ ...readableContent, padding: 16, gap: 16 }}>
          {chrome}
          <PlanNeeds theme={theme} snapshot={snapshot} showReviews={false} />
          {sameHome && snapshot?.freshness.status === "fresh" && !offline &&
            (destination.requestId === "next" || destination.requestId === "empty") &&
            (!!snapshot.planNow?.length || !!snapshot.comingUp?.length) ? null :
          <Text style={{ color: colors.foreground }}>
            {!sameHome
              ? "This decision belongs to another FirstMate home. Open its original host and home."
              : loading
                ? "Loading decisions…"
                : destination.requestId === "next" ||
                    destination.requestId === "empty"
                  ? snapshot?.actionCount === 0 &&
                    snapshot.freshness.status === "fresh" &&
                    !snapshot.planProblems?.length &&
                    !offline
                    ? "✓ Nothing needs you. Answered, snoozed and past decisions are in All."
                    : "Open All to review the last known decisions."
                  : "This decision is no longer available. Its answer has not been replayed."}
          </Text>}
        </ScrollView>
      )}
      <SourceFile
        theme={theme}
        compact={compact}
        path={file}
        onClose={() => setFile(null)}
      />
    </View>
  );
}

function SourceFile({
  theme,
  compact,
  path,
  onClose,
}: {
  theme: PluginTheme;
  compact: boolean;
  path: string | null;
  onClose(): void;
}) {
  return (
    <Modal
      title="Decision source file"
      open={path !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Content scrollable={false}>
        <View style={{ height: compact ? 400 : 600 }}>
          <FilesView
            theme={theme}
            compact={compact}
            request={path ? { path, at: 0 } : null}
          />
        </View>
      </Modal.Content>
    </Modal>
  );
}

function submissionId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/** Uses the same captain action as Plans, never the backlog-answer transport. */
function PlanDecisionDetails({ theme, request, snapshot, need, offline, compact, onCompleted, chrome, warning, notice, onNotice: setNotice }: {
  theme: PluginTheme; request: NeedsYouRequest; snapshot: NeedsYouSnapshot; need: PlanNeed;
  offline: boolean; compact: boolean; chrome: ReactNode;
  warning: boolean; notice: string; onNotice(text: string): void;
  onCompleted(snapshot: NeedsYouSnapshot, receipt: string, answered?: boolean): void;
}) {
  const act = useRpc(actOnWorkflowPlan), read = useRpc(readNeedsYou), cache = useQueryClient(), changed = useDecisionChanged();
  const [busy, setBusy] = useState(false), [accepted, setAccepted] = useState(false);
  const [file, setFile] = useState<string | null>(null);
  const gate = useRef(false), pending = useRef<{ option: string; id: string } | null>(null);
  const heading = `plan-decision-heading-${useId()}`;
  useEffect(() => { focusWebElement(heading); }, [heading]);
  const decision = need.decision!, colors = theme.colors;
  const plans = useWorkflowPlans();
  const disabled = offline || snapshot.freshness.status === "stale" || !!snapshot.planProblems?.length || decision.ready !== true || !!decision.held || busy || accepted;
  async function answer(option: string) {
    if (gate.current || disabled) return;
    gate.current = true; setBusy(true); setNotice("");
    if (pending.current?.option !== option) pending.current = { option, id: workflowRequestId() };
    try {
      const next = await act({ homeId: decision.homeId, requestId: pending.current.id,
        command: { op: "captain", plan: need.plan, revision: decision.revision, subjectHash: decision.subjectHash,
          action: "answer", node: need.node!, option, text: "" } });
      setAccepted(true);
      cache.setQueryData(WORKFLOW_QUERY_KEY, next);
      await advance();
    } catch (error) {
      setNotice(errorText(error)); changed();
    } finally { gate.current = false; setBusy(false); }
  }
  async function advance() {
    try {
      const next = await read({});
      onCompleted(changed(next) ?? next, "Answer recorded.", true);
    } catch {
      changed(); setNotice("Answer recorded. Refresh decisions to continue.");
    }
  }
  const brief = briefFor(snapshot, request);
  // Authored prose is context; only the current plan's options authorize an answer.
  const recommendation = brief ? parseDecisionBrief(brief.content).recommendation : "";
  return <>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ ...readableContent, padding: compact ? 16 : 20, gap: 16, paddingBottom: 24 }}>
      {warning ? chrome : null}
      <Text nativeID={heading} {...webAttributes({ tabindex: "-1", "aria-level": "3" })} accessibilityRole="header"
        style={{ color: colors.foreground, fontSize: 18, fontWeight: "600", outlineWidth: 0 }}>{request.source.title}</Text>
      <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>Part of {need.title}{need.neededBy.length ? ` · Unblocks: ${need.neededBy.join(", ")}` : ""}</Text>
      <DecisionButton theme={theme} compact={compact} label={`Open plan: ${need.title}`} text="Open plan" onPress={() => plans.open(need.plan)} />
      {brief ? <DecisionBrief theme={theme} content={brief.content} answer={() => null} /> :
        <DecisionAsk theme={theme} source={request.source} homeId={snapshot.homeId!} onOpenFile={setFile} compact={compact} />}
      {!recommendation ? <View style={{ borderLeftWidth: 3, borderLeftColor: colors.accent, backgroundColor: colors.surface2, padding: 12, gap: 6, borderRadius: 8 }}>
        <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "700" }}>Recommendation</Text>
        <Text style={{ color: colors.foreground, fontSize: 13 }}>{need.recommendation}</Text>
      </View> : null}
      {decision.options.map(option => <View key={option.id} style={{ gap: 8, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }}>
        <Text style={{ color: colors.foreground, fontSize: 13 }}>{option.consequence}</Text>
        <DecisionButton theme={theme} compact={compact} label={option.label} disabled={disabled} onPress={() => void answer(option.id)} />
      </View>)}
      {!warning ? chrome : null}
      {decision.held ? <Text accessibilityRole="alert" style={{ color: colors.statusWarning }}>This decision is on hold. Review its dependencies in Plans before answering.</Text> : null}
      {decision.ready !== true ? <Text style={{ color: colors.foregroundMuted }}>Options are read-only until the host confirms plan approval and required evidence. Open the plan to review readiness.</Text> : null}
      {notice ? <Text accessibilityRole="alert" style={{ color: colors.statusWarning }}>{notice}</Text> : null}
      {accepted ? <DecisionButton theme={theme} label="Refresh decisions" onPress={() => void advance()} /> : null}
    </ScrollView>
    <SourceFile theme={theme} compact={compact} path={file} onClose={() => setFile(null)} />
  </>;
}

function DecisionDetails({
  theme,
  request,
  snapshot,
  offline,
  openedRevision,
  mateId,
  suggestions,
  compact,
  onOpenChat,
  onCompleted,
  chrome,
}: {
  theme: PluginTheme;
  request: NeedsYouRequest;
  snapshot: NeedsYouSnapshot;
  offline: boolean;
  openedRevision?: number | undefined;
  mateId: string | null;
  suggestions: readonly Suggestion[];
  compact: boolean;
  onOpenChat?: ((destination: DecisionDestination) => void) | undefined;
  onCompleted(snapshot: NeedsYouSnapshot, receipt: string, answered?: boolean): void;
  chrome: ReactNode;
}) {
  const session = decisionSession(useQueryClient());
  const draftKey = decisionDraftKey(snapshot.homeId, request);
  const [draft, setDraft] = useState(() => session.drafts.get(draftKey) ?? "");
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [answered, setAnswered] = useState(false);
  const read = useRpc(readNeedsYou);
  const [file, setFile] = useState<string | null>(null),
    [menu, setMenu] = useState(false),
    [snoozing, setSnoozing] = useState(false),
    [retry, setRetry] = useState(false);
  const submission = useRef<{ text: string; id: string } | null>(null);
  const acknowledged = useRef(false),
    heading = useRef<View>(null);
  const headingId = `decision-heading-${useId()}`;
  const sender = useMateSender(mateId ?? "none");
  const seen = useRpc(markNeedsYouSeen),
    markNew = useRpc(markNeedsYouNew),
    snooze = useRpc(snoozeNeedsYou),
    unsnooze = useRpc(unsnoozeNeedsYou),
    record = useRpc(recordNeedsYouAnswer);
  const changed = useDecisionChanged();
  const target = {
    homeId: snapshot.homeId!,
    id: request.id,
    revision: request.revision,
  };
  const pending =
    request.state === "answer-sent" || request.state === "delivery-uncertain";
  const fresh =
    !offline &&
    snapshot.freshness.status === "fresh" &&
    !quarantinesSource(snapshot.quarantined ?? [], request.source);
  const writable = fresh && !pending && request.state !== "resolved" && !busy && !answered;
  useEffect(() => {
    focusWebElement(headingId);
  }, [headingId]);
  useEffect(() => {
    if (
      acknowledged.current ||
      !fresh ||
      !webSurfaceVisible(heading.current) ||
      (request.state !== "new" && request.state !== "seen")
    )
      return;
    acknowledged.current = true;
    if (request.seenRevision === request.revision && request.state === "seen")
      return;
    void seen(target)
      .then(changed)
      .catch((error) => {
        setNotice(errorText(error));
        changed();
      });
  }, [fresh, request.id, request.revision, request.state]);
  const colors = theme.colors;
  const inputStyle = {
    color: colors.foreground,
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: compact ? 48 : 76,
    maxHeight: compact ? 120 : 180,
    textAlignVertical: "top" as const,
  };
  function edit(value: string) {
    session.drafts.set(draftKey, value);
    setDraft(value);
  }
  async function mutate(
    task: () => Promise<NeedsYouSnapshot>,
    receipt?: string,
    { allowPending = false, answered = false } = {},
  ) {
    if (!(allowPending ? fresh && !busy : writable)) return;
    setBusy(true);
    setNotice("");
    try {
      const result = await task();
      const current = changed(result) ?? result;
      if (receipt) onCompleted(current, receipt, answered);
    } catch (error) {
      setNotice(errorText(error));
      changed();
    } finally {
      setBusy(false);
    }
  }
  function send(option?: Suggestion, retrying = false) {
    if ((!writable && !retrying) || !fresh || !mateId || sender.sending) return;
    const text = (option?.prompt ?? draft).trim();
    if (!text || (!option && (session.drafts.get(draftKey) ?? "") !== draft)) {
      setNotice(
        "The draft changed in another view. Reopen this decision before sending.",
      );
      return;
    }
    if (!submission.current || submission.current.text !== text || retrying)
      submission.current = { text, id: submissionId() };
    // Keep the exact submitted words for an uncertain-delivery recovery in this session.
    edit(text);
    setNotice("");
    const started = sender.answer(
      {
        homeId: snapshot.homeId!,
        requestId: request.id,
        recordRevision: request.revision,
        submissionId: submission.current.id,
        text,
        ...(option
          ? {
              suggestion: {
                actionId: option.decision!.actionId,
                label: option.label,
              },
            }
          : {}),
      },
      async (result) => {
        if (result.outcome === "accepted") {
          setAnswered(true);
          if (session.drafts.get(draftKey) === text) {
            session.drafts.delete(draftKey);
            setDraft("");
          }
          try {
            // The answer transport returns only the backlog ledger. Navigation needs plans too.
            const combined = await read({});
            onCompleted(changed(combined) ?? combined, "Answer sent.", true);
          } catch {
            setNotice("Answer sent. Refresh decisions to continue.");
            changed();
          }
        } else {
          changed(result.snapshot);
          setNotice(
            result.outcome === "uncertain"
              ? ""
              : "The answer was not sent. The draft is retained.",
          );
        }
      },
      () => {
        setNotice(
          "Could not confirm this submission. Refresh and check its status before trying again. The draft is retained.",
        );
        changed();
      },
    );
    if (!started)
      setNotice(
        "Another message is being sent. The draft is retained; try again when it finishes.",
      );
  }
  const choices = boundAnswers(
    snapshot.answerOptions ?? suggestions,
    snapshot.homeId!,
    request,
  );
  const latest = request.submissions.at(-1);
  const brief = briefFor(snapshot, request);
  const button = (
    label: string,
    onPress: () => void,
    disabled = false,
    primary = false,
  ) => (
    <DecisionButton
      theme={theme}
      compact={compact}
      label={label}
      onPress={onPress}
      disabled={disabled}
      primary={primary}
    />
  );
  const actions = (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {button("Snooze ▾", () => setSnoozing(true), !writable)}
        {button("Discuss first", () => onOpenChat?.({ homeId: snapshot.homeId!, requestId: request.id, recordRevision: request.revision }), !onOpenChat || !writable)}
        {compact ? (
          <DecisionButton
            theme={theme}
            compact
            label="More answer actions"
            text="⋯"
            onPress={() => setMenu(true)}
          />
        ) : (
          button(
            "I answered in chat",
            () =>
              void mutate(
                () =>
                  record({
                    ...target,
                    submissionId: submissionId(),
                    outcome: "accepted",
                  }),
                "Answer recorded.",
                { answered: true },
              ),
            !writable,
          )
        )}
      </View>
      {!compact ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>
          Stays in Needs you until you answer or snooze it.
        </Text>
      ) : null}
    </View>
  );
  const composer = (
    <View style={{ gap: 8 }}>
      {!compact ? (
        <SectionLabel theme={theme}>OR ANSWER IN YOUR OWN WORDS</SectionLabel>
      ) : null}
      <View
        style={{
          flexDirection: compact ? "row" : "column",
          gap: 8,
          alignItems: compact ? "flex-end" : "stretch",
        }}
      >
        <TextInput
          accessibilityLabel="Answer the first mate"
          multiline
          value={draft}
          onChangeText={edit}
          editable={!pending && request.state !== "resolved"}
          placeholder="Answer in your own words…"
          placeholderTextColor={colors.foregroundMuted}
          style={[inputStyle, compact ? { flex: 1 } : {}]}
        />
        <View style={{ alignItems: "flex-end" }}>
          {button(
            sender.sending ? "Sending answer…" : "Send answer",
            () => send(),
            !writable || !mateId || sender.sending || !draft.trim(),
            true,
          )}
        </View>
      </View>
      {!mateId ? (
        <Text style={{ color: colors.statusWarning }}>
          No first mate is available to receive an answer.
        </Text>
      ) : null}
    </View>
  );
  return (
    <>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          ...readableContent,
          padding: compact ? 16 : 20,
          gap: 16,
          paddingBottom: 24,
        }}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
      >
        {chrome}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text
            style={{ color: colors.foregroundMuted, fontSize: 12, flex: 1 }}
          >
            {request.state === "new" ? "NEW · " : ""}
            {pending ||
            request.state === "snoozed" ||
            request.state === "resolved"
              ? decisionStateLabel(request)
              : `waiting ${relativeDecisionTime(request.detectedAt)}`}{" "}
            · {request.source.project ?? request.source.taskId} ·{" "}
            {request.source.hostId === "local"
              ? "This machine"
              : request.source.hostId}
          </Text>
          <DecisionButton
            theme={theme}
            compact={compact}
            label="Decision actions"
            text="⋯"
            onPress={() => setMenu(true)}
          />
        </View>
        <View ref={heading}>
          <Text
            nativeID={headingId}
            {...webAttributes({ tabindex: "-1", "aria-level": "3" })}
            accessibilityRole="header"
            style={{
              color: colors.foreground,
              fontSize: 18,
              fontWeight: "600",
              outlineWidth: 0,
            }}
          >
            {request.source.title}
          </Text>
        </View>
        {openedRevision !== undefined && openedRevision !== request.revision ? (
          <Text
            accessibilityRole="alert"
            style={{ color: colors.statusWarning }}
          >
            The question changed since you opened it. This is the current
            question; earlier drafts are retained separately.
          </Text>
        ) : null}
        {request.state === "delivery-uncertain" ? (
          <View
            style={{
              gap: 10,
              borderWidth: 1,
              borderColor: colors.statusWarning,
              padding: 12,
              borderRadius: 8,
            }}
          >
            <Text style={{ color: colors.statusWarning, fontWeight: "600" }}>
              Delivery not confirmed
            </Text>
            <Text style={{ color: colors.foreground, fontSize: 13 }}>
              We couldn’t confirm the first mate got the answer. Check its chat
              before sending again, so it isn’t asked twice.
            </Text>
            {draft ? (
              <Text
                selectable
                style={{ color: colors.foreground, fontSize: 13 }}
              >
                Your words: {draft}
              </Text>
            ) : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {button(
                "Open the first mate’s chat",
                () => onOpenChat?.({ homeId: snapshot.homeId!, requestId: request.id, recordRevision: request.revision }),
                !onOpenChat,
                true,
              )}
              {button(
                "It arrived",
                () =>
                  void mutate(
                    () =>
                      record({
                        ...target,
                        submissionId: latest!.submissionId,
                        outcome: "accepted",
                      }),
                    `Delivery confirmed on ${decisionTitle(request.source.title)}.`,
                    { allowPending: true, answered: true },
                  ),
                !fresh || busy || !latest,
              )}
              {button(
                "Send again…",
                () => setRetry(true),
                !fresh || busy || !mateId || !latest,
              )}
            </View>
          </View>
        ) : null}
        {request.state === "answer-sent" ? (
          <Text style={{ color: colors.foreground }}>
            Answer sent. Waiting for the first mate to record the outcome.
          </Text>
        ) : null}
        {request.state === "resolved" ? (
          <Text style={{ color: colors.foreground }}>
            Settled ·{" "}
            {request.resolution?.reason === "completed"
              ? "task completed"
              : request.resolution?.reason === "deferred"
                ? "parked for later"
                : request.resolution?.reason === "superseded"
                  ? "question replaced"
                  : "hold lifted"}
          </Text>
        ) : null}
        <View
          style={{
            gap: 8,
            padding: 14,
            borderLeftWidth: 3,
            borderLeftColor: colors.statusWarning,
            borderRadius: 8,
            backgroundColor: colors.surface1,
          }}
        >
          <SectionLabel theme={theme}>
            {pending || request.state === "resolved"
              ? "THE FIRST MATE ASKED"
              : "THE FIRST MATE ASKS"}
          </SectionLabel>
          <DecisionAsk
            theme={theme}
            source={request.source}
            homeId={snapshot.homeId!}
            onOpenFile={setFile}
          />
        </View>
        {brief ? <DecisionBrief theme={theme} content={brief.content} answer={label => {
          const choice = choices.find(choice => choice.label === label && choice.decision?.actionId.startsWith("brief:"));
          return choice && !pending && request.state !== "resolved" ? button(`Choose: ${label}`, () => send(choice), !writable || !mateId || sender.sending) : null;
        }} /> : null}
        <DecisionMaterials
          theme={theme}
          source={request.source}
          homeId={snapshot.homeId!}
          onOpenFile={setFile}
          compact={compact}
        />
        {choices.some(choice => !brief || !choice.decision?.actionId.startsWith("brief:")) && !pending && request.state !== "resolved" ? (
          <View style={{ gap: 8 }}>
            <SectionLabel theme={theme}>THE FIRST MATE SUGGESTS</SectionLabel>
            {choices.filter(choice => !brief || !choice.decision?.actionId.startsWith("brief:")).map((choice) => (
              <View
                key={choice.decision!.actionId}
                style={{
                  borderWidth: 1,
                  borderColor: colors.accent,
                  borderRadius: 8,
                  padding: 12,
                  gap: 8,
                  alignItems: "flex-start",
                }}
              >
                {button(
                  choice.label,
                  () => send(choice),
                  !writable || !mateId || sender.sending,
                  true,
                )}
                <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
                  Sends: {choice.prompt}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {request.state === "snoozed"
          ? button(
              "Bring back now",
              () => void mutate(() => unsnooze(target)),
              !writable,
            )
          : null}
        {!compact && !pending && request.state !== "resolved" ? (
          <>
            {composer}
            <View
              style={{
                borderTopWidth: 1,
                borderColor: colors.border,
                paddingTop: 14,
              }}
            >
              {actions}
            </View>
          </>
        ) : null}
        {notice ? (
          <Text accessibilityRole="alert" style={{ color: colors.foreground }}>
            {notice}
          </Text>
        ) : null}
      </ScrollView>
      {compact && !pending && request.state !== "resolved" ? (
        <SafeAreaView
          style={{
            borderTopWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface0,
          }}
        >
          <View style={{ padding: 12, gap: 10 }}>
            {actions}
            {composer}
          </View>
        </SafeAreaView>
      ) : null}
      <DecisionSnooze
        theme={theme}
        open={snoozing}
        onClose={() => setSnoozing(false)}
        onChoose={(until) =>
          void mutate(
            () => snooze({ ...target, until }),
            `Snoozed ${decisionTitle(request.source.title)} until ${new Date(until).toLocaleDateString()} at ${decisionClock(until)}.`,
          )
        }
      />
      <Modal title="Decision actions" open={menu} onOpenChange={setMenu}>
        <Modal.Content>
          <View style={{ gap: 12 }}>
            <Text selectable style={{ color: colors.foreground }}>
              {request.source.title}
            </Text>
            {compact
              ? button(
                  "I answered in chat",
                  () => {
                    setMenu(false);
                    void mutate(
                      () =>
                        record({
                          ...target,
                          submissionId: submissionId(),
                          outcome: "accepted",
                        }),
                      "Answer recorded.",
                      { answered: true },
                    );
                  },
                  !writable,
                )
              : null}
            {button(
              "Mark as new",
              () => {
                setMenu(false);
                void mutate(() => markNew(target));
              },
              !writable,
            )}
          </View>
        </Modal.Content>
      </Modal>
      <Modal
        title="Send this answer again?"
        open={retry}
        onOpenChange={setRetry}
      >
        <Modal.Content>
          <View style={{ gap: 12 }}>
            <Text style={{ color: colors.foreground }}>
              Only send again after checking the first mate’s chat. This records
              the previous attempt as not delivered and sends a new message.
            </Text>
            <TextInput
              accessibilityLabel="Answer to send again"
              multiline
              value={draft}
              onChangeText={edit}
              placeholder="Enter the answer to send again…"
              placeholderTextColor={colors.foregroundMuted}
              style={inputStyle}
            />
            {button(
              "Confirm and send again",
              () => {
                if (
                  !latest ||
                  busy ||
                  !fresh ||
                  sender.sending ||
                  !draft.trim()
                )
                  return;
                setBusy(true);
                void record({
                  ...target,
                  submissionId: latest.submissionId,
                  outcome: "failed",
                })
                  .then((result) => {
                    changed(result);
                    setRetry(false);
                    send(undefined, true);
                  })
                  .catch((error) => setNotice(errorText(error)))
                  .finally(() => setBusy(false));
              },
              !fresh || busy || sender.sending || !draft.trim(),
              true,
            )}
            {button("Cancel", () => setRetry(false))}
          </View>
        </Modal.Content>
      </Modal>
      <SourceFile
        theme={theme}
        compact={compact}
        path={file}
        onClose={() => setFile(null)}
      />
    </>
  );
}
