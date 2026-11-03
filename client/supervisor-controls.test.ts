import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SupervisorControlsSnapshot } from "../shared/supervisor-controls";
import { attentionTheme as theme } from "../test/attention-deck-fixture";
const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: (rpc: { name: string }) => rpc.name.endsWith("act-ui") ? mocks.write : mocks.read }));
vi.mock("react-native", () => ({ Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View" }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ TextInput: "TextInput", Modal: Object.assign(({ children }: { children: ReactNode }) => children, { Content: "Content" }) }));
vi.mock("./option-picker", () => ({ OptionPicker: "OptionPicker" }));
vi.mock("./workflow-plans", () => ({ workflowRequestId: () => "00000000-0000-4000-8000-000000000009" }));
import { SupervisorControlsButton, SupervisorDetailView } from "./supervisor-controls";
const id = "00000000-0000-4000-8000-000000000001", hash = "a".repeat(64), profile = { provider: "codex/sol", modeId: "full-access", thinkingOptionId: "high" };
let data: SupervisorControlsSnapshot, renderer: ReactTestRenderer | undefined, cache: QueryClient;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const configuration = { id, scopeId: id, generation: 1, requested: profile, resolved: profile, catalogDigest: hash, policyDigest: hash,
    target: { homeId: "home", hostId: "local" as const, scopeId: id, kind: "plan" as const, planId: "trial", planHash: hash }, limits: { supervisorSessions: 3, supervisorTurns: 10 }, effectiveEpoch: 1, provenance: "client UI (unverified)" as const };
  data = { homeId: "home", scopeId: id, title: "Trial plan", planHash: hash, policyDigest: hash, limits: configuration.limits, problems: [],
    catalog: [{ provider: profile.provider, label: "Sol", modes: [{ id: profile.modeId, label: "Full access" }], thinking: [{ id: "high", label: "High" }] }],
    view: { pendingDigest: null, reservedOwnerInputs: [], scopeId: id, binding: { scopeId: id, epoch: 1, hostId: "local", agentId: "native-id", workspaceId: "workspace", profileDigest: hash, checkpointHash: hash, acknowledgedSeq: 0, heartbeatDue: null, state: "active", configurationId: id },
      replacementResume: null, bindingDigest: hash, controlId: null, state: "active", configurations: [configuration], pending: null, sessions: 1, turns: 1,
      obligations: { uncertain: [], reserved: [], workers: [], sources: [], decisions: [], unlanded: [] }, retirement: "Retain all history and obligations." } };
  mocks.read.mockImplementation(async () => structuredClone(data));
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; cache.clear(); });
async function mount(node: ReactNode) { await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, node)); }); }
const button = (name: string) => renderer!.root.find(n => n.type === "Pressable" as never && n.props.accessibilityLabel === name);
it("shared Home/plan settings entry is inert until opened; reading and editing never submit an action", async () => {
  await mount(createElement(SupervisorControlsButton, { theme, compact: true, homeId: "home", scopeId: id }));
  expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  await act(async () => button("Supervisor settings").props.onPress());
  await vi.waitFor(async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); expect(button("Review profile change")).toBeDefined(); });
  expect(mocks.read).toHaveBeenCalledWith({ homeId: "home", scopeId: id });
  await act(async () => button("Review profile change").props.onPress()); expect(mocks.write).not.toHaveBeenCalled();
  await act(async () => button("Close Supervisor settings").props.onPress()); expect(mocks.write).not.toHaveBeenCalled();
});
it("a plan or policy change cannot silently retarget an already-open profile review", async () => {
  const onAction = vi.fn(), view = () => createElement(SupervisorDetailView, { theme, compact: true, data, onAction });
  await mount(view()); await act(async () => button("Review profile change").props.onPress());
  expect(button("Save pending profile change").props.disabled).toBe(false);
  data = { ...data, planHash: "b".repeat(64), policyDigest: "c".repeat(64) };
  await act(async () => renderer!.update(createElement(QueryClientProvider, { client: cache }, view())));
  expect(button("Save pending profile change").props.disabled).toBe(true); expect(onAction).not.toHaveBeenCalled();
});
it("a lost action reply retains the exact request, target and explicit reasoning on retry", async () => {
  mocks.write.mockRejectedValue(Error("Reply lost"));
  await mount(createElement(SupervisorControlsButton, { theme, compact: true, homeId: "home", scopeId: id }));
  await act(async () => button("Supervisor settings").props.onPress());
  await vi.waitFor(async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); expect(button("Review profile change")).toBeDefined(); });
  await act(async () => button("Review profile change").props.onPress());
  await act(async () => button("Save pending profile change").props.onPress());
  const original = mocks.write.mock.calls[0]![0]; expect(original).toMatchObject({ op: "stage", homeId: "home", scopeId: id, planHash: hash, profile });
  await act(async () => button("Retry exact saved request").props.onPress());
  expect(mocks.write.mock.calls[1]![0]).toEqual(original); expect(mocks.write).toHaveBeenCalledTimes(2);
});

