/**
 * The crew board: seven columns in the order the captain arranged them, each
 * foldable to a narrow strip. A column with nobody in it is not drawn at all,
 * folded or not. On a wide screen the rest sit in one row when there are three
 * or fewer and in two past that, the extra in the second; on a phone they
 * stack, and a folded column is one line.
 *
 * On a wide screen the first mate's suggestions sit first among the columns,
 * as a card that counts toward the rows but never folds or moves. A phone
 * shows them in a tab of their own instead, so the board is given none there.
 * The home's watches are a card after the columns, the same way, and on a
 * phone the last section of the list.
 *
 * Done shows its latest few cards, newest first, until the captain asks for
 * all of them: finished work is looked back on, not watched, and a full Done
 * column outgrew everything else on the board.
 *
 * Columns move with their header's arrows rather than by dragging: a drag
 * needs document-level pointer tracking on the web and fights every scroll
 * view it crosses, and two arrows work the same everywhere.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import type { ColumnId, FleetCard, Suggestion, WatchSummary } from "../shared/fleet";
import type { BoardDensity } from "../shared/settings";
import { CrewCard } from "./card";
import {
  boardItems,
  boardRows,
  COLUMNS,
  columnTone,
  DONE_SHOWN,
  doneCards,
  groupCards,
  moveColumn,
  SUGGESTIONS_CARD,
  WATCHES_CARD,
} from "./format";
import { watchKey } from "./host-tabs";
import { SUGGESTIONS_ICON, SUGGESTIONS_TITLE, SuggestionList } from "./suggestions";
import { WATCHES_ICON, WATCHES_TITLE, WatchList } from "./watches";

const COLLAPSED_WIDTH = 40;

/** Whether Done shows every card, kept across a remount like the rest of the surface's state. */
let allDoneShown = false;

interface BoardProps {
  cards: readonly FleetCard[];
  order: readonly ColumnId[];
  collapsed: readonly string[];
  theme: PluginTheme;
  compact: boolean;
  /** The board's spacing, from the display settings. */
  density: BoardDensity;
  /** Drawn as the first card of a wide board; empty draws no card. */
  suggestions: readonly Suggestion[];
  /** A message to the first mate is on its way, so the suggestions wait. */
  suggesting: boolean;
  /** Sends a suggestion's prompt to the first mate. */
  onSuggest: (prompt: string) => void;
  /** Takes a suggestion off the first mate's list without sending it. */
  onRemoveSuggestion: (suggestion: Suggestion) => Promise<void>;
  /** The home's watch scripts: a card after the columns, or the list's last section; empty draws neither. */
  watches: readonly WatchSummary[];
  /** Opens a home file in the Files view: the tab on a phone, the right-hand pane on a wide layout. */
  onOpenFile: (path: string) => void;
  /** Shows one crewmate's card and transcript — or a remote worker's card and log — in place of the board, by `watchKey`. */
  onWatch: (key: string) => void;
  onToggleColumn: (id: ColumnId) => void;
  /** Saves a new whole column order, hidden columns included. */
  onReorder: (order: ColumnId[]) => void;
  onChanged: () => void;
}

