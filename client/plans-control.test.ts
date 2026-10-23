import { act, createElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { WorkflowSnapshot } from "../shared/workflow-rpc";
import { compactPlansFixture } from "../test/compact-plans-fixture";
import { attentionTheme } from "../test/attention-deck-fixture";

const state = vi.hoisted(() => ({ snapshot: null as WorkflowSnapshot | null, actions: vi.fn(), fleet: { home: "/sample", mate: { id: "mate" }, cards: [] } }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: (contract: { name: string }) => async (input: unknown) => {
  if (contract.name === "firstmate.workflow.read") return state.snapshot;
  if (contract.name === "firstmate.workflow.act") {
    state.actions(input);
    const next = structuredClone(state.snapshot!);
    next.version = "approved"; next.plans[0]!.status = "active";
    next.subjects[next.plans[0]!.definition.id] = "b".repeat(64);
    state.snapshot = next;
    return next;
  }
  if (contract.name === "firstmate.mate.targets") return { targets: [] };
  if (contract.name === "firstmate.remotes.read") return { hosts: [] };
  throw new Error(`Unexpected RPC: ${contract.name}`);
} }));
vi.mock("react-native", () => ({ Pressable: "Pressable", Text: "Text", View: "View", Image: "Image", useWindowDimensions: () => ({ width: 1000, height: 800 }), Platform: { OS: "web", select: (options: { default: unknown }) => options.default } }));
vi.mock("@getpaseo/plugin/client/ui", () => ({ SettingsRow: "SettingsRow" }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: "Icon", TextInput: "TextInput", FlatList: "FlatList", Modal: Object.assign(({ open, children }: { open: boolean; children: ReactNode }) => open ? children : null, { Content: "Content" }) }));
vi.mock("./fleet-query", () => ({ FLEET_QUERY_KEY: ["fleet"], useFleet: () => ({ data: state.fleet, isPlaceholderData: false, error: null }) }));
import { PlansControl, WorkflowSurface, WORKFLOW_QUERY_KEY, useWorkflowPlans } from "./workflow-plans";
import { planSessionKey, updatePlanBrowse } from "./workflow-plan-state";
import { ToolbarButton } from "./task-toolbar";

let renderer: ReactTestRenderer | undefined, cache: QueryClient | undefined, nextHost = 0;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; cache?.clear(); state.actions.mockClear(); });
function Filter() {
  const plans = useWorkflowPlans();
  return createElement(PlansControl, { theme: attentionTheme, selected: plans.planFilter ?? null, onSelect: plans.setPlanFilter! });
}
async function mount(status: "review" | "active", selected = true) {
  const plan = structuredClone(compactPlansFixture()[0]!);
  plan.definition.implicit = true; plan.status = status;
  state.snapshot = { homeId: "filter-home", version: "1", plans: [plan], subjects: { [plan.definition.id]: "a".repeat(64) }, now: [], comingUp: [] };
  const host = `plans-control-${++nextHost}`;
  updatePlanBrowse(planSessionKey(host, state.fleet.home, state.fleet.mate.id, state.snapshot.homeId), { filter: selected ? plan.definition.id : null });
  cache = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  cache.setQueryData(WORKFLOW_QUERY_KEY, state.snapshot);
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache! }, createElement(WorkflowSurface, { theme: attentionTheme, hostId: host, children: createElement(Filter) }))); });
  return plan;
}
function button(label: string) { return renderer!.root.find(node => node.type === ("Pressable" as never) && node.props.accessibilityLabel === label); }
async function press(label: string) { await act(async () => button(label).props.onPress()); }
async function openFilter() { await act(async () => renderer!.root.findByType(ToolbarButton).props.onPress()); }

it("keeps a selected implicit-plan filter visible and clearable when the menu has no plans", async () => {
  await mount("active");
  await openFilter();
  await press("All plans and tasks");
  expect(renderer!.root.findByType(PlansControl).props.selected).toBeNull();
  expect(renderer!.root.findAllByProps({ accessibilityLabel: "Plan filter: selected" })).toHaveLength(0);
  expect(state.actions).not.toHaveBeenCalled();
});

it("keeps the selected filter clearable when approval removes its implicit plan from the menu", async () => {
  const plan = await mount("review");
  await openFilter();
  await press(`Open plan: ${plan.definition.title}`);
  await press("Approve");
  expect(state.actions).toHaveBeenCalledOnce();
  expect(renderer!.root.findByType(PlansControl).props.selected).toBe(plan.definition.id);
  await openFilter();
  expect(renderer!.root.findAllByProps({ accessibilityLabel: `Filter: ${plan.definition.title}` })).toHaveLength(0);
  await press("All plans and tasks");
  expect(renderer!.root.findByType(PlansControl).props.selected).toBeNull();
  expect(state.actions).toHaveBeenCalledOnce();
});

it("omits an empty plan menu when no filter is selected", async () => {
  await mount("active", false);
  expect(renderer!.root.findAll(node => node.type === ("Pressable" as never))).toHaveLength(0);
  expect(state.actions).not.toHaveBeenCalled();
});
