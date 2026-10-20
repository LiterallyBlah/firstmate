import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { FleetCard, Suggestion } from "../shared/fleet";
import type { RemoteHost } from "../shared/remotes";
import { tagChoices } from "../shared/item-tags";
import type { HostTab } from "./host-tabs";
import { HostHealthCard } from "./remotes";
import { ItemTagFilter } from "./item-tags";
import { SuggestionList } from "./suggestions";
import { ControlTooltip, IconButton } from "./ui";

type Panel = "machines" | "suggestions" | "tags" | "board";

/** One compact row above either task view; the host owns the full control dialogs. */
export function TaskToolbar({
  theme,
  tabs,
  hosts,
  hostTab,
  onHostChange,
  suggestions,
  sending,
  onPick,
  onRemove,
  tagCards,
  selectedTags,
  onTagsChange,
  boardMode,
  planControl,
}: {
  theme: PluginTheme;
  tabs: readonly HostTab[];
  hosts: readonly RemoteHost[];
  hostTab: string;
  onHostChange: (id: string) => void;
  suggestions: readonly Suggestion[];
  sending: boolean;
  onPick: (prompt: string) => boolean;
  onRemove: (suggestion: Suggestion) => Promise<void>;
  tagCards: readonly FleetCard[];
  selectedTags: readonly string[];
  onTagsChange: (tags: string[]) => void;
  boardMode?: { detailed: boolean; disabled: boolean; onChange(): void } | undefined;
  planControl?: ReactNode;
}) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const selectedHost = tabs.find((tab) => tab.id === hostTab);
  const machine = selectedHost?.id === "all" ? "All machines" : (selectedHost?.label ?? "All machines");
  const unreachable = selectedHost?.online === false;
  const colors = theme.colors;
  return (
    <>
      <View
        testID="firstmate-task-toolbar"
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 6,
          flexShrink: 0,
          borderBottomWidth: 1,
          borderColor: colors.border,
        }}
      >
        {tabs.length === 0 ? null : (
          <ToolbarButton
            theme={theme}
            icon={unreachable ? "WifiOff" : "Monitor"}
            text={machine}
            label={`Machines: ${machine}${unreachable ? ", unreachable" : ""}`}
            hint={`${machine}. Choose a machine and inspect connection health.`}
            warning={unreachable}
            active={hostTab !== "all"}
            open={panel === "machines"}
            onPress={() => setPanel("machines")}
          />
        )}
        <ToolbarButton
          theme={theme}
          icon="Lightbulb"
          text={`Suggestions · ${suggestions.length}`}
          label={`Suggestions (${suggestions.length})`}
          hint="Read, send or remove the first mate's suggestions."
          open={panel === "suggestions"}
          onPress={() => setPanel("suggestions")}
        />
        <ToolbarButton
          theme={theme}
          icon="Tags"
          text={selectedTags.length === 0 ? "Tags" : `Tags · ${selectedTags.length}`}
          label={`Filter tags (${selectedTags.length} selected)`}
          hint={
            selectedTags.length === 0
              ? "Filter tasks by tag."
              : `Matching all: ${selectedTags.join(", ")}. Open to change or clear.`
          }
          active={selectedTags.length > 0}
          open={panel === "tags"}
          onPress={() => setPanel("tags")}
        />
        {boardMode ? <View style={{ marginLeft: "auto" }}>
          <IconButton theme={theme} icon="Ellipsis" label="Board options" onPress={() => setPanel("board")} />
        </View> : null}
        {planControl}
      </View>
      <Modal
        title={panel === "machines" ? "Machines" : panel === "suggestions" ? "Suggestions" : panel === "board" ? "Board options" : "Filter tags"}
        open={panel !== null}
        onOpenChange={(open) => {
          if (!open) setPanel(null);
        }}
      >
        <Modal.Content>
          {panel === "machines" ? (
            <>
              <View style={{ gap: 6 }}>
                {tabs.map((tab) => (
                  <Pressable
                    key={tab.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${tab.id === "all" ? "All machines" : tab.label}${tab.online === null ? "" : tab.online ? ", online" : ", unreachable"}, ${tab.working} working, ${tab.attention} need attention`}
                    accessibilityState={{ selected: tab.id === hostTab }}
                    aria-pressed={tab.id === hostTab}
                    onPress={() => {
                      onHostChange(tab.id);
                      setPanel(null);
                    }}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      padding: 10,
                      borderRadius: 8,
                      backgroundColor: tab.id === hostTab ? colors.surface2 : colors.surface1,
                    }}
                  >
                    <Icon name={tab.id === hostTab ? "CircleDot" : "Circle"} size={16} color={colors.foregroundMuted} />
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={{ color: colors.foreground, fontSize: 13 }}>
                        {tab.id === "all" ? "All machines" : tab.label}
                      </Text>
                      <Text
                        style={{
                          color: tab.online === false ? colors.statusWarning : colors.foregroundMuted,
                          fontSize: 12,
                        }}
                      >
                        {tab.online === null ? "" : tab.online ? "Online · " : "Unreachable · "}
                        {tab.working} working · {tab.attention} need attention
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
              <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Connection details</Text>
              {hosts.map((host) => (
                <HostHealthCard key={host.serverId} host={host} theme={theme} />
              ))}
            </>
          ) : panel === "suggestions" ? (
            suggestions.length === 0 ? (
              <Text style={{ color: colors.foregroundMuted }}>No suggestions right now.</Text>
            ) : (
              <SuggestionList
                suggestions={suggestions}
                theme={theme}
                disabled={sending}
                onRemove={onRemove}
                onPick={(prompt) => {
                  if (onPick(prompt)) setPanel(null);
                }}
              />
            )
          ) : panel === "tags" ? (
            <>
              <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
                Tags filter this machine selection in both List and Board.
              </Text>
              <ItemTagFilter cards={tagCards} selected={selectedTags} theme={theme} onChange={onTagsChange} />
              {tagChoices(tagCards, selectedTags).length > 0 ? null : (
                <Text style={{ color: colors.foregroundMuted }}>No tags on the shown tasks.</Text>
              )}
            </>
          ) : panel === "board" && boardMode ? <IconButton theme={theme} icon="Columns3"
            label={boardMode.detailed ? "Summary columns" : "Detailed columns"} showLabel disabled={boardMode.disabled}
            onPress={() => { boardMode.onChange(); setPanel(null); }} /> : null}
        </Modal.Content>
      </Modal>
    </>
  );
}

function ToolbarButton({
  theme,
  icon,
  text,
  label,
  hint,
  open,
  onPress,
  active = false,
  warning = false,
}: {
  theme: PluginTheme;
  icon: string;
  text: string;
  label: string;
  hint: string;
  open: boolean;
  onPress: () => void;
  active?: boolean;
  warning?: boolean;
}) {
  const colors = theme.colors;
  const color = warning ? colors.statusWarning : active ? colors.accent : colors.foreground;
  return (
    <ControlTooltip theme={theme} text={hint} side="bottom">
      {(described) => (
        <Pressable
          {...described}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={hint}
          accessibilityState={{ expanded: open }}
          aria-expanded={open}
          onPress={onPress}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            maxWidth: 180,
            paddingHorizontal: 8,
            paddingVertical: 6,
            borderWidth: 1,
            borderRadius: 8,
            borderColor: active || warning ? color : colors.border,
            backgroundColor: colors.surface1,
          }}
        >
          <Icon name={icon} size={13} color={color} />
          <Text numberOfLines={1} style={{ color, fontSize: 12, flexShrink: 1 }}>
            {text}
          </Text>
        </Pressable>
      )}
    </ControlTooltip>
  );
}
