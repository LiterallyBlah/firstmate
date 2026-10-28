import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { View } from "react-native";
import { attentionCard, attentionSnapshot, attentionTheme } from "../test/attention-deck-fixture";
import { workflowTaskFixture } from "../test/workflow-task-fixture";
import { displaySettings, type DisplaySettings } from "../shared/settings";
import type { Fleet } from "../shared/fleet";
import type { WorkflowSnapshot } from "../shared/workflow-rpc";
import { DEFAULT_TASK_LAYOUT } from "../shared/task-layout";
import { workflowTaskRoute } from "./workflow-task-navigation";
import { planSessionKey } from "./workflow-plan-state";
import type { FleetShell, FleetView } from "./shell";
import { drafts } from "./draft";
import { pendingAttachments } from "./attachments";

const state = vi.hoisted(() => ({ values: {} as DisplaySettings, fleet: null as Fleet | null, snapshot: {} as WorkflowSnapshot, save: vi.fn(async () => true), rpc: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "web" }, View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView" }));
vi.mock("@getpaseo/plugin/client", () => ({
  useSettings: () => ({ status: "ready", values: state.values, revision: 1, save: state.save }),
  useRpc: (contract: { name: string }) => async () => {
    state.rpc(contract.name);
    if (contract.name === "firstmate.workflow.read") return state.snapshot;
    if (contract.name === "firstmate.mate.targets") return { targets: [] };
    if (contract.name === "firstmate.remotes.read") return { hosts: [] };
    if (contract.name === "firstmate.scope.read") return { uiEnabled: false, executionEnabled: false, scopes: [], projects: [], homeId: "sample-home", sequence: 0, freshness: "uninitialized", asOf: "2026-10-26T12:00:00Z", problems: [] };
    throw new Error(`Unexpected daemon action: ${contract.name}`);
  },
}));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: () => null, TextInput: "TextInput",
  Modal: Object.assign(({ open, children }: { open: boolean; children: ReactNode }) => open ? children : null, { Content: ({ children }: { children: ReactNode }) => children }),
  useToast: () => ({ error() {} }),
}));
vi.mock("./fleet-query", () => ({ FLEET_QUERY_KEY: ["fleet"], useFleet: () => ({ data: state.fleet, error: null, isFetching: false }) }));
vi.mock("./needs-you-query", () => ({ NEEDS_YOU_QUERY_KEY: ["needs"], useNeedsYou: () => ({ data: state.fleet?.needsYou, error: null, isLoading: false }) }));
vi.mock("./decision-drawer", () => ({ DecisionDrawer: (props: ComponentProps<typeof import("./decision-drawer").DecisionDrawer>) =>
  createElement("DecisionDrawer", props, createElement(PlanNeeds, { theme: props.theme, snapshot: props.snapshot })) }));
