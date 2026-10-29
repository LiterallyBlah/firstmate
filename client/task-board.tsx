import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { FleetCard } from "../shared/fleet";
import type { BoardDensity } from "../shared/settings";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import { moveTaskColumn, orderedTaskColumns, type TaskColumn, type TaskLayout } from "../shared/task-layout";
import { decisionCountText, indicatorState } from "./needs-you-state";
import { useDecisionReadState } from "./decision-read-context";
import { CrewCard } from "./card";
import { converseKey, conversingWith } from "./converse-layout";
import { activeDecisions, matchingDecisionMessage, presentedTasks, waitingOver30Minutes, OWNER_LABELS, TASK_TITLES, type TaskOwner } from "./task-presentation";
import { DecisionQueueNote, DecisionTask } from "./decision-tasks";
import { PlanNeeds } from "./workflow-plans";
import { webAttributes } from "./web";

export function TaskBoard(props: {
  cards: readonly FleetCard[];
  allCards: readonly FleetCard[];
  snapshot?: NeedsYouSnapshot | undefined;
  offline: boolean;
  filtered?: boolean;
  theme: PluginTheme;
  compact: boolean;
  density: BoardDensity;
  conversing: string | null;
  layout: TaskLayout;
  layoutDisabled: boolean;
  onLayout(patch: Partial<TaskLayout>): void;
  onConverse(key: string): void;
  onChanged(): void;
}) {
  const { theme, snapshot, compact, layout } = props,
    colors = theme.colors;
  const read = useDecisionReadState();
  const decisionState = indicatorState(snapshot, props.offline, read);
  const tasks = presentedTasks(props.cards, snapshot),
    requests = activeDecisions(snapshot);
  const order = orderedTaskColumns(layout.order);
  const matchingNotice = props.filtered ? matchingDecisionMessage(props.cards, snapshot) : null;
  function control(label: string, onPress: () => void, disabled = false) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled || props.layoutDisabled}
        accessibilityState={{ disabled: disabled || props.layoutDisabled }}
        onPress={onPress}
        style={{ minWidth: 44, minHeight: 44, padding: 8, justifyContent: "center", opacity: disabled ? 0.4 : 1 }}
      >
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
          {label.endsWith("left") || label.endsWith("up") ? "‹" : "›"}
        </Text>
      </Pressable>
    );
  }
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
        opener={null}
        onConverse={() => props.onConverse(converseKey(card))}
        conversing={conversingWith(card, props.conversing)}
        onChanged={props.onChanged}
      />
    ));
  }
  function column(id: TaskColumn) {
    const folded = layout.collapsed.includes(id),
      entries = tasks.filter((entry) => entry.summary.group === id);
    const count = id === "needs-you" ? decisionCountText(snapshot, props.offline, read) : entries.length;
    const ink =
      id === "needs-you" && ((folded && (decisionState.count ?? 0) > 0) || !!snapshot?.newCount)
        ? colors.statusWarning
        : colors.foregroundMuted;
    const body =
      id === "needs-you" ? (
        <>
          <DecisionQueueNote theme={theme} snapshot={snapshot} offline={props.offline} filtered={props.filtered} />
          {matchingNotice ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{matchingNotice}</Text> : null}
          {requests.map((request) => (
            <DecisionTask
              key={request.id}
              request={request}
              presentation="card"
              snapshot={snapshot!}
              cards={props.allCards}
              theme={theme}
              compact={compact}
              onConverse={props.onConverse}
              onChanged={props.onChanged}
            />
          ))}
          <PlanNeeds theme={theme} snapshot={snapshot} showUpcoming={false} showReviews={false} />
          {decisionState.count === 0 && decisionState.fresh ? <Text style={{ color: ink }}>Nothing needs a decision now.</Text> : null}
        </>
      ) : entries.length === 0 ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
          {id === "in-hand" ? "No tasks in hand." : id === "later" ? "No tasks waiting for later." : "No completed tasks."}
        </Text>
      ) : id === "in-hand" ? (
        (["first-mate", "worker", "parked", "unknown"] as TaskOwner[]).map((owner) => {
          const owned = entries.filter((entry) => entry.summary.owner === owner);
          return owned.length ? (
            <View key={owner} style={{ gap: 8 }}>
              <Text accessibilityRole="header" {...webAttributes({ "aria-level": "3" })} style={{ color: colors.foregroundMuted, fontSize: 12 }}>
                {OWNER_LABELS[owner]} · {owned.length}
                {waitingOver30Minutes(owned) ? <Text style={{ color: colors.statusWarning }}> · {waitingOver30Minutes(owned)} waiting over 30m</Text> : null}
              </Text>
              {renderTasks(owned)}
            </View>
          ) : null;
        })
      ) : (
        renderTasks(entries)
      );
    return (
      <View
        key={id}
        testID={`task-column-${id}`}
        style={{
          padding: 8,
          gap: 8,
          borderWidth: 1,
          borderColor: id === "needs-you" ? ink : colors.border,
          borderRadius: 8,
          backgroundColor: colors.surface1,
          ...(compact
            ? { minWidth: 0 }
            : { width: folded ? 60 : 280, minWidth: folded ? 60 : 260, flexGrow: folded ? 0 : 1, flexShrink: 0 }),
        }}
      >
        <View style={{ flexDirection: folded && !compact ? "column" : "row", alignItems: "center", flexShrink: 0 }}>
          <View accessibilityRole="header" {...webAttributes({ "aria-level": "2" })} style={{ flex: compact || !folded ? 1 : undefined }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${folded ? "Unfold" : "Fold"} ${TASK_TITLES[id]} · ${count}`}
              accessibilityState={{ expanded: !folded, disabled: props.layoutDisabled }}
              aria-expanded={!folded}
              disabled={props.layoutDisabled}
              onPress={() =>
                props.onLayout({
                  collapsed: folded ? layout.collapsed.filter((value) => value !== id) : [...layout.collapsed, id],
                })
              }
              style={{
                minHeight: 44,
                minWidth: 44,
                ...(folded && !compact ? { width: 44, height: 180 } : {}),
                justifyContent: "center",
                gap: 4,
              }}
            >
              <Text style={{ color: ink, fontSize: 13, fontWeight: "600",
                ...(folded && !compact ? { position: "absolute", width: 180, left: -68, top: 80, textAlign: "center", transform: [{ rotate: "90deg" }] } : {}) }}>
                {TASK_TITLES[id]} · {count} {folded ? "›" : "⌄"}
              </Text>
            </Pressable>
          </View>
          {folded || id === "needs-you" ? null : (
            <>
              {control(
                `Move ${TASK_TITLES[id]} ${compact ? "up" : "left"}`,
                () => props.onLayout({ order: moveTaskColumn(order, id, -1) }),
                order.indexOf(id) === 1,
              )}
              {control(
                `Move ${TASK_TITLES[id]} ${compact ? "down" : "right"}`,
                () => props.onLayout({ order: moveTaskColumn(order, id, 1) }),
                order.indexOf(id) === order.length - 1,
              )}
            </>
          )}
        </View>
        {folded ? null : compact ? (
          <View style={{ gap: 10 }}>{body}</View>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
            {body}
          </ScrollView>
        )}
      </View>
    );
  }
  return (
    <ScrollView
      testID="firstmate-task-board"
      horizontal={!compact}
      style={{ flex: 1 }}
      contentContainerStyle={{
        padding: 12,
        gap: 12,
        ...(compact ? { paddingBottom: 24 } : { flexDirection: "row", flexGrow: 1, alignItems: "stretch" }),
      }}
      automaticallyAdjustKeyboardInsets={compact}
    >
      {order.map(column)}
    </ScrollView>
  );
}
