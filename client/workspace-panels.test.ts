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

it("registers five fixed workspace destinations and a single Home screen", () => {
  const host = installation();
  expect(host.addScreen).toHaveBeenCalledTimes(1);
  expect(
    host.addWorkspacePanel.mock.calls.map(([panel]) => [panel.id, panel.title, panel.icon, panel.context, panel.locations]),
  ).toEqual([
    ["firstmate-deck", "Deck", "Ship", "workspace", ["workspace"]],
    ["firstmate-board", "Board", "Columns3", "workspace", ["workspace"]],
    ["firstmate-crew", "List", "Users", "workspace", ["workspace"]],
    ["firstmate-chat", "Chat", "MessageSquare", "workspace", ["workspace"]],
    ["firstmate-plans", "Plans", "ListTodo", "workspace", ["workspace"]],
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
  home(a).openView("plans", "home-a");
  home(a).openView("plans", "home-a");
  expect(a.openPanel.mock.calls.slice(-2)).toEqual(
    Array(2).fill(["firstmate-plans", { workspaceId: "home-a", location: "workspace" }]),
  );
  expect(b.openPanel).toHaveBeenCalledTimes(1);
  home(a).openHome();
  expect(a.openScreen).toHaveBeenCalledWith({
    screenId: "fleet",
    params: { chat: "show" },
  });
  expect(b.openScreen).not.toHaveBeenCalled();
});

it("hands a discussion or unreadable hold to Home through public params, without opening a native tab", () => {
  const host = installation();
  const component = host.addScreen.mock.calls[0]![0].Component as (props: PluginScreenProps) => ReactElement<Surface>;
  const shell = component({} as PluginScreenProps).props.shell;
  const destination = { homeId: "home-a", requestId: "request-a", recordRevision: 7 };
  shell.openDecision(destination, { discussWith: "mate-a" });
  shell.openDecision(destination, { discussWith: "mate-a" });
  expect(host.openScreen.mock.calls.map(([route]) => route)).toEqual([1, 2].map(n => ({ screenId: "fleet", params: {
    decision: "request-a", decisionHome: "home-a", decisionRevision: "7", discussMate: "mate-a", chat: "show", decisionHandoff: String(n),
  } })));
  shell.openDecision({ requestId: "all", homeId: "home-a" }, { board: true });
  expect(host.openScreen.mock.calls.at(-1)![0].params).toEqual({ decision: "all", decisionHome: "home-a", decisionBoard: "show", decisionHandoff: "3" });
  expect(host.openPanel).not.toHaveBeenCalled();
});

it("hands a plan task to its installation's Home through public screen params", () => {
  const host = installation(), other = installation();
  const component = host.addScreen.mock.calls[0]![0].Component as (props: PluginScreenProps) => ReactElement<Surface>;
  const request = { scope: "host/home/mate", plan: "plan", node: "step", card: "card", worker: "remote:saved-host:worker" };
  component({} as PluginScreenProps).props.shell.openTask!(request);
  expect(host.openScreen).toHaveBeenCalledWith({ screenId: "fleet", params: {
    taskScope: request.scope, taskPlan: "plan", taskNode: "step", taskCard: "card", taskWorker: request.worker, taskHandoff: "1",
  } });
  expect(other.openScreen).not.toHaveBeenCalled(); expect(host.openPanel).not.toHaveBeenCalled();
});
