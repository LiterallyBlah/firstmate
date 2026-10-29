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
import { pendingAttachments } from "./attachments";
import type { FleetShell } from "./shell";

const state = vi.hoisted(() => ({ values: {} as DisplaySettings, fleet: null as Fleet | null, error: null as Error | null,
  fetching: false, refetch: vi.fn(), save: vi.fn(async () => true) }));
vi.mock("react-native", () => ({ Platform: { OS: "web" }, View: "View", Text: "Text", ScrollView: "ScrollView" }));
vi.mock("@getpaseo/plugin/client", () => ({
  useSettings: () => ({ status: "ready", values: state.values, revision: 1, save: state.save }),
  useRpc: () => async () => { throw new Error("Unexpected daemon action"); },
}));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: () => null, Modal: Object.assign(() => null, { Content: () => null }), useToast: () => ({ error() {} }) }));
vi.mock("./fleet-query", () => ({ FLEET_QUERY_KEY: ["fleet"], useFleet: () => ({ data: state.fleet, error: state.error, isFetching: state.fetching, refetch: state.refetch }) }));
vi.mock("./fleet-load-recovery", () => ({ FleetLoadRecovery: () => createElement("FleetLoadRecovery") }));
vi.mock("./needs-you-query", () => ({ useNeedsYou: () => ({ data: state.fleet?.needsYou, error: null, isLoading: false }) }));
vi.mock("./decision-drawer", () => ({ DecisionDrawer: (props: unknown) => createElement("DecisionDrawer", props as object) }));
vi.mock("./chat", () => ({ MateChat: (props: unknown) => createElement("MateChat", props as object) }));
vi.mock("./ui", () => ({
  errorText: (error: Error) => error.message,
  IconButton: (props: { label: string; onPress(): void }) => createElement("Pressable", { accessibilityLabel: props.label, onPress: props.onPress }),
  Segmented: (props: { options: { value: string; label: string }[]; onChange(value: string): void }) => props.options.map(option =>
    createElement("Pressable", { key: option.value, accessibilityLabel: option.label, onPress: () => props.onChange(option.value) })),
  Banner: (props: object) => createElement("Banner", props),
}));
vi.mock("./web", () => ({ webAttributes: () => ({}), focusWebElement() {} }));
vi.mock("./needs-you", () => ({ NeedsYouIndicator: () => null, useDecisionVisibility: () => ({ current: null }) }));
vi.mock("./workflow-plans", () => ({ WorkflowSurface: ({ children }: { children: ReactNode }) => children, useWorkflowPlans: () => ({ snapshot: { plans: [] } }), PlansControl: () => null }));
vi.mock("./workflow-plan-browser", () => ({ WorkflowPlansView: () => null }));
vi.mock("./work-details", () => ({ WorkDetails: () => null }));
vi.mock("./mate-send", () => ({ useMateSender: () => ({ send: vi.fn(), sending: false }) }));
vi.mock("./remotes", () => ({ useRemotes: () => ({ data: { hosts: [] } }) }));
vi.mock("./task-layout", () => ({ useTaskLayout: () => ({ values: DEFAULT_TASK_LAYOUT, save() {}, disabled: false }) }));
vi.mock("./header-actions", () => ({ HeaderActions: () => null }));
vi.mock("./hub-launcher", () => ({ HubLauncher: () => null }));
vi.mock("./task-toolbar", () => ({ TaskToolbar: () => null }));
vi.mock("./task-list", () => ({ TaskList: (props: object) => createElement("TaskList", props) }));
vi.mock("./task-board", () => ({ TaskBoard: (props: object) => createElement("TaskBoard", props) }));
vi.mock("./board", () => ({ Board: () => null }));
vi.mock("./card", () => ({ CrewCard: () => null, converseButtonId: (id: string) => `converse-${id}` }));
vi.mock("./converse", () => ({ ConverseDrawer: (props: object) => createElement("ConverseDrawer", props) }));
vi.mock("./files", () => ({ FilesView: () => null }));
vi.mock("./launch", () => ({ LaunchPanel: () => null }));
vi.mock("./resize-handle", () => ({ ResizeHandle: () => null }));
vi.mock("./deck-setting-view", () => ({ SelectedDeckView: () => null }));
vi.mock("./deck-scene-switcher", () => ({ useDeckSceneSwitcher: () => ({ picker: null, cancel: () => {} }) }));

import { FleetSurface } from "./fleet";

let renderer: ReactTestRenderer;
let client: QueryClient;
const destination = { homeId: "sample-home", requestId: "local:release", recordRevision: 1 };
const params = { decision: destination.requestId, decisionHome: destination.homeId, decisionRevision: "1" };
const shell: FleetShell = { openView: vi.fn(), openHome: vi.fn(), openDecision: vi.fn() };
async function mount(width: number, options: { folded?: boolean; boardFolded?: boolean; route?: Record<string, string>; hostId?: string } = {}) {
  state.values = displaySettings.schema.parse({ chatCollapsed: options.folded ?? false, boardCollapsed: options.boardFolded ?? false });
  state.fleet = {
    home: "/sample", homeReady: true, mate: attentionCard("mate", "idle").agent!, mateMissing: false, mateInHome: true,
    cards: [], projects: [], suggestions: [], watches: [], agentTools: true, charterOutdated: false, warnings: [],
    needsYou: attentionSnapshot([attentionRequest("release")]),
  };
  client = new QueryClient();
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client }, createElement(FleetSurface, {
    theme: attentionTheme, host: { id: options.hostId ?? "fixture", label: "fixture" }, layout: { compact: false, platform: "web" },
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
  await act(async () => { renderer?.root.findAllByType("ConverseDrawer" as never)[0]?.props.onClose(); });
  await act(async () => renderer?.unmount()); client?.clear(); drafts.set("agent-mate", ""); vi.clearAllMocks();
  drafts.set("converse:agent-p2-worker", "");
  pendingAttachments.set("converse:agent-p2-worker", []);
  pendingAttachments.set("agent-mate", []);
  state.error = null; state.fetching = false;
});

