import type { PluginClientContext, PluginScreenProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { FleetSurface } from "./fleet";
import { FLEET_SCREEN_ID } from "./screen";
import { FLEET_PANELS, type FleetShell, type FleetView } from "./shell";
import { decisionRoute } from "./needs-you-state";
import { workflowTaskRoute } from "./workflow-task-navigation";

/** Capabilities stay bound to this installation/host, including when several hosts are open. */
export function registerFleetViews(client: PluginClientContext): FleetShell {
  let handoff = 0;
  const shell: FleetShell = {
    openScope(scopeId, homeId) {
      client.openScreen({ screenId: FLEET_SCREEN_ID, params: { chat: "show", discussionScope: scopeId, discussionHome: homeId, discussionHandoff: String(++handoff) } });
    },
    openTask(request) {
      const route = workflowTaskRoute(request);
      client.openScreen({ ...route, params: { ...route.params, taskHandoff: String(++handoff) } });
    },
    openDecision(destination, intent) {
      const route = decisionRoute(destination, intent);
      client.openScreen(intent ? { ...route, params: { ...route.params, decisionHandoff: String(++handoff) } } : route);
    },
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
  // A callback parameter keeps each restored panel's view distinct under Hermes.
  (Object.keys(FLEET_PANELS) as FleetView[]).forEach((view) => {
    function Panel(props: PluginWorkspacePanelProps) {
      return <FleetSurface {...props} params={{}} view={view} shell={shell} />;
    }
    client.addWorkspacePanel({
      ...FLEET_PANELS[view],
      context: "workspace",
      locations: ["workspace"],
      Component: Panel,
    });
  });
  return shell;
}
