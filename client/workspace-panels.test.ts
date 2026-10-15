import type { ReactElement } from "react";
import type { PluginClientContext, PluginScreenProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { expect, it, vi } from "vitest";
import type { FleetShell, FleetView } from "./shell";

vi.mock("./fleet", () => ({ FleetSurface: () => null }));
import { registerFleetViews } from "./workspace-panels";

type Surface = {
  shell: FleetShell;
  view?: FleetView;
  workspaceId?: string;
  host: { id: string };
};
function installation() {
  const addScreen = vi.fn();
  const addWorkspacePanel = vi.fn();
  const openPanel = vi.fn();
  const openScreen = vi.fn();
  registerFleetViews({
    addScreen,
    addWorkspacePanel,
    openPanel,
    openScreen,
  } as unknown as PluginClientContext);
  return { addScreen, addWorkspacePanel, openPanel, openScreen };
}

it("registers exactly three fixed workspace destinations and a single Home screen", () => {
  const host = installation();
  expect(host.addScreen).toHaveBeenCalledTimes(1);
  expect(
    host.addWorkspacePanel.mock.calls.map(([panel]) => [panel.id, panel.title, panel.context, panel.locations]),
  ).toEqual([
    ["firstmate-deck", "Deck", "workspace", ["workspace"]],
    ["firstmate-board", "Board", "workspace", ["workspace"]],
    ["firstmate-crew", "Crew", "workspace", ["workspace"]],
  ]);
  for (const [panel] of host.addWorkspacePanel.mock.calls) {
    const component = panel.Component as (props: PluginWorkspacePanelProps) => ReactElement<Surface>;
    const result = component({
      host: { id: "host-a" },
      workspaceId: "home",
    } as PluginWorkspacePanelProps);
    expect(result.props.view).toBe(panel.id.replace("firstmate-", ""));
    expect(result.props.workspaceId).toBe("home");
    expect(result.props.host.id).toBe("host-a");
  }
  expect(host.openPanel).not.toHaveBeenCalled(); // Registration/restoration never creates tabs or processes.
});

it("loans each installation its own navigation and asks Paseo to focus the same panel identity", () => {
  const a = installation(),
    b = installation();
  const home = (host: ReturnType<typeof installation>) => {
    const component = host.addScreen.mock.calls[0]![0].Component as (props: PluginScreenProps) => ReactElement<Surface>;
    return component({} as PluginScreenProps).props.shell;
  };
  home(a).openView("deck", "home-a");
  home(a).openView("deck", "home-a");
  expect(a.openPanel.mock.calls).toEqual(
    Array(2).fill(["firstmate-deck", { workspaceId: "home-a", location: "workspace" }]),
  );
  expect(b.openPanel).not.toHaveBeenCalled();
  home(b).openView("crew", "home-b");
  expect(b.openPanel).toHaveBeenCalledWith("firstmate-crew", {
    workspaceId: "home-b",
    location: "workspace",
  });
  home(a).openHome();
  expect(a.openScreen).toHaveBeenCalledWith({
    screenId: "fleet",
    params: { chat: "show" },
  });
  expect(b.openScreen).not.toHaveBeenCalled();
});