vi.mock("./chat", () => ({ MateChat: (props: object) => createElement("MateChat", props) }));
vi.mock("./ui", () => ({
  IconButton: (props: { label: string; onPress(): void; disabled?: boolean }) => createElement("Pressable", { accessibilityLabel: props.label, onPress: props.onPress, disabled: props.disabled }),
  Segmented: (props: { options: { value: string; label: string }[]; onChange(value: string): void }) => props.options.map(option =>
    createElement("Pressable", { key: option.value, accessibilityLabel: option.label, onPress: () => props.onChange(option.value) })),
  Banner: () => null,
}));
vi.mock("./option-picker", () => ({ OptionPicker: () => null }));
vi.mock("./web", () => ({ webAttributes: () => ({}), focusWebElement() {} }));
vi.mock("./needs-you", () => ({ NeedsYouIndicator: () => null, useDecisionVisibility: () => ({ current: null }) }));
vi.mock("./mate-send", () => ({ useMateSender: () => ({ send: vi.fn(), sending: false }) }));
vi.mock("./remotes", () => ({ useRemotes: () => ({ data: { hosts: [{ serverId: "lab-server-id", label: "Saved lab", online: true }] } }) }));
vi.mock("./task-layout", () => ({ useTaskLayout: () => ({ values: DEFAULT_TASK_LAYOUT, save() {}, disabled: false }) }));
vi.mock("./header-actions", () => ({ HeaderActions: () => null }));
vi.mock("./hub-launcher", () => ({ HubLauncher: () => null }));
vi.mock("./task-toolbar", () => ({ ToolbarButton: (props: { label: string; onPress(): void }) => createElement("Pressable", { accessibilityLabel: props.label, onPress: props.onPress }), TaskToolbar: ({ planControl }: { planControl: ReactNode }) => planControl }));
vi.mock("./task-list", () => ({ TaskList: (props: object) => createElement("TaskList", props) }));
vi.mock("./task-board", () => ({ TaskBoard: (props: object) => createElement("TaskBoard", props) }));
vi.mock("./board", () => ({ Board: () => null }));
vi.mock("./card", () => ({ CrewCard: () => null, converseButtonId: (id: string) => `converse-${id}` }));
vi.mock("./converse", () => ({ ConverseDrawer: (props: object) => createElement("ConverseDrawer", props) }));
vi.mock("./files", () => ({ FilesView: () => null }));
vi.mock("./launch", () => ({ LaunchPanel: () => null }));
vi.mock("./resize-handle", () => ({ ResizeHandle: () => null }));
vi.mock("./deck-setting-view", () => ({ SelectedDeckView: () => null }));
vi.mock("./deck-scene-switcher", () => ({ useDeckSceneSwitcher: () => null }));
import { FleetSurface } from "./fleet";
import { PlanChip, PlanNeeds, useWorkflowPlans, WorkflowSurface } from "./workflow-plans";

let renderer: ReactTestRenderer, client: QueryClient;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
const shell: FleetShell = { openView: vi.fn(), openHome: vi.fn(), openDecision: vi.fn(), openTask: vi.fn() };
function fixture() {
  const fixture = workflowTaskFixture(true);
  state.values = displaySettings.schema.parse({ chatCollapsed: true });
  state.snapshot = { homeId: "sample-home", version: "1", plans: [fixture.plan], subjects: { [fixture.plan.definition.id]: "a".repeat(64) }, now: [], comingUp: [] };
  state.fleet = { home: "/sample", homeReady: true, mate: attentionCard("mate", "idle").agent!, mateMissing: false, mateInHome: true,
    cards: [fixture.card, attentionCard("unrelated", "working")], projects: [], suggestions: [], watches: [], agentTools: true, charterOutdated: false, warnings: [], needsYou: attentionSnapshot([]) };
  return fixture;
}
async function mount(width: number, options: { host?: string; view?: FleetView; params?: Record<string, string> } = {}) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client }, createElement(FleetSurface, {
    theme: attentionTheme, host: { id: options.host ?? "plans-host", label: "fixture" }, layout: { compact: false, platform: "web" },
    params: options.params ?? {}, shell, ...(options.view ? { view: options.view, workspaceId: "sample" } : {}),
  } as ComponentProps<typeof FleetSurface>))); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  await act(async () => {
    renderer.root.findAll(node => node.type === View && typeof node.props.onLayout === "function").slice(0, 2)
      .forEach(node => node.props.onLayout({ nativeEvent: { layout: { width } } }));
  });
}
async function unmount() { await act(async () => renderer?.unmount()); client?.clear(); }
const draftKeys = ["agent-mate", "converse:remote:lab-server-id:agent-task-worker"];
afterEach(async () => {
  await unmount(); vi.clearAllMocks();
  for (const key of draftKeys) { drafts.set(key, ""); pendingAttachments.set(key, []); }
});
const list = () => renderer.root.findByType("TaskList" as never).props;
const button = (label: string) => renderer.root.find(node => node.type === ("Pressable" as never) && node.props.accessibilityLabel === label);
async function press(label: string) { await act(async () => button(label).props.onPress()); }
const workerRequest = (host: string, worker = true) => ({ scope: planSessionKey(host, "/sample", "agent-mate", "sample-home")!, plan: state.snapshot.plans[0]!.definition.id,
  node: state.snapshot.plans[0]!.definition.nodes[0]!.id, card: state.fleet!.cards[0]!.key, ...(worker ? { worker: "remote:lab-server-id:agent-task-worker" } : {}) });

