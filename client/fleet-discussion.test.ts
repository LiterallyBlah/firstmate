import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { View } from "react-native";
import { attentionCard, attentionRequest, attentionSnapshot, attentionTheme } from "../test/attention-deck-fixture";
import { displaySettings, type DisplaySettings } from "../shared/settings";
import type { Fleet } from "../shared/fleet";
import { DEFAULT_TASK_LAYOUT } from "../shared/task-layout";
import type { DecisionDrawer } from "./decision-drawer";
import type { MateChat } from "./chat";
import { drafts } from "./draft";
import type { FleetShell } from "./shell";

const state = vi.hoisted(() => ({ values: {} as DisplaySettings, fleet: null as Fleet | null, save: vi.fn(async () => true) }));
vi.mock("react-native", () => ({ Platform: { OS: "web" }, View: "View", Text: "Text", ScrollView: "ScrollView" }));
vi.mock("@getpaseo/plugin/client", () => ({
  useSettings: () => ({ status: "ready", values: state.values, revision: 1, save: state.save }),
  useRpc: () => async () => { throw new Error("Unexpected daemon action"); },
}));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: () => null, Modal: Object.assign(() => null, { Content: () => null }), useToast: () => ({ error() {} }) }));
vi.mock("./fleet-query", () => ({ FLEET_QUERY_KEY: ["fleet"], useFleet: () => ({ data: state.fleet, error: null, isFetching: false }) }));
vi.mock("./needs-you-query", () => ({ useNeedsYou: () => ({ data: state.fleet?.needsYou, error: null, isLoading: false }) }));
vi.mock("./decision-drawer", () => ({ DecisionDrawer: (props: unknown) => createElement("DecisionDrawer", props as object) }));
vi.mock("./chat", () => ({ MateChat: (props: unknown) => createElement("MateChat", props as object) }));
vi.mock("./ui", () => ({
  IconButton: (props: { label: string; onPress(): void }) => createElement("Pressable", { accessibilityLabel: props.label, onPress: props.onPress }),
  Segmented: (props: { options: { value: string; label: string }[]; onChange(value: string): void }) => props.options.map(option =>
    createElement("Pressable", { key: option.value, accessibilityLabel: option.label, onPress: () => props.onChange(option.value) })),
  Banner: () => null,
}));
vi.mock("./web", () => ({ webAttributes: () => ({}), focusWebElement() {} }));
vi.mock("./needs-you", () => ({ NeedsYouIndicator: () => null, useDecisionVisibility: () => ({ current: null }) }));
vi.mock("./workflow-plans", () => ({ WorkflowSurface: ({ children }: { children: ReactNode }) => children, useWorkflowPlans: () => ({ snapshot: { plans: [] } }), PlansControl: () => null }));
vi.mock("./workflow-plan-browser", () => ({ WorkflowPlansView: () => null }));
vi.mock("./mate-send", () => ({ useMateSender: () => ({ send: vi.fn(), sending: false }) }));
vi.mock("./remotes", () => ({ useRemotes: () => ({ data: { hosts: [] } }) }));
vi.mock("./task-layout", () => ({ useTaskLayout: () => ({ values: DEFAULT_TASK_LAYOUT, save() {}, disabled: false }) }));
vi.mock("./header-actions", () => ({ HeaderActions: () => null }));
vi.mock("./hub-launcher", () => ({ HubLauncher: () => null }));
vi.mock("./task-toolbar", () => ({ TaskToolbar: () => null }));
vi.mock("./task-list", () => ({ TaskList: () => createElement("TaskList") }));
vi.mock("./task-board", () => ({ TaskBoard: () => createElement("TaskBoard") }));
vi.mock("./board", () => ({ Board: () => null }));
vi.mock("./card", () => ({ CrewCard: () => null }));
vi.mock("./converse", () => ({ ConverseDrawer: () => null }));
vi.mock("./files", () => ({ FilesView: () => null }));
vi.mock("./launch", () => ({ LaunchPanel: () => null }));
vi.mock("./resize-handle", () => ({ ResizeHandle: () => null }));
vi.mock("./deck-setting-view", () => ({ SelectedDeckView: () => null }));
vi.mock("./deck-scene-switcher", () => ({ DeckSceneSwitcher: () => null }));

