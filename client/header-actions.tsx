import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { useId, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import type { Fleet } from "../shared/fleet";
import type { DisplaySettings } from "../shared/settings";
import { watchAttention } from "./format";
import { MigrationControl } from "./migration-control";
import type { MateSender } from "./mate-send";
import { IconButton } from "./ui";
import { UpdateButton } from "./update-button";
import { WatchList } from "./watches";
import { focusWebElement } from "./web";

/** Secondary Home controls. The host owns dismissal, focus and the phone sheet. */
export function HeaderActions({
  theme,
  navigation,
  compact,
  data,
  values,
  paneName,
  sender,
  refreshing,
  onSave,
  onRefresh,
  onOpenFile,
  onOpenSettings,
  onUpdateSent,
  summary,
}: {
  theme: PluginScreenProps["theme"];
  navigation: PluginScreenProps["navigation"];
  compact: boolean;
  data: Fleet | null;
  values: DisplaySettings;
  paneName: string;
  sender: MateSender;
  refreshing: boolean;
  onSave: (patch: Partial<DisplaySettings>) => void;
  onRefresh: () => void;
  onOpenFile: (path: string) => void;
  onOpenSettings: (() => void) | null;
  onUpdateSent: () => void;
  summary?: ReactNode;
}) {
  const [more, setMore] = useState(false);
  const [watches, setWatches] = useState(false);
  const triggerId = useId();
  const mate = data?.mate ?? null;
  const attention = watchAttention(data?.watches ?? []);
  function choose(action: () => void): void {
    setMore(false);
    action();
  }
  return (
    <>
      <MigrationControl
        theme={theme}
        compact={compact}
        mate={mate}
        onChanged={onRefresh}
        onOpenFile={onOpenFile}
        onOpenAgent={navigation === undefined ? null : (agentId) => navigation.openAgent({ agentId })}
        onOpenChange={(open) => {
          if (open) setMore(false);
          else focusWebElement(triggerId);
        }}
        renderTrigger={(migration, recovering) => (
          <>
            <IconButton
              theme={theme}
              icon="Ellipsis"
              label="More"
              compact={compact}
              nativeID={triggerId}
              showLabel
              tone={recovering || attention.failing ? "danger" : "default"}
              tooltip={
                recovering
                  ? "FirstMate controls — a provider transfer needs recovery."
                  : attention.count > 0
                    ? `FirstMate controls — ${attention.count} watches failing or off.`
                    : "Provider, watches, layout and FirstMate settings."
              }
              tooltipSide="bottom"
              tooltipAlign="end"
              onPress={() => setMore(true)}
            />
            <Modal title="FirstMate controls" open={more} onOpenChange={setMore}>
              <Modal.Content>
                {summary}
                <View style={{ gap: 8 }}>
                  {migration}
                  {data === null ? null : (
                    <IconButton
                      theme={theme}
                      icon="Radar"
                      showLabel
                      label={`Watches${attention.count === 0 ? "" : `: ${attention.count} failing or off`}`}
                      tone={attention.failing ? "danger" : "default"}
                      onPress={() => choose(() => setWatches(true))}
                    />
                  )}
                  {mate === null || navigation === undefined ? null : (
                    <IconButton
                      theme={theme}
                      icon="ExternalLink"
                      label="Open the first mate in Paseo"
                      showLabel
                      onPress={() => choose(() => navigation.openAgent({ agentId: mate.id }))}
                    />
                  )}
                </View>
                {compact || mate === null ? null : (
                  <View style={{ gap: 8 }}>
                    <IconButton
                      theme={theme}
                      icon={values.chatCollapsed ? "PanelLeftOpen" : "PanelLeftClose"}
                      label={values.chatCollapsed ? "Show the chat" : "Hide the chat"}
                      showLabel
                      onPress={() =>
                        choose(() => onSave({ chatCollapsed: !values.chatCollapsed, boardCollapsed: false }))
                      }
                    />
                    <IconButton
                      theme={theme}
                      icon={values.boardCollapsed ? "PanelRightOpen" : "PanelRightClose"}
                      label={values.boardCollapsed ? "Show the right pane" : "Hide the right pane"}
                      showLabel
                      tooltip={`${values.boardCollapsed ? "Show" : "Hide"} the ${paneName} pane.`}
                      onPress={() =>
                        choose(() => onSave({ boardCollapsed: !values.boardCollapsed, chatCollapsed: false }))
                      }
                    />
                  </View>
                )}
                <View style={{ gap: 8 }}>
                  <UpdateButton
                    theme={theme}
                    mateId={mate?.id ?? null}
                    sender={sender}
                    showLabel
                    onSent={() => choose(onUpdateSent)}
                  />
                  <IconButton
                    theme={theme}
                    icon="RefreshCw"
                    label="Refresh"
                    showLabel
                    disabled={refreshing}
                    onPress={() => choose(onRefresh)}
                  />
                  {onOpenSettings === null ? null : (
                    <IconButton
                      theme={theme}
                      icon="Settings"
                      label="FirstMate settings"
                      showLabel
                      onPress={() => choose(onOpenSettings)}
                    />
                  )}
                </View>
                {data === null ? null : (
                  <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                    Home: {data.home}
                  </Text>
                )}
              </Modal.Content>
            </Modal>
          </>
        )}
      />
      <Modal
        title="Watches"
        open={watches}
        onOpenChange={(open) => {
          setWatches(open);
          if (!open) focusWebElement(triggerId);
        }}
      >
        <Modal.Content>
          <WatchList
            watches={data?.watches ?? []}
            theme={theme}
            onChanged={onRefresh}
            onOpenFile={(path) => {
              setWatches(false);
              onOpenFile(path);
            }}
          />
        </Modal.Content>
      </Modal>
    </>
  );
}