it.each([390, 1440])("reveals the task in Home List, carries the saved remote conversation and retains the plan filter across tabs at %s points", async width => {
  const { card } = fixture(), host = `round-trip-${width}`;
  await mount(width, { host, params: workflowTaskRoute(workerRequest(host)).params });
  expect(list().cards).toEqual([card]); expect(list().filtered).toBe(true); expect(list().reveal.card).toBe(card.key);
  expect(renderer.root.findByType("ConverseDrawer" as never).props.watchKey).toBe("remote:lab-server-id:agent-task-worker");
  await unmount();
  await mount(width, { host, view: "crew" });
  expect(list().cards).toEqual([card]); expect(list().filtered).toBe(true);
  await unmount(); await mount(width, { host, view: "board" });
  expect(renderer.root.findByType("TaskBoard" as never).props.cards).toEqual([card]);
  expect(renderer.root.findByType("TaskBoard" as never).props.filtered).toBe(true);
  await unmount(); await mount(width, { host }); await press("List");
  expect(list().cards).toEqual([card]);
  const prior = renderer.root.findByType(FleetSurface).props as ComponentProps<typeof FleetSurface>;
  await act(async () => renderer.update(createElement(QueryClientProvider, { client }, createElement(FleetSurface, {
    ...prior, params: { decision: "all", decisionHome: "sample-home" },
  }))));
  expect(renderer.root.findByType("DecisionDrawer" as never).props.filtered).toBe(true);
  expect(state.rpc.mock.calls.flat()).not.toContain("firstmate.workflow.act");
});

it("Show task closes the covering conversation and opens no native agent or tab", async () => {
  fixture(); const host = "show-task";
  await mount(390, { host, params: workflowTaskRoute(workerRequest(host)).params });
  expect(renderer.root.findAllByType("ConverseDrawer" as never)).toHaveLength(1);
  const prior = renderer.root.findByType(FleetSurface).props as ComponentProps<typeof FleetSurface>;
  await act(async () => renderer.update(createElement(QueryClientProvider, { client }, createElement(FleetSurface, {
    ...prior, params: { ...workflowTaskRoute(workerRequest(host, false)).params, taskHandoff: "2" },
  }))));
  expect(renderer.root.findAllByType("ConverseDrawer" as never)).toHaveLength(0);
  expect(list().reveal.card).toBe("task-worker"); expect(shell.openView).not.toHaveBeenCalled();
});

it.each([[390, "First mate"], [1440, "Plans"], [1440, "Home files"], [1440, "Deck"]] as const)(
  "%s points: a consumed Show task reveal stays used after %s and List, but a new handoff still reveals", async (width, pane) => {
    fixture(); const host = `used-reveal-${width}-${pane}`;
    await mount(width, { host, params: workflowTaskRoute(workerRequest(host, false)).params });
    const first = list().reveal;
    expect(first.card).toBe(state.fleet!.cards[0]!.key);
    await act(async () => list().onRevealed?.(first.request));
    await act(async () => renderer.root.findAll(node => node.type === ("Pressable" as never) && node.props.accessibilityLabel === pane)[0]!.props.onPress());
    expect(renderer.root.findAllByType("TaskList" as never)).toHaveLength(0);
    await act(async () => renderer.root.findAll(node => node.type === ("Pressable" as never) && node.props.accessibilityLabel === "List")[0]!.props.onPress());
    expect(list().reveal).toBeNull();
    const prior = renderer.root.findByType(FleetSurface).props as ComponentProps<typeof FleetSurface>;
    await act(async () => renderer.update(createElement(QueryClientProvider, { client }, createElement(FleetSurface, {
      ...prior, params: { ...workflowTaskRoute(workerRequest(host, false)).params, taskHandoff: "2" },
    }))));
    expect(list().reveal.card).toBe(first.card); expect(list().reveal.request).not.toBe(first.request);
    const second = list().reveal;
    await act(async () => list().onRevealed?.(first.request));
    expect(list().reveal).toBe(second);
    await act(async () => list().onRevealed?.(second.request));
    expect(list().reveal).toBeNull();
  },
);

it("Show task keeps an unsaved remote host's card visible without opening a missing worker", async () => {
  const { card } = fixture(); card.remote!.serverId = null; card.remote!.online = false; card.remote!.worker = null;
  const host = "unsaved-host";
  await mount(390, { host, params: workflowTaskRoute(workerRequest(host, false)).params });
  expect(list().cards).toEqual([card]);
  expect(list().reveal.card).toBe(card.key);
  expect(renderer.root.findAllByType("ConverseDrawer" as never)).toHaveLength(0);
});