import { FleetSurface } from "./fleet";

let renderer: ReactTestRenderer;
let client: QueryClient;
const destination = { homeId: "sample-home", requestId: "local:release", recordRevision: 1 };
const params = { decision: destination.requestId, decisionHome: destination.homeId, decisionRevision: "1" };
const shell: FleetShell = { openView: vi.fn(), openHome: vi.fn(), openDecision: vi.fn() };
async function mount(width: number, options: { folded?: boolean; boardFolded?: boolean; route?: Record<string, string> } = {}) {
  state.values = displaySettings.schema.parse({ chatCollapsed: options.folded ?? false, boardCollapsed: options.boardFolded ?? false });
  state.fleet = {
    home: "/sample", homeReady: true, mate: attentionCard("mate", "idle").agent!, mateMissing: false, mateInHome: true,
    cards: [], projects: [], suggestions: [], watches: [], agentTools: true, charterOutdated: false, warnings: [],
    needsYou: attentionSnapshot([attentionRequest("release")]),
  };
  client = new QueryClient();
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client }, createElement(FleetSurface, {
    theme: attentionTheme, host: { id: "fixture", label: "fixture" }, layout: { compact: false, platform: "web" },
    params: options.route ?? params, shell,
  } as ComponentProps<typeof FleetSurface>))); });
  await resize(width);
}
async function resize(width: number) {
  await act(async () => {
    renderer.root.findAll(node => node.type === View && typeof node.props.onLayout === "function").slice(0, 2)
      .forEach(node => node.props.onLayout({ nativeEvent: { layout: { width } } }));
  });
}
const drawer = () => renderer.root.findByType("DecisionDrawer" as never).props as ComponentProps<typeof DecisionDrawer>;
const chat = () => renderer.root.findByType("MateChat" as never).props as ComponentProps<typeof MateChat>;
async function press(label: string) { await act(async () => renderer.root.findByProps({ accessibilityLabel: label }).props.onPress()); }
afterEach(async () => {
  await act(async () => renderer?.unmount()); client?.clear(); drafts.set("agent-mate", ""); vi.clearAllMocks();
});

it.each([900, 1440])("unfolds Home's existing chat while keeping the selected decision at %s points", async width => {
  await mount(width, { folded: true });
  expect(renderer.root.findAllByType("MateChat" as never)).toHaveLength(0);
  await act(async () => drawer().onOpenChat!(destination));
  expect(chat().discussion).toEqual({ ...destination, mateId: "agent-mate" });
  expect(drawer().destination).toEqual(destination);
  expect(shell.openView).not.toHaveBeenCalled();
});

it("switches a narrowed Home to First mate, returns to its decision, then backs to List", async () => {
  await mount(390);
  await press("List");
  await act(async () => drawer().onOpenChat!(destination));
  expect(chat().discussion?.requestId).toBe(destination.requestId);
  expect(renderer.root.findAllByType("DecisionDrawer" as never)).toHaveLength(0);
  await act(async () => chat().onReturnDecision!());
  expect(drawer().destination).toEqual(destination);
  await act(async () => drawer().onClose());
  expect(renderer.root.findAllByType("MateChat" as never)).toHaveLength(0);
  expect(renderer.root.findAllByType("TaskList" as never)).toHaveLength(1);
});

it("reveals Board locally even when Home's task pane was folded", async () => {
  await mount(1440, { boardFolded: true });
  await act(async () => drawer().onOpenBoard!());
  expect(renderer.root.findAllByType("DecisionDrawer" as never)).toHaveLength(0);
  expect(renderer.root.findAllByType("TaskBoard" as never)).toHaveLength(1);
  expect(shell.openView).not.toHaveBeenCalled();
});

it("consumes an incoming Home Board handoff without covering it with the old drawer", async () => {
  await mount(390, { route: { decision: "all", decisionHome: "sample-home", decisionBoard: "show" } });
  expect(renderer.root.findAllByType("TaskBoard" as never)).toHaveLength(1);
  expect(renderer.root.findAllByType("DecisionDrawer" as never)).toHaveLength(0);
});
