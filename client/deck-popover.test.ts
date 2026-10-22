import type { PluginTheme } from "@getpaseo/plugin";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { WorkflowPlan } from "../shared/workflow-plans";
import type { WorkflowSnapshot } from "../shared/workflow-rpc";
import { attentionSnapshot, attentionTheme } from "../test/attention-deck-fixture";
import { workflowFixture } from "../test/workflow-fixture";
import { visibleText } from "../test/visible-text";

const rpc = vi.hoisted(() => ({ calls: [] as string[], snapshot: undefined as WorkflowSnapshot | undefined }));
vi.mock("react-native", () => ({ Pressable: "Pressable", Text: "Text", View: "View", ScrollView: "ScrollView", Image: "Image", Platform: { OS: "web", select: (options: { default: unknown }) => options.default } }));
vi.mock("@getpaseo/plugin/client/ui", () => ({ SettingsRow: "SettingsRow" }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: "Icon", TextInput: "TextInput", FlatList: "FlatList",
  Modal: Object.assign(({ open, title, onOpenChange, children }: { open: boolean; title: string; onOpenChange(value: boolean): void; children: ReactNode }) => open ? createElement("Modal", { title, onOpenChange }, children) : null, { Content: "Content" }),
}));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: (contract: { name: string }) => async () => {
  rpc.calls.push(contract.name);
  if (contract.name === "firstmate.workflow.read") return structuredClone(rpc.snapshot);
  if (contract.name === "firstmate.mate.targets") return { targets: [] };
  if (contract.name === "firstmate.remotes.read") return { hosts: [] };
  throw new Error(`Unexpected RPC: ${contract.name}`);
} }));

import { DecisionCountBubble, NeedsYouBubbles } from "./reply-bubble";
import { WorkflowSurface, WORKFLOW_QUERY_KEY } from "./workflow-plans";

const theme = attentionTheme as PluginTheme;
const place = { left: 0, top: 0, width: 280, maxHeight: 400, side: "below" as const, tail: 140 };
let renderer: ReactTestRenderer | undefined, cache: QueryClient | undefined;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; cache?.clear(); rpc.calls = []; });

function pendingPlan(id: string): WorkflowPlan {
  const definition = workflowFixture(); definition.id = id; definition.title = `Review ${id}`; definition.request.text = `The specific brief for ${id}.`;
  return { definition, revision: 1, sequence: 0, hash: "a".repeat(64), posture: "review", status: "review", approvedBudget: definition.budget,
    nodes: Object.fromEntries(definition.nodes.map(node => [node.id, { state: "planned" as const }])), told: [], handled: [], history: [] };
}

it("opens each pending plan review's own dialog without sending or acknowledging", async () => {
  const plans = [pendingPlan("alpha"), pendingPlan("bravo")], snapshot = attentionSnapshot([]);
  snapshot.actionCount = plans.length;
  snapshot.planNow = plans.map(plan => ({ plan: plan.definition.id, title: plan.definition.title, question: "Review this plan", waits: [], neededBy: [], recommendation: "" }));
  rpc.snapshot = { homeId: snapshot.homeId!, version: "plans-1", plans, subjects: Object.fromEntries(plans.map(plan => [plan.definition.id, plan.hash])), now: snapshot.planNow, comingUp: [] };
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  cache.setQueryData(WORKFLOW_QUERY_KEY, rpc.snapshot);
  const onOpen = vi.fn(), onClose = vi.fn();
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache! },
    createElement(WorkflowSurface, { theme, children: createElement(NeedsYouBubbles, { snapshot, place, theme, holdRef: null, onClose, onOpen }) }))); });
  for (const plan of plans) {
    const label = `Review plan: ${plan.definition.title}`;
    const row = renderer!.root.find(node => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === label);
    await act(async () => row.props.onPress());
    const dialog = renderer!.root.find(node => (node.type as unknown) === "Modal");
    expect(dialog.props.title).toBe(plan.definition.title);
    expect(visibleText(renderer!.toJSON())).toContain(plan.definition.request.text);
    await act(async () => dialog.props.onOpenChange(false));
  }
  expect(onClose).toHaveBeenCalledTimes(plans.length);
  expect(onOpen).not.toHaveBeenCalled();
  expect(rpc.calls.every(name => ["firstmate.workflow.read", "firstmate.mate.targets", "firstmate.remotes.read"].includes(name))).toBe(true);
});

it("renders the live count bubble only at the reserved first-mate anchor", async () => {
  const props = { snapshot: attentionSnapshot(), anchor: { key: "worker", x: 80, top: 80, bottom: 100, width: 300, height: 200, floor: null }, theme, holdRef: null, open: false, disabled: false, onPress: vi.fn() };
  await act(async () => { renderer = create(createElement(DecisionCountBubble, props)); });
  expect(renderer!.toJSON()).toBeNull();
  await act(async () => renderer!.update(createElement(DecisionCountBubble, { ...props, anchor: { ...props.anchor, key: "@first-mate" } })));
  expect(visibleText(renderer!.toJSON()).trim()).toBe("2");
});