it("opens Home from the Plans workspace dialog with the same recorded worker and scope", async () => {
  const { plan } = fixture(); await mount(1440, { host: "plans-dialog", view: "plans" });
  await press(`Open plan: ${plan.definition.title}`);
  await press("Converse");
  expect(shell.openTask).toHaveBeenCalledExactlyOnceWith(workerRequest("plans-dialog"));
  expect(renderer.root.findAll(node => node.props.testID === "workflow-plan-dialog")).toHaveLength(0);
  expect(state.rpc.mock.calls.flat()).not.toContain("firstmate.workflow.act");
});

it.each(["host", "home", "mate", "worker"])("rejects a stale %s handoff without opening the wrong conversation", async changed => {
  fixture(); const request = workerRequest(`stale-${changed}`);
  if (changed === "host") request.scope = planSessionKey("other", "/sample", "agent-mate", "sample-home")!;
  if (changed === "home") state.fleet!.home = "/other";
  if (changed === "mate") state.fleet!.mate!.id = "other";
  if (changed === "worker") state.fleet!.cards[0]!.remote!.worker!.id = "replacement";
  await mount(390, { host: `stale-${changed}`, params: workflowTaskRoute(request).params }); await press("List");
  expect(renderer.root.findAllByType("ConverseDrawer" as never)).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).toContain("no longer available"); expect(list().reveal).toBeNull();
});

it.each(["host", "home", "mate", "workflow"])("does not carry the plan filter into another %s identity", async changed => {
  fixture(); const host = `isolation-${changed}`;
  await mount(390, { host, params: workflowTaskRoute(workerRequest(host, false)).params });
  expect(list().cards).toHaveLength(1);
  await unmount();
  if (changed === "home") state.fleet!.home = "/another-home";
  if (changed === "mate") state.fleet!.mate!.id = "another-mate";
  if (changed === "workflow") state.snapshot.homeId = "another-workflow-home";
  await mount(390, { host: changed === "host" ? "another-host" : host }); await press("List");
  expect(list().cards).toHaveLength(2); expect(list().filtered).toBe(false);
});

it("suppresses a card's duplicate plan link while that plan is the active filter", async () => {
  const { card } = fixture(); client = new QueryClient();
  function Probe() {
    const context = useWorkflowPlans();
    return createElement("Probe", { select: context.setPlanFilter }, createElement(PlanChip, { card, theme: attentionTheme }));
  }
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client }, createElement(WorkflowSurface, { theme: attentionTheme, hostId: "chip-host", children: createElement(Probe) }))); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(renderer.root.findAll(node => node.type === ("Pressable" as never) && node.props.accessibilityLabel?.startsWith("Open plan:"))).toHaveLength(1);
  await act(async () => renderer.root.findByType("Probe" as never).props.select(state.snapshot.plans[0]!.definition.id));
  expect(renderer.root.findAll(node => node.type === ("Pressable" as never) && node.props.accessibilityLabel?.startsWith("Open plan:"))).toHaveLength(0);
  await act(async () => renderer.root.findByType("Probe" as never).props.select(null));
  expect(renderer.root.findAll(node => node.type === ("Pressable" as never) && node.props.accessibilityLabel?.startsWith("Open plan:"))).toHaveLength(1);
});

function expectUsable(node: ReturnType<ReactTestRenderer["root"]["findByType"]>) {
  for (let current: typeof node | null = node; current; current = current.parent) {
    expect(current.props.pointerEvents).not.toBe("none");
    expect(current.props["aria-hidden"]).not.toBe(true);
    expect(current.props.accessibilityElementsHidden).not.toBe(true);
    expect(current.props.importantForAccessibility).not.toBe("no-hide-descendants");
    const styles = Array.isArray(current.props.style) ? current.props.style : [current.props.style];
    expect(styles.some(style => style?.display === "none")).toBe(false);
  }
}
function preserveUnsentMessages() {
  const files = [{ id: "kept", kind: "file" as const, fileName: "notes.txt", mimeType: "text/plain", size: 5, data: "aGVsbG8=" }];
  for (const key of draftKeys) { drafts.set(key, `Unsent ${key}\n`); pendingAttachments.set(key, files); }
  return () => {
    for (const key of draftKeys) { expect(drafts.get(key)).toBe(`Unsent ${key}\n`); expect(pendingAttachments.get(key)).toBe(files); }
  };
}