it("offers Retry on a failed first load, keeps independent chat recovery and disables Retry in flight", async () => {
  await mount(1440, { route: {} });
  state.fleet = null; state.error = new Error("Fleet unavailable");
  await resize(900);
  const retry = () => renderer.root.findByType("Banner" as never).props.action;
  expect(retry().label).toBe("Retry");
  expect(renderer.root.findAllByType("FleetLoadRecovery" as never)).toHaveLength(1);
  await act(async () => retry().onPress());
  expect(state.refetch).toHaveBeenCalledExactlyOnceWith({ cancelRefetch: false });
  state.fetching = true;
  await resize(1440);
  expect(retry().disabled).toBe(true);
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
  await mount(390, { route: { chat: "show" } });
  expect(renderer.root.findAllByType("MateChat" as never)).toHaveLength(1);
  await act(async () => renderer.unmount());
  client.clear();
  await mount(390, { route: { decision: "all", decisionHome: "sample-home", decisionBoard: "show" } });
  expect(renderer.root.findAllByType("TaskBoard" as never)).toHaveLength(1);
  expect(renderer.root.findAllByType("DecisionDrawer" as never)).toHaveLength(0);
});

async function openAll() {
  const prior = renderer.root.findByType(FleetSurface).props as ComponentProps<typeof FleetSurface>;
  await act(async () => renderer.update(createElement(QueryClientProvider, { client }, createElement(FleetSurface, {
    ...prior, params: { decision: "all", decisionHome: "sample-home" },
  }))));
}
function task(view: "List" | "Board") { return renderer.root.findByType(`Task${view}` as never); }
function converse() { return renderer.root.findByType("ConverseDrawer" as never); }
function visibleBoard() {
  expect(renderer.root.findAllByType("DecisionDrawer" as never)).toHaveLength(0);
  expect(renderer.root.findAllByType("ConverseDrawer" as never)).toHaveLength(0);
  const board = task("Board");
  expect(board.props.conversing).toBeNull();
  for (let node = board.parent; node; node = node.parent) {
    const styles = Array.isArray(node.props.style) ? node.props.style : [node.props.style];
    expect(styles.some(style => style?.display === "none")).toBe(false);
  }
}

it.each([
  { start: "List" as const, conversation: true },
  { start: "Board" as const, conversation: true },
  { start: "List" as const, conversation: false },
])("Open Board reveals tasks from $start, existing conversation=$conversation", async ({ start, conversation }) => {
  await mount(390, { route: {} });
  await press(start);
  const worker = attentionCard("p2-worker", "working");
  state.fleet!.cards = [worker];
  state.fleet!.needsYou!.quarantined = [{ line: 5, taskId: "damaged-task", key: null, hasHold: true, problem: "Task scope could not be read." }];
  if (conversation) {
    await act(async () => task(start).props.onConverse(worker.agent!.id));
    expect(converse().props.watchKey).toBe(worker.agent!.id);
  }
  await openAll();
  await act(async () => drawer().onOpenBoard!());
  visibleBoard();
});

it("retains ordinary List/Board conversations and preserves stored drafts, attachments and Done choice through recovery", async () => {
  await mount(390, { route: {}, hostId: "p2-preservation" });
  await press("List");
  const worker = attentionCard("p2-worker", "working"), workerId = worker.agent!.id;
  const draftKey = `converse:${workerId}`;
  const files = [{ id: "f", kind: "file" as const, fileName: "notes.txt", mimeType: "text/plain", size: 5, data: "aGVsbG8=" }];
  drafts.set(draftKey, "Unsent worker question\n");
  drafts.set("agent-mate", "Unsent first-mate question");
  pendingAttachments.set(draftKey, files);
  pendingAttachments.set("agent-mate", files);
  state.fleet!.cards = [worker];
  await act(async () => task("List").props.onShowDone(true));
  await act(async () => task("List").props.onConverse(workerId));
  await press("Board");
  expect(converse().props.watchKey).toBe(workerId);
  await press("List");
  expect(converse().props.watchKey).toBe(workerId);
  expect(task("List").props.showDone).toBe(true);

  await openAll();
  await act(async () => drawer().onOpenBoard!());
  visibleBoard();
  const preserved = () => {
    expect(drafts.get(draftKey)).toBe("Unsent worker question\n");
    expect(drafts.get("agent-mate")).toBe("Unsent first-mate question");
    expect(pendingAttachments.get(draftKey)).toBe(files);
    expect(pendingAttachments.get("agent-mate")).toBe(files);
  };
  preserved();
  await act(async () => renderer.unmount());
  client.clear();
  await mount(390, { route: {}, hostId: "p2-preservation" });
  await press("List");
  expect(renderer.root.findAllByType("ConverseDrawer" as never)).toHaveLength(0);
  expect(task("List").props.conversing).toBeNull();
  expect(task("List").props.showDone).toBe(true);
  state.fleet!.cards = [worker];
  await act(async () => task("List").props.onConverse(workerId));
  expect(converse().props.watchKey).toBe(workerId);
  preserved();
});
