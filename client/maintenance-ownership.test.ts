import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MaintenanceRuntimeSnapshot } from "../shared/maintenance-runtime";
import { attentionTheme as theme } from "../test/attention-deck-fixture";
const mocks = vi.hoisted(() => ({ read: vi.fn(), admit: vi.fn(), answer: vi.fn(), models: vi.fn() }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: (rpc: { name: string }) => rpc.name.endsWith("admit-ui") ? mocks.admit : rpc.name.endsWith("answer-ui") ? mocks.answer : rpc.name.endsWith("maintenance.read") ? mocks.read : mocks.models }));
vi.mock("react-native", () => ({ Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View" }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ TextInput: "TextInput", Modal: Object.assign(({ open, children }: { open: boolean; children: ReactNode }) => open ? children : null, { Content: "Content" }) }));
vi.mock("./option-picker", () => ({ OptionPicker: "OptionPicker" }));
vi.mock("./workflow-plans", () => ({ workflowRequestId: () => "00000000-0000-4000-8000-000000000003" }));
import { MaintenanceOwnershipBoard } from "./maintenance-ownership";
import { RoutineCheckSetup } from "./routine-check-setup";
const id = "00000000-0000-4000-8000-000000000001", hash = "a".repeat(64);
let renderer: ReactTestRenderer | undefined, cache: QueryClient, data: MaintenanceRuntimeSnapshot;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  data = { enabled: true, homeId: "fixture-home", sequence: 0, freshness: "uninitialized", lowerBound: true, problems: [], cleanup: { state: "held", reason: "G8", conditions: [] },
    jobs: [], occurrences: [], hosts: [], incidents: [], reservations: [], owners: [], deliveries: [], captainDecisions: [], decisions: [], outbox: [] };
  mocks.read.mockImplementation(async () => structuredClone(data));
  mocks.models.mockResolvedValue({ targets: [{ provider: "codex/test", label: "Test model", modes: [{ id: "full-access", label: "Full access" }] }] });
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; cache.clear(); });
const button = (label: string) => renderer!.root.find(n => n.type === "Pressable" as never && n.props.accessibilityLabel === label);
async function mount(extra: Partial<Parameters<typeof MaintenanceOwnershipBoard>[0]> = {}) {
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(MaintenanceOwnershipBoard, { theme, compact: true, advanced: true, ...extra }))); });
  await vi.waitFor(async () => { await act(async () => { await new Promise(done => setTimeout(done, 0)); }); expect(button("Refresh maintenance")).toBeDefined(); });
}
async function setup(extra: Partial<Parameters<typeof RoutineCheckSetup>[0]> = {}) {
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(RoutineCheckSetup,
    { theme, compact: true, homeId: data.homeId, hostId: "local", online: true, canEnable: true, onEnable: vi.fn(), onClose: vi.fn(), ...extra }))); });
  await vi.waitFor(async () => { await act(async () => { await new Promise(done => setTimeout(done, 0)); }); expect(button(data.enabled ? "Review checks profile" : "Review routine-check opt-in")).toBeDefined(); });
}
it("fresh-home app reads/opening create nothing; explicit confirmation retains exact admission after a lost reply", async () => {
  mocks.admit.mockRejectedValue(new Error("reply lost")); await setup();
  expect(mocks.admit).not.toHaveBeenCalled(); await act(async () => button("Review checks profile").props.onPress());
  expect(mocks.admit).not.toHaveBeenCalled(); expect(button("Create checks conversation").props.disabled).toBe(true);
  await vi.waitFor(() => expect(mocks.models).toHaveBeenCalled());
  await act(async () => {
    renderer!.root.find(n => n.type === "TextInput" as never && n.props.accessibilityLabel === "Checks conversation name").props.onChangeText("Storage");
    renderer!.root.find(n => n.type === "OptionPicker" as never && n.props.label === "Checks model").props.onSelect("codex/test");
  });
  await act(async () => renderer!.root.find(n => n.type === "OptionPicker" as never && n.props.label === "Checks permission mode").props.onSelect("full-access"));
  await act(async () => { const press = button("Create checks conversation").props.onPress; press(); press(); });
  expect(mocks.admit).toHaveBeenCalledTimes(1);
  expect(mocks.admit.mock.calls[0]![0]).toMatchObject({ homeId: "fixture-home", name: "Storage", limits: { supervisorSessions: 1, supervisorTurns: 20 } });
  await act(async () => button("Retry exact checks setup").props.onPress());
  expect(mocks.admit.mock.calls[1]![0]).toEqual(mocks.admit.mock.calls[0]![0]);
});
it("a fresh client resumes the recorded maintenance request and a failed refresh disables confirmation", async () => {
  const admission = { homeId: data.homeId, requestId: id, scopeId: id, name: "Storage", profile: { provider: "codex/test", modeId: "full-access" }, limits: { supervisorSessions: 1 as const, supervisorTurns: 20 } };
  data.owners = [{ scopeId: id, state: "transferring", agentId: "reserved-owner", epoch: 1, sessions: 1, turns: 1, uncertain: 1, opening: "reserved", admission }];
  mocks.admit.mockRejectedValue(new Error("held")); await mount(); await act(async () => button("Resume Storage").props.onPress());
  expect(mocks.models).not.toHaveBeenCalled(); await act(async () => button("Check saved checks setup").props.onPress());
  expect(mocks.admit.mock.calls[0]![0]).toEqual({ homeId: data.homeId, requestId: id, resume: true });
  mocks.read.mockRejectedValue(new Error("offline")); await act(async () => { await cache.refetchQueries(); await new Promise(done => setTimeout(done, 20)); });
  expect(button("Retry exact checks setup").props.disabled).toBe(true);
});
it("off preview and cancellation create nothing; opt-in is a separate settings review", async () => {
  data.enabled = false; const enable = vi.fn(), close = vi.fn(); await setup({ onEnable: enable, onClose: close });
  expect(renderer!.root.findAll(n => n.type === "Pressable" as never && n.props.accessibilityLabel === "Review checks profile")).toHaveLength(0);
  await act(async () => button("Back to settings").props.onPress()); expect(close).toHaveBeenCalledOnce();
  await act(async () => button("Review routine-check opt-in").props.onPress()); expect(enable).toHaveBeenCalledOnce();
  expect(mocks.admit).not.toHaveBeenCalled(); expect(mocks.answer).not.toHaveBeenCalled(); expect(mocks.models).not.toHaveBeenCalled();
});
it.each(["held", "offline", "wrong-home"])("%s reads cannot authorize checks creation", async reason => {
  if (reason === "held") { data.freshness = "held"; data.problems = ["Damaged source"]; }
  if (reason === "wrong-home") { mocks.read.mockResolvedValue({ ...data, homeId: "another-home" }); }
  if (reason === "wrong-home") {
    await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(RoutineCheckSetup,
      { theme, compact: true, homeId: data.homeId, hostId: "local", online: true, canEnable: true, onEnable: vi.fn(), onClose: vi.fn() }))); });
    await vi.waitFor(async () => { await act(async () => { await new Promise(done => setTimeout(done, 0)); }); expect(JSON.stringify(renderer!.toJSON())).toContain("Can't check routine checks"); });
  } else { await setup({ online: reason !== "offline" }); expect(button("Review checks profile").props.disabled).toBe(true); }
  expect(mocks.admit).not.toHaveBeenCalled();
});
it("F1: inspecting a retained checks conversation dismisses details without starting any work", async () => {
  data.enabled = false;
  data.owners = [{ scopeId: id, state: "retired", agentId: "saved-checks", epoch: 2, sessions: 1, turns: 1, uncertain: 1, admission: null, opening: "uncertain" }];
  const order: string[] = [], openAgent = vi.fn(() => order.push("open")), onNavigate = vi.fn(() => order.push("dismiss"));
  await mount({ navigation: { openAgent, openWorkspace: vi.fn() }, onNavigate });
  await act(async () => button("Open maintenance owner").props.onPress());
  expect(openAgent).toHaveBeenCalledExactlyOnceWith({ agentId: "saved-checks" });
  expect(order).toEqual(["open", "dismiss"]); expect(mocks.admit).not.toHaveBeenCalled(); expect(mocks.answer).not.toHaveBeenCalled();
});
