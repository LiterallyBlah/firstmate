import type { PluginClientContext, PluginScreenProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { FleetSurface } from "./fleet";
import { FLEET_SCREEN_ID } from "./screen";
import { FLEET_PANELS, type FleetShell, type FleetView } from "./shell";

/** Capabilities stay bound to this installation/host, including when several hosts are open. */
export function registerFleetViews(client: PluginClientContext): void {
  const shell: FleetShell = {
    openView(view, workspaceId) {
      client.openPanel(FLEET_PANELS[view].id, {
        workspaceId,
        location: "workspace",
      });
    },
    openHome() {
      client.openScreen({
        screenId: FLEET_SCREEN_ID,
        params: { chat: "show" },
      });
    },
  };
  function Home(props: PluginScreenProps) {
    return <FleetSurface {...props} shell={shell} />;
  }
  client.addScreen({
    id: FLEET_SCREEN_ID,
    title: "FirstMate",
    Component: Home,
  });
  for (const view of Object.keys(FLEET_PANELS) as FleetView[]) {
    function Panel(props: PluginWorkspacePanelProps) {
      return <FleetSurface {...props} params={{}} view={view} shell={shell} />;
    }
    client.addWorkspacePanel({
      ...FLEET_PANELS[view],
      context: "workspace",
      locations: ["workspace"],
      Component: Panel,
    });
  }
}
