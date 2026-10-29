import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { attentionTheme as theme } from "../test/attention-deck-fixture";
import { visibleText } from "../test/visible-text";
const state = vi.hoisted(() => ({ projects: {} as any, checks: {} as any, activation: {} as any, calls: [] as string[], fail: false, activationError: false, refreshActivation: vi.fn() }));
vi.mock("react-native", () => ({ Pressable: "Pressable", Text: "Text", View: "View" }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: (rpc: { name: string }) => async () => {
  state.calls.push(rpc.name);
  if (state.fail) throw new Error("read unavailable");
  if (rpc.name === "firstmate.projects.read") return structuredClone(state.projects);
  if (rpc.name === "firstmate.maintenance.read") return structuredClone(state.checks);
  throw new Error(`Unexpected effect: ${rpc.name}`);
} }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Modal: Object.assign(({ open, children }: { open: boolean; children: ReactNode }) => open ? children : null, { Content: "Content" }) }));
vi.mock("./workflow-plans", () => ({ useWorkflowPlans: () => ({ activation: state.activation, activationError: state.activationError, refreshActivation: state.refreshActivation }) }));
vi.mock("./project-ownership", () => ({ ProjectOwnershipBoard: "ProjectOwnershipBoard" }));
vi.mock("./maintenance-ownership", () => ({ MaintenanceOwnershipBoard: "MaintenanceOwnershipBoard" }));
vi.mock("./supervision-activation", () => ({ SupervisionActivationBoard: "SupervisionActivationBoard" }));
import { WorkDetails } from "./work-details";
let renderer: ReactTestRenderer | undefined, cache: QueryClient;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.calls = []; state.fail = false; state.activationError = false; state.refreshActivation.mockReset();
  state.activation = { enabled: true, homeId: "fixture", problems: [], plans: [], audits: [], migrations: [], dispositions: [] };
  state.projects = { enabled: true, homeId: "fixture", registryDigest: null, sequence: 0, hash: null, freshness: "uninitialized", problems: [],
    general: { agentId: null, scopeId: null, slots: 4, headroom: 1, providerAvailability: "unknown" }, projects: [] };
  state.checks = { enabled: true, homeId: "fixture", sequence: 0, freshness: "uninitialized", lowerBound: false, problems: [],
    cleanup: { state: "held", reason: "G8", conditions: [] }, jobs: [], occurrences: [], hosts: [], incidents: [], reservations: [], owners: [], deliveries: [], captainDecisions: [], decisions: [], outbox: [] };
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => { await act(async () => renderer?.unmount()); cache.clear(); });
async function mount(always = false) {
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(WorkDetails, { theme, compact: true, always }))); });
  await vi.waitFor(async () => { await act(async () => { await new Promise(done => setTimeout(done, 10)); }); expect(cache.isFetching()).toBe(0); });
}
const text = () => visibleText(renderer!.toJSON());
it("enabled empty inventories use no main-screen space, while settings keeps a details entry", async () => {
  await mount(); expect(renderer!.toJSON()).toBe(null);
  await act(async () => renderer!.unmount()); await mount(true);
  expect(text()).toContain("Advanced work details");
  expect(state.calls.every(name => name.endsWith(".read"))).toBe(true);
});
it("disabled controls keep a failed opening/audit reachable and opening details sends nothing", async () => {
  state.activation.enabled = false; state.projects.enabled = false; state.checks.enabled = false;
  state.activation.audits = [{ at: "2026-10-29T09:00:00Z", plan: "reader", supervisor: "saved-supervisor", source: "client UI (unverified)" }];
  state.activation.plans = [{ binding: "retired", opening: "failed" }];
  await mount(); expect(text()).toContain("Review details before continuing");
  await act(async () => renderer!.root.find(n => n.type === "Pressable" as never).props.onPress());
  expect(renderer!.root.findByType("SupervisionActivationBoard" as never).props.advanced).toBe(true);
  expect(state.calls).toContain("firstmate.projects.read"); expect(state.calls).toContain("firstmate.maintenance.read");
  expect(state.calls.every(name => name.endsWith(".read"))).toBe(true);
});
it("cold read failure stays visible even with no saved inventory", async () => {
  state.fail = true; await mount();
  expect(text()).toContain("Some work couldn't be checked");
  expect(text()).not.toContain("No saved project mates");
});
it("F1: accepted project navigation dismisses the containing details dialog", async () => {
  await mount(true);
  await act(async () => renderer!.root.find(n => n.type === "Pressable" as never).props.onPress());
  const project = renderer!.root.findByType("ProjectOwnershipBoard" as never);
  await act(async () => project.props.onNavigate?.());
  expect(renderer!.root.findAllByType("ProjectOwnershipBoard" as never)).toHaveLength(0);
});
it("F2: opening/reopening details retries its owning plan read, including a cold error", async () => {
  state.activation = undefined; state.activationError = true;
  await mount(true);
  const trigger = () => renderer!.root.find(n => n.type === "Pressable" as never && n.props.accessibilityLabel === "Advanced work details");
  await act(async () => trigger().props.onPress());
  expect(state.refreshActivation).toHaveBeenCalledTimes(1);
  await act(async () => renderer!.root.findByProps({ title: "Work details" }).props.onOpenChange(false));
  await act(async () => trigger().props.onPress());
  expect(state.refreshActivation).toHaveBeenCalledTimes(2);
  expect(state.calls.every(name => name.endsWith(".read"))).toBe(true);
});
it("F2: first recovered activation metadata keeps details open; a changed known home closes it", async () => {
  const saved = state.activation; state.activation = undefined; state.activationError = true;
  await mount(true);
  await act(async () => renderer!.root.find(n => n.type === "Pressable" as never && n.props.accessibilityLabel === "Advanced work details").props.onPress());
  state.activation = saved; state.activationError = false;
  const update = () => renderer!.update(createElement(QueryClientProvider, { client: cache }, createElement(WorkDetails, { theme, compact: true, always: true })));
  await act(async () => update());
  expect(renderer!.root.findAllByType("ProjectOwnershipBoard" as never)).toHaveLength(1);
  state.activation = { ...saved, homeId: "another-home" };
  await act(async () => update());
  expect(renderer!.root.findAllByType("ProjectOwnershipBoard" as never)).toHaveLength(0);
});
it("F2: recovered activation from another home still closes details even without earlier activation metadata", async () => {
  const saved = state.activation; state.activation = undefined; state.activationError = true;
  await mount(true);
  await act(async () => renderer!.root.find(n => n.type === "Pressable" as never && n.props.accessibilityLabel === "Advanced work details").props.onPress());
  state.activation = { ...saved, homeId: "another-home" }; state.activationError = false;
  await act(async () => renderer!.update(createElement(QueryClientProvider, { client: cache }, createElement(WorkDetails, { theme, compact: true, always: true }))));
  expect(renderer!.root.findAllByType("ProjectOwnershipBoard" as never)).toHaveLength(0);
});