it.each([[390, "Show task"], [1440, "Show task"], [390, "Converse"], [1440, "Converse"]] as const)(
  "%s points: %s from a plan in Needs you reveals usable work without answering or clearing unsent messages", async (width, action) => {
    const { plan, card } = fixture(), preserved = preserveUnsentMessages();
    plan.status = "review";
    state.fleet!.needsYou!.planNow = [{ plan: plan.definition.id, title: plan.definition.title, question: "Review this plan", waits: [], neededBy: [], recommendation: "Review" }];
    const decisions = structuredClone(state.fleet!.needsYou);
    await mount(width, { host: `needs-plan-${width}-${action}`, params: { decision: "all", decisionHome: "sample-home" } });
    expect(renderer.root.findAllByType("DecisionDrawer" as never)).toHaveLength(1);
    await press(`Review plan: ${plan.definition.title}`);
    await press(action);
    expect(list().reveal.card).toBe(card.key);
    expect(renderer.root.findAllByType("DecisionDrawer" as never)).toHaveLength(0);
    if (action === "Converse") {
      const conversation = renderer.root.findByType("ConverseDrawer" as never);
      expect(conversation.props.watchKey).toBe("remote:lab-server-id:agent-task-worker");
      expectUsable(conversation);
    } else {
      expect(renderer.root.findAllByType("ConverseDrawer" as never)).toHaveLength(0);
      expectUsable(renderer.root.findByType("TaskList" as never));
    }
    expect(state.fleet!.needsYou).toEqual(decisions); preserved();
    expect(state.rpc.mock.calls.flat().every(name => ["firstmate.workflow.read", "firstmate.mate.targets", "firstmate.remotes.read", "firstmate.scope.read"].includes(name))).toBe(true);
  },
);

it("Show task from ordinary Home Plans remains usable without a decision drawer", async () => {
  const { plan, card } = fixture(); await mount(390, { host: "ordinary-plan-control" });
  await act(async () => renderer.root.findAll(node => node.type === ("Pressable" as never) && node.props.accessibilityLabel === "Plans")[0]!.props.onPress());
  await press(`Open plan: ${plan.definition.title}`); await press("Show task");
  expect(list().reveal.card).toBe(card.key);
  expect(renderer.root.findAllByType("DecisionDrawer" as never)).toHaveLength(0);
  expectUsable(renderer.root.findByType("TaskList" as never));
});

it.each([390, 1440])("a stale worker handoff shows recovery on the current Home Plans view at %s points", async width => {
  fixture(); const host = `stale-on-plans-${width}`, request = workerRequest(host), preserved = preserveUnsentMessages();
  state.values = { ...state.values, homePane: "plans" };
  state.fleet!.cards[0]!.remote!.worker!.id = "replacement-worker";
  await mount(width, { host, params: workflowTaskRoute(request).params });
  expect(renderer.root.findAllByType("ConverseDrawer" as never)).toHaveLength(0);
  expect(renderer.root.findAllByType("TaskList" as never)).toHaveLength(0);
  const notice = renderer.root.find(node => node.type === ("Text" as never) && typeof node.props.children === "string" && node.props.children.includes("no longer available"));
  expectUsable(notice); preserved();
});

it("the same stale worker handoff remains explained on Home List", async () => {
  fixture(); const host = "stale-on-list-control", request = workerRequest(host);
  state.values = { ...state.values, homePane: "board", crewView: "list" };
  state.fleet!.cards[0]!.remote!.worker!.id = "replacement-worker";
  await mount(390, { host, params: workflowTaskRoute(request).params });
  expect(renderer.root.findAllByType("ConverseDrawer" as never)).toHaveLength(0);
  const notice = renderer.root.find(node => node.type === ("Text" as never) && typeof node.props.children === "string" && node.props.children.includes("no longer available"));
  expectUsable(notice);
});
