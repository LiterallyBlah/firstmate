import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { Text, View } from "react-native";
import { FLEET_PANELS, type FleetShell, type FleetView } from "./shell";
import { errorText, IconButton } from "./ui";

/** Shortcuts leave the hub for Paseo's own workspace tab shell. */
export function HubLauncher({
  theme,
  navigation,
  shell,
  workspaceId,
}: {
  theme: PluginScreenProps["theme"];
  navigation: PluginScreenProps["navigation"];
  shell: FleetShell;
  workspaceId: string | null;
}) {
  const toast = useToast();
  function open(action: () => void): void {
    try {
      action();
    } catch (caught) {
      toast.error(errorText(caught));
    }
  }
  return (
    <View
      style={{
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
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
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
        {workspaceId === null
          ? "Launch a first mate in its home to open the workspace tabs."
          : "Views open as workspace tabs. Select or add Terminal and Browser from the workspace; Browser needs the desktop app."}
      </Text>
    </View>
  );
}
