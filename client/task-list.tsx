/** One scroll container; ledger decisions are global, ordinary tasks remain filtered. */
import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { FleetCard } from "../shared/fleet";
import type { BoardDensity } from "../shared/settings";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import { decisionCountText } from "./needs-you-state";
import { CrewCard } from "./card";
import { converseKey, conversingWith } from "./converse-layout";
import { activeDecisions, presentedTasks, OWNER_LABELS, TASK_TITLES, type TaskOwner } from "./task-presentation";
import { DecisionTask, DecisionQueueNote } from "./decision-tasks";

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
}
export function TaskList(props: TaskListProps) {
  const { cards, snapshot, theme, compact } = props;
  const requests = activeDecisions(snapshot),
    tasks = presentedTasks(cards, snapshot);
  const heading = { color: theme.colors.foregroundMuted, fontSize: 13, fontWeight: "600" as const };
  function renderTasks(entries: typeof tasks) {
    return entries.map(({ card, summary }) => (
      <CrewCard
        key={card.key}
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
      />
    ));
  }
  return (
    <ScrollView
      testID="firstmate-task-list"
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: compact ? 12 : 16, gap: 18, paddingBottom: 24 }}
      automaticallyAdjustKeyboardInsets
    >
      <View testID="task-group-needs-you" style={{ gap: 8 }}>
        <Text
          accessibilityRole="header"
          style={[heading, { color: snapshot?.newCount ? theme.colors.statusWarning : theme.colors.foregroundMuted }]}
        >
          Needs you · {decisionCountText(snapshot, props.offline)}
        </Text>
        <DecisionQueueNote theme={theme} snapshot={snapshot} offline={props.offline} />
        {requests.map((request) => (
          <DecisionTask
            key={request.id}
            request={request}
            snapshot={snapshot!}
            cards={props.allCards ?? cards}
            theme={theme}
            compact={compact}
            onConverse={props.onConverse}
            onChanged={props.onChanged}
          />
        ))}
        {snapshot?.actionCount === 0 && snapshot.freshness.status === "fresh" && !props.offline ? <Text style={heading}>Nothing needs a decision now.</Text> : null}
      </View>
      <View testID="task-group-in-hand" style={{ gap: 8 }}>
        <Text accessibilityRole="header" style={heading}>
          In hand · {tasks.filter((entry) => entry.summary.group === "in-hand").length}
        </Text>
        {(["first-mate", "worker", "parked"] as TaskOwner[]).map((owner) => {
          const entries = tasks.filter((entry) => entry.summary.group === "in-hand" && entry.summary.owner === owner);
          return entries.length ? (
            <View key={owner}>
              <Text accessibilityRole="header" style={{ ...heading, fontSize: 12, paddingVertical: 8 }}>
                {OWNER_LABELS[owner]} · {entries.length}
              </Text>
              {renderTasks(entries)}
            </View>
          ) : null;
        })}
      </View>
      {(["later", "done"] as const).map((group) => {
        const entries = tasks.filter((entry) => entry.summary.group === group),
          show = group === "done" ? props.showDone : props.showLater === true;
        return (
          <View key={group} testID={`task-group-${group}`}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${TASK_TITLES[group]} · ${entries.length}. ${show ? "Hide" : "Show"} tasks`}
              accessibilityState={{ expanded: show, disabled: props.layoutDisabled === true }}
              aria-expanded={show}
              disabled={props.layoutDisabled === true}
              onPress={() => (group === "done" ? props.onShowDone(!show) : props.onShowLater?.(!show))}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text style={heading}>
                {TASK_TITLES[group]} · {entries.length} · {show ? "Hide" : "Show"}
              </Text>
            </Pressable>
            {show ? renderTasks(entries) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}