it("pending withdrawal and undelivered-input disposition remain usable after subject/catalog drift and preserve exact displayed identities", async () => {
  const onAction = vi.fn(), pending = { ...data.view.configurations[0]!, effectiveEpoch: 2, generation: 2 };
  data = { ...data, planHash: "b".repeat(64), catalog: [], problems: ["Reviewed catalog changed"], view: { ...data.view, state: "change-pending", controlId: id, pendingDigest: hash,
    pending, reservedOwnerInputs: [{ id, version: 3, payloadDigest: hash, preview: "Original queued input" }], obligations: { ...data.view.obligations, reserved: [id] } } };
  await mount(createElement(SupervisorDetailView, { theme, compact: true, data, onAction }));
  expect(button("Review replacement").props.disabled).toBe(true); expect(button("Withdraw pending proposal").props.disabled).toBe(false);
  await act(async () => button("Withdraw pending proposal").props.onPress());
  expect(onAction.mock.calls[0]![0]).toMatchObject({ op: "withdraw-proposal", planHash: data.planHash, expectedControlId: id, configurationDigest: hash });
  await act(async () => button(`Withdraw undelivered input ${id}`).props.onPress());
  expect(onAction.mock.calls[1]![0]).toMatchObject({ op: "withdraw-input", effectId: id, effectVersion: 3, expectedControlId: id });
  expect(data.view.configurations).toHaveLength(1);
});
it("a project's Supervisor can be retired after an explicit review; a plan's offers no retire, and outstanding work disables it", async () => {
  const onAction = vi.fn(), view = () => createElement(SupervisorDetailView, { theme, compact: true, data, onAction });
  await mount(view());
  expect(() => button("Review retiring this Supervisor")).toThrow();
  data = { ...data, kind: "project", title: "Ariadne", planHash: null };
  await act(async () => renderer!.update(createElement(QueryClientProvider, { client: cache }, view())));
  await act(async () => button("Review retiring this Supervisor").props.onPress()); expect(onAction).not.toHaveBeenCalled();
  await act(async () => button("Keep this Supervisor").props.onPress());
  await act(async () => button("Review retiring this Supervisor").props.onPress());
  await act(async () => button("Retire project Supervisor").props.onPress());
  expect(onAction).toHaveBeenCalledExactlyOnceWith({ requestId: "00000000-0000-4000-8000-000000000009", homeId: "home", scopeId: id, expectedEpoch: 1, bindingDigest: hash, planHash: null, op: "retire" });
  data = { ...data, view: { ...data.view, obligations: { ...data.view.obligations, reserved: ["reserved-input"] } } };
  await act(async () => renderer!.update(createElement(QueryClientProvider, { client: cache }, view())));
  expect(button("Retire project Supervisor").props.disabled).toBe(true);
  data = { ...data, view: { ...data.view, state: "retired", binding: { ...data.view.binding!, state: "retired" } } };
  await act(async () => renderer!.update(createElement(QueryClientProvider, { client: cache }, view())));
  expect(() => button("Retire project Supervisor")).toThrow();
  expect(JSON.stringify(renderer!.toJSON())).toContain("Its conversation stays readable in Paseo");
});