export function Board(props: BoardProps) {
  const { cards, order, collapsed, theme, compact, density, suggestions, watches } = props;
  const [allDone, setAllDoneState] = useState(allDoneShown);
  function setAllDone(next: boolean): void {
    allDoneShown = next;
    setAllDoneState(next);
  }
  const dense = density === "compact";
  const groups = useMemo(() => groupCards(cards), [cards]);
  const shown = useMemo(() => order.filter((id) => (groups.get(id)?.length ?? 0) > 0), [order, groups]);
  const space = dense ? 10 : 14;
  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      board: { flex: 1, padding: 12, gap: space },
      stack: { gap: space, padding: compact ? 10 : 12, paddingBottom: 24 },
      nobody: { padding: compact ? 10 : 12, color: colors.foregroundMuted, fontSize: 12 },
      row: { flex: 1, minHeight: 0, flexDirection: "row" as const, gap: space },
      // A column is told apart by its fill alone; the cards in it carry the only borders.
      column: {
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: 0,
        minWidth: 0,
        borderRadius: 12,
        backgroundColor: colors.surface1,
        padding: dense ? 8 : 10,
        gap: dense ? 8 : 10,
      },
      columnStacked: {
        borderRadius: 12,
        backgroundColor: colors.surface1,
        padding: dense ? 8 : 10,
        gap: dense ? 8 : 10,
      },
      columnFolded: { flexGrow: 0, flexBasis: COLLAPSED_WIDTH, width: COLLAPSED_WIDTH, alignItems: "center" as const },
      header: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, minHeight: 24 },
      headerFolded: { alignItems: "center" as const, gap: 8 },
      title: { flexShrink: 1, color: colors.foreground, fontSize: 13, fontWeight: "600" as const },
      count: {
        color: colors.foregroundMuted,
        fontSize: 11,
        fontWeight: "600" as const,
        backgroundColor: colors.surface2,
        borderRadius: 999,
        paddingHorizontal: 7,
        paddingVertical: 1,
        overflow: "hidden" as const,
      },
      spacer: { flex: 1 },
      arrow: { padding: 3, opacity: 0.7 },
      body: { gap: space - 4, paddingBottom: 4 },
      more: { alignSelf: "flex-start" as const, paddingHorizontal: 6, paddingVertical: 4 },
      moreText: { color: colors.foregroundMuted, fontSize: 12, fontWeight: "500" as const },
      foldedTitle: {
        color: colors.foregroundMuted,
        fontSize: 11,
        transform: [{ rotate: "90deg" }],
        width: 120,
        textAlign: "center" as const,
        marginTop: 56,
      },
    };
  }, [theme, compact, dense]);

  function renderHeader(id: ColumnId, folded: boolean, count: number) {
    const meta = COLUMNS[id];
    const tone = columnTone(theme, id);
    const index = shown.indexOf(id);
    const toggle = (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${folded ? "Unfold" : "Fold"} ${meta.title}`}
        style={styles.arrow}
        onPress={() => props.onToggleColumn(id)}
      >
        <Icon name={folded ? "ChevronRight" : "ChevronDown"} size={14} color={theme.colors.foregroundMuted} />
      </Pressable>
    );
    if (folded && !compact) {
      return (
        <View style={styles.headerFolded}>
          {toggle}
          <Icon name={meta.icon} size={14} color={tone} />
          <Text style={styles.count}>{count}</Text>
        </View>
      );
    }
    return (
      <View style={styles.header}>
        {toggle}
        <Icon name={meta.icon} size={14} color={tone} />
        <Text style={styles.title} numberOfLines={1}>
          {meta.title}
        </Text>
        <Text style={styles.count}>{count}</Text>
        <View style={styles.spacer} />
        {folded ? null : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Move ${meta.title} ${compact ? "up" : "left"}`}
              accessibilityState={{ disabled: index <= 0 }}
              disabled={index <= 0}
              style={styles.arrow}
              onPress={() => props.onReorder(moveColumn(order, id, -1, shown))}
            >
              <Icon name={compact ? "ChevronUp" : "ChevronLeft"} size={13} color={theme.colors.foregroundMuted} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Move ${meta.title} ${compact ? "down" : "right"}`}
              accessibilityState={{ disabled: index >= shown.length - 1 }}
              disabled={index >= shown.length - 1}
              style={styles.arrow}
              onPress={() => props.onReorder(moveColumn(order, id, 1, shown))}
            >
              <Icon name={compact ? "ChevronDown" : "ChevronRight"} size={13} color={theme.colors.foregroundMuted} />
            </Pressable>
          </>
        )}
      </View>
    );
  }

  function renderCards(id: ColumnId, entries: readonly FleetCard[]) {
    if (id !== "done") return entries.map(renderCard);
    const { shown } = doneCards(entries, allDone);
    return (
      <>
        {shown.map(renderCard)}
        {entries.length > DONE_SHOWN ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={allDone ? "Show only the latest Done cards" : `Show all ${entries.length} Done cards`}
            style={styles.more}
            onPress={() => setAllDone(!allDone)}
          >
            <Text style={styles.moreText}>{allDone ? `Show the latest ${DONE_SHOWN}` : `Show all ${entries.length}`}</Text>
          </Pressable>
        ) : null}
      </>
    );
  }

  function renderCard(card: FleetCard) {
    const key = watchKey(card);
    return (
      <CrewCard
        key={card.key}
        card={card}
        theme={theme}
        compact={compact}
        density={density}
        opener={key === null ? null : { icon: "Eye", label: "Watch", onPress: () => props.onWatch(key) }}
        onChanged={props.onChanged}
      />
    );
  }

  function renderWatchesHeader() {
    return (
      <View style={styles.header}>
        <Icon name={WATCHES_ICON} size={14} color={theme.colors.accent} />
        <Text style={styles.title} numberOfLines={1}>
          {WATCHES_TITLE}
        </Text>
        <Text style={styles.count}>{watches.length}</Text>
      </View>
    );
  }

  const withSuggestions = !compact && suggestions.length > 0;
  const withWatches = watches.length > 0;
  const nobody = <Text style={styles.nobody}>No crew on the board.</Text>;
  if (shown.length === 0 && !withSuggestions && !withWatches) return nobody;

  if (compact) {
    return (
      // The steer and relaunch boxes on a card are inside this list; on iOS the
      // system insets it for the keyboard and scrolls the focused box into view.
      <ScrollView contentContainerStyle={styles.stack} automaticallyAdjustKeyboardInsets>
        {shown.length === 0 ? nobody : null}
        {shown.map((id) => {
          const entries = groups.get(id) ?? [];
          const folded = collapsed.includes(id);
          return (
            <View key={id} style={styles.columnStacked}>
              {renderHeader(id, folded, entries.length)}
              {folded ? null : <View style={styles.body}>{renderCards(id, entries)}</View>}
            </View>
          );
        })}
        {withWatches ? (
          <View style={styles.columnStacked}>
            {renderWatchesHeader()}
            <WatchList watches={watches} theme={theme} onChanged={props.onChanged} onOpenFile={props.onOpenFile} />
          </View>
        ) : null}
      </ScrollView>
    );
  }

  return (
    <View style={styles.board}>
      {boardRows(boardItems(shown, withSuggestions, withWatches)).map((row) => (
        <View key={row.join(",")} style={styles.row}>
          {row.map((id) => {
            if (id === SUGGESTIONS_CARD) {
              return (
                <View key={id} style={styles.column}>
                  <View style={styles.header}>
                    <Icon name={SUGGESTIONS_ICON} size={14} color={theme.colors.accent} />
                    <Text style={styles.title} numberOfLines={1}>
                      {SUGGESTIONS_TITLE}
                    </Text>
                    <Text style={styles.count}>{suggestions.length}</Text>
                  </View>
                  <ScrollView contentContainerStyle={styles.body}>
                    <SuggestionList
                      suggestions={suggestions}
                      theme={theme}
                      disabled={props.suggesting}
                      onPick={props.onSuggest}
                      onRemove={props.onRemoveSuggestion}
                    />
                  </ScrollView>
                </View>
              );
            }
            if (id === WATCHES_CARD) {
              return (
                <View key={id} style={styles.column}>
                  {renderWatchesHeader()}
                  <ScrollView contentContainerStyle={styles.body}>
                    <WatchList watches={watches} theme={theme} onChanged={props.onChanged} onOpenFile={props.onOpenFile} />
                  </ScrollView>
                </View>
              );
            }
            const entries = groups.get(id) ?? [];
            const folded = collapsed.includes(id);
            return (
              <View key={id} style={[styles.column, folded ? styles.columnFolded : null]}>
                {renderHeader(id, folded, entries.length)}
                {folded ? (
                  <Text style={styles.foldedTitle} numberOfLines={1}>
                    {COLUMNS[id].title}
                  </Text>
                ) : (
                  <ScrollView contentContainerStyle={styles.body}>{renderCards(id, entries)}</ScrollView>
                )}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
