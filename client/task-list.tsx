/** One scroll container; ledger decisions are global, ordinary tasks remain filtered. */
import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useEffect, useRef, useState } from "react";
import type { FleetCard } from "../shared/fleet";
import type { BoardDensity } from "../shared/settings";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import { decisionCountText, indicatorState } from "./needs-you-state";
import { useDecisionReadState } from "./decision-read-context";
import { CrewCard } from "./card";
import { converseKey, conversingWith } from "./converse-layout";
import { activeDecisions, matchingDecisionMessage, presentedTasks, taskSourceKey, waitingOver30Minutes, OWNER_LABELS, TASK_TITLES, type TaskOwner } from "./task-presentation";
import { DecisionTask, DecisionQueueNote } from "./decision-tasks";
import { PlanNeeds } from "./workflow-plans";
import { webAttributes } from "./web";

export interface TaskListProps {
  cards: readonly FleetCard[];
  allCards?: readonly FleetCard[];
  snapshot?: NeedsYouSnapshot | undefined;
  offline?: boolean | undefined;
  theme: PluginTheme;
  compact: boolean;
  density: BoardDensity;
  conversing: string | null;
  onConverse(key: string): void;
  onChanged(): void;
  showDone: boolean;
  onShowDone(show: boolean): void;
  showLater?: boolean;
  onShowLater?(show: boolean): void;
  layoutDisabled?: boolean;
  filtered?: boolean;
  reveal?: { card: string; request: object } | null;
  onRevealed?(request: object): void;
}
export function TaskList(props: TaskListProps) {
  const { cards, snapshot, theme, compact } = props;
  const read = useDecisionReadState();
  const decisionState = indicatorState(snapshot, props.offline, read);
  const requests = activeDecisions(snapshot),
    tasks = presentedTasks(cards, snapshot);
  const heading = { color: theme.colors.foregroundMuted, fontSize: 13, fontWeight: "600" as const };
  const matchingNotice = props.filtered ? matchingDecisionMessage(cards, snapshot) : null;
  const scroller = useRef<ScrollView>(null), target = useRef<View>(null), scrolled = useRef<object | null>(null);
  function scrollToTask() {
    if (!props.reveal || scrolled.current === props.reveal.request || !target.current || !scroller.current) return;
    const request = props.reveal.request;
    target.current.measureLayout(scroller.current.getInnerViewNode(), (_x, y) => {
      if (!scroller.current || scrolled.current === request) return;
      scroller.current.scrollTo({ y: Math.max(0, y - 8), animated: false }); scrolled.current = request;
      props.onRevealed?.(request);
    }, () => {});
  }
  useEffect(scrollToTask, [props.reveal]);
  const revealed = (props.allCards ?? cards).find(card => card.key === props.reveal?.card);
  const revealGroup = tasks.find(entry => entry.card.key === props.reveal?.card)?.summary.group ?? null;
  const [revealedGroup, setRevealedGroup] = useState(revealGroup);
  // Consuming the scroll must not hide the group we just revealed. A fold clears it.
  useEffect(() => { if (props.reveal) setRevealedGroup(revealGroup); }, [props.reveal?.request, revealGroup]);
  function renderTasks(entries: typeof tasks) {
    return entries.map(({ card, summary }) => (
      <View key={card.key} ref={card.key === props.reveal?.card ? target : undefined} collapsable={card.key !== props.reveal?.card} onLayout={scrollToTask}>
        <CrewCard
          card={card}
          summary={summary}
          decisionHomeId={snapshot?.homeId}
          theme={theme}
          compact={compact}
          density={props.density}
          presentation="row"
          opener={null}
          onConverse={() => props.onConverse(converseKey(card))}
          conversing={conversingWith(card, props.conversing)}
          onChanged={props.onChanged}
          reveal={card.key === props.reveal?.card ? props.reveal.request : undefined}
        />
      </View>
    ));
  }
  return (
    <ScrollView
      ref={scroller}
      onContentSizeChange={scrollToTask}
      testID="firstmate-task-list"
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: compact ? 12 : 16, gap: 18, paddingBottom: 24 }}
      automaticallyAdjustKeyboardInsets
    >
      <View testID="task-group-needs-you" style={{ gap: 6 }}>
        <Text
          accessibilityRole="header"
          {...webAttributes({ "aria-level": "2" })}
          style={[heading, { color: snapshot?.actionCount ? theme.colors.statusWarning : theme.colors.foregroundMuted }]}
        >
          Needs you · {decisionCountText(snapshot, props.offline, read)}
        </Text>
        {decisionState.lastUpdated ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{decisionState.lastUpdated}</Text> : null}
        <DecisionQueueNote theme={theme} snapshot={snapshot} offline={props.offline} filtered={props.filtered} />
        {requests.map((request) => {
          const reveal = revealed && taskSourceKey(revealed) === request.source.key ? props.reveal?.request : undefined;
          return <View key={request.id} ref={reveal ? target : undefined} collapsable={!reveal} onLayout={scrollToTask}>
            <DecisionTask
              request={request}
              snapshot={snapshot!}
              cards={props.allCards ?? cards}
              theme={theme}
              compact={compact}
              onConverse={props.onConverse}
              onChanged={props.onChanged}
              reveal={reveal}
            />
          </View>;
        })}
        <PlanNeeds theme={theme} snapshot={snapshot} showUpcoming={false} showReviews={false} />
        {decisionState.count === 0 && decisionState.fresh ? <Text style={heading}>Nothing needs a decision now.</Text> : null}
      </View>
      {matchingNotice ? <Text style={heading}>{matchingNotice}</Text> : null}
      <View testID="task-group-in-hand" style={{ gap: 8 }}>
        <Text accessibilityRole="header" {...webAttributes({ "aria-level": "2" })} style={heading}>
          In hand · {tasks.filter((entry) => entry.summary.group === "in-hand").length}
        </Text>
        {(["first-mate", "worker", "parked", "unknown"] as TaskOwner[]).map((owner) => {
          const entries = tasks.filter((entry) => entry.summary.group === "in-hand" && entry.summary.owner === owner);
          return entries.length ? (
            <View key={owner}>
              <Text accessibilityRole="header" {...webAttributes({ "aria-level": "3" })} style={{ ...heading, fontSize: 12, paddingVertical: 8 }}>
                {OWNER_LABELS[owner]} · {entries.length}
                {waitingOver30Minutes(entries) ? <Text style={{ color: theme.colors.statusWarning }}> · {waitingOver30Minutes(entries)} waiting over 30m</Text> : null}
              </Text>
              {renderTasks(entries)}
            </View>
          ) : null;
        })}
      </View>
      {(["later", "done"] as const).map((group) => {
        const entries = tasks.filter((entry) => entry.summary.group === group),
          show = (group === "done" ? props.showDone : props.showLater === true) || revealedGroup === group;
        return (
          <View key={group} testID={`task-group-${group}`}>
            <View accessibilityRole="header" {...webAttributes({ "aria-level": "2" })}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${TASK_TITLES[group]} · ${entries.length}. ${show ? "Hide" : "Show"} tasks`}
                accessibilityState={{ expanded: show, disabled: props.layoutDisabled === true }}
                aria-expanded={show}
                disabled={props.layoutDisabled === true}
                onPress={() => { setRevealedGroup(null); if (group === "done") props.onShowDone(!show); else props.onShowLater?.(!show); }}
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                <Text style={heading}>
                  {TASK_TITLES[group]} · {entries.length} · {show ? "Hide" : "Show"}
                </Text>
              </Pressable>
            </View>
            {show ? renderTasks(entries) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}
