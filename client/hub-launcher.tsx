import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { useId, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { FLEET_PANELS, type FleetShell, type FleetView } from "./shell";
import { errorText, IconButton } from "./ui";
import { NativeToolButtons } from "./native-tools";
import { focusWebElement } from "./web";

/** Shortcuts leave the hub for Paseo's own workspace tab shell. */
export function HubLauncher({
  theme,
  navigation,
  shell,
  workspaceId,
  compact = false,
}: {
  theme: PluginScreenProps["theme"];
  navigation: PluginScreenProps["navigation"];
  shell: FleetShell;
  workspaceId: string | null;
  compact?: boolean;
}) {
  const toast = useToast();
  const [opened, setOpened] = useState(false);
  const triggerId = useId();
  function open(action: () => void): void {
    try {
      action();
      setOpened(false);
    } catch (caught) {
      toast.error(errorText(caught));
    }
  }
  const shortcuts = (tools: ReactNode) => (
    <View
      style={{
        gap: 6,
        paddingTop: 2,
      }}
    >
      <View style={{ flexDirection: compact ? "column" : "row", flexWrap: "wrap", gap: 8 }}>
        {(Object.keys(FLEET_PANELS) as FleetView[]).map((view) => (
          <IconButton
            key={view}
            theme={theme}
            icon={FLEET_PANELS[view].icon}
            label={`Open ${FLEET_PANELS[view].title}`}
            showLabel
            disabled={workspaceId === null}
            tooltip={`Open ${FLEET_PANELS[view].title} in the FirstMate workspace.`}
            onPress={() => {
              if (workspaceId !== null) open(() => shell.openView(view, workspaceId));
            }}
          />
        ))}
        {tools}
        {navigation === undefined ? null : (
          <IconButton
            theme={theme}
            icon="PanelsTopLeft"
            label="Terminal & browser"
            showLabel
            disabled={workspaceId === null}
            tooltip="Open the FirstMate workspace. Select or add a native Terminal or Browser tab there."
            onPress={() => {
              if (workspaceId !== null) open(() => navigation.openWorkspace({ workspaceId }));
            }}
          />
        )}
      </View>
      {workspaceId === null ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          Launch a first mate in its home to open the workspace tabs.
        </Text>
      ) : null}
    </View>
  );
  return (
    <NativeToolButtons
      key={workspaceId ?? "unavailable"}
      theme={theme}
      navigation={navigation}
      workspaceId={workspaceId}
      onNavigate={() => setOpened(false)}
      onBrowserOpenChange={(open) => {
        if (!compact) return;
        if (open) setOpened(false);
        else focusWebElement(triggerId);
      }}
      renderButtons={(tools) =>
        compact ? (
          <>
            <IconButton
              theme={theme}
              icon="PanelsTopLeft"
              label="Open"
              showLabel
              nativeID={triggerId}
              tooltip="Open Deck, Board, Crew, Chat or workspace tools."
              tooltipSide="bottom"
              tooltipAlign="end"
              onPress={() => setOpened(true)}
            />
            <Modal title="FirstMate workspace" open={opened} onOpenChange={setOpened}>
              <Modal.Content>{shortcuts(tools)}</Modal.Content>
            </Modal>
          </>
        ) : (
          shortcuts(tools)
        )
      }
    />
  );
}
