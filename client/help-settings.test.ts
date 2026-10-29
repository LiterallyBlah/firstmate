import { act, createElement, type ElementType } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { PluginTheme } from "@getpaseo/plugin";
import { FEATURES_OFF, type FeatureReadResult, type FeatureSetInput } from "../shared/feature-settings";
import { HELP, helpSelection } from "./feature-settings-model";

const state = vi.hoisted(() => ({ read: vi.fn(), set: vi.fn(), id: vi.fn(), maintenance: vi.fn() }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable" }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: (c: { name: string }) => c.name === "firstmate.maintenance.read" ? state.maintenance : c.name.endsWith(".read") ? state.read : state.set }));
vi.mock("./option-picker", () => ({ OptionPicker: "OptionPicker" }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ TextInput: "TextInput",
  Modal: Object.assign(({ open, children }: { open: boolean; children: unknown }) => open ? children : null, { Content: ({ children }: { children: unknown }) => children }) }));
vi.mock("./workflow-plans", () => ({ workflowRequestId: () => state.id() }));
import { FEATURE_SETTINGS_QUERY_KEY, HelpSettings } from "./help-settings";

const home = "C:/fixture/home", id = "00000000-0000-4000-8000-000000000001";
const theme = { colors: {} } as PluginTheme;
let snapshot: FeatureReadResult, renderer: ReactTestRenderer | null, cache: QueryClient;
const copy = <T,>(value: T): T => structuredClone(value);
const text = () => JSON.stringify(renderer!.toJSON());
const button = (label: string) => renderer!.root.findAllByType("Pressable" as ElementType).find(n => n.props.accessibilityLabel === label)!;
async function press(label: string) { await act(async () => { const b = button(label); expect(b, label).toBeDefined(); expect(b.props.disabled, label).toBe(false); b.props.onPress(); }); }
async function mount(hostId = "local", selectedHome = home) {
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(HelpSettings, { key: `${hostId}:${selectedHome}`, theme, hostId, home: selectedHome }))); });
  await act(async () => { await new Promise(done => setTimeout(done, 5)); });
}
async function update() { await act(async () => { await cache.invalidateQueries({ queryKey: FEATURE_SETTINGS_QUERY_KEY }); }); await act(async () => { await new Promise(done => setTimeout(done, 5)); }); }
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  renderer = null; cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  snapshot = { homeId: home, revision: 0, source: "default", state: "ready", requested: { ...FEATURES_OFF }, effective: { ...FEATURES_OFF },
    capacity: { slots: 4, generalHeadroom: 1 }, policy: null, problems: [], dependencyRefusals: [], runtimeEnforced: true, writesAvailable: true,
    inventory: { complete: false, coverage: [], sequence: 0, active: 0, pending: 0, uncertain: 0, problems: ["Other delivery sources have not been checked."] }, pause: null };
  state.read.mockReset().mockImplementation(async () => copy(snapshot));
  state.maintenance.mockReset().mockImplementation(async () => ({ enabled: snapshot.effective.maintenance, homeId: home, sequence: 0, freshness: "uninitialized", lowerBound: true,
    problems: [], cleanup: { state: "held", reason: "G8", conditions: [] }, jobs: [], occurrences: [], hosts: [], incidents: [], reservations: [], owners: [], deliveries: [], captainDecisions: [], decisions: [], outbox: [] }));
  state.id.mockReset().mockReturnValue(id);
  state.set.mockReset().mockImplementation(async (input: FeatureSetInput) => {
    const policy = { format: "firstmate.feature-policy/1" as const, homeId: input.home, revision: input.expectedRevision + 1, ...input.change,
      updated: { kind: "plugin-ui-unverified" as const, source: "firstmate.features.set" as const, requestId: input.requestId, at: "2026-10-29T13:00:00.000Z" } };
    snapshot = { ...snapshot, revision: policy.revision, requested: { ...input.change.requested }, capacity: input.change.capacity,
      policy, source: "saved", state: "ready", writesAvailable: true, effective: { ...input.change.requested } };
    return { homeId: input.home, requestId: input.requestId, policy };
  });
});
afterEach(() => { act(() => renderer?.unmount()); cache.clear(); });

it("keeps first-update help off; opening, canceling and details only read", async () => {
  await mount();
  for (const kind of ["projects", "plans"] as const) { await press(HELP[kind].action); expect(text()).toContain("This save creates no session"); await press("Cancel"); }
  await press(HELP.checks.action); await press("Back to settings");
  await press("Help details"); await press("Review capacity"); await press("Cancel");
  expect(state.set).not.toHaveBeenCalled(); expect(state.id).not.toHaveBeenCalled(); expect(snapshot.effective).toEqual(FEATURES_OFF);
});

it("applies only the reviewed project dependencies, immediately, without a session or restart", async () => {
  await mount(); await press("Set up project mates"); await press("Save help settings");
  expect(state.set).toHaveBeenCalledExactlyOnceWith({ home, expectedRevision: 0, requestId: id, change: {
    requested: { ...FEATURES_OFF, projectMates: true, scopeUi: true, scopeExecution: true }, capacity: { slots: 4, generalHeadroom: 1 } } });
  expect(text()).toContain("Your settings are saved and applied here."); expect(text()).toContain("Turn off project mates");
});

it.each(["plans", "checks"] as const)("enables only %s and its reviewed dependencies", async kind => {
  await mount(); await press(HELP[kind].action);
  if (kind === "checks") { await vi.waitFor(async () => { await act(async () => { await new Promise(done => setTimeout(done, 0)); }); expect(button("Review routine-check opt-in")).toBeDefined(); }); await press("Review routine-check opt-in"); }
  await press("Save help settings");
  expect(state.set.mock.calls[0]![0].change.requested).toEqual(kind === "plans" ? {
    ...FEATURES_OFF, planSupervisors: true, scopedActivation: true, scopeUi: true, scopeExecution: true,
  } : { ...FEATURES_OFF, maintenance: true });
});

it("preserves all 64 independent pilot combinations until an explicit exact save", () => {
  for (let mask = 0; mask < 64; mask++) {
    const keys = Object.keys(FEATURES_OFF) as (keyof typeof FEATURES_OFF)[];
    const current = Object.fromEntries(keys.map((k, n) => [k, !!(mask & 1 << n)])) as typeof FEATURES_OFF;
    for (const kind of Object.keys(HELP) as (keyof typeof HELP)[]) {
      const next = helpSelection(current, kind, true);
      for (const k of keys) expect(next[k]).toBe(HELP[kind].capabilities.some(c => c === k) || current[k]);
    }
  }
});

it("shows partial pilot state and saves the exact choices without broadening", async () => {
  snapshot.source = "legacy-environment"; snapshot.requested.scopeExecution = true;
  snapshot.dependencyRefusals = [{ capability: "scopeExecution", code: "DEPENDENCY_DISABLED", reason: "Enable conversation controls before sending contextual messages." }];
  await mount(); expect(text()).toContain("Using your existing setup"); expect(state.set).not.toHaveBeenCalled();
  await press("Keep existing setup"); await press("Save help settings");
  expect(state.set.mock.calls[0]![0].change.requested).toEqual({ ...FEATURES_OFF, scopeExecution: true });
});

it("keeps a failed save's draft and old state, and retries only the original request", async () => {
  state.set.mockRejectedValueOnce(new Error("permission denied"));
  await mount(); await press("Set up project mates"); await press("Save help settings");
  expect(text()).toContain("permission denied"); expect(text()).toContain("Your review is kept"); expect(snapshot.effective).toEqual(FEATURES_OFF);
  const original = copy(state.set.mock.calls[0]![0]);
  await press("Close review"); expect(button("Set up project mates").props.disabled).toBe(true);
  await press("Review saved settings request"); await press("Retry exact settings save");
  expect(state.set.mock.calls[1]![0]).toEqual(original); expect(state.id).toHaveBeenCalledTimes(1);
});

it("can replace a refused request with a fresh read-only review of current settings", async () => {
  state.set.mockRejectedValueOnce(new Error("Feature settings changed in another client"));
  await mount(); await press("Set up project mates"); await press("Save help settings");
  snapshot.revision = 1; snapshot.requested.maintenance = true; snapshot.effective.maintenance = true;
  await press("Review current setup"); expect(state.set).toHaveBeenCalledTimes(1);
  await press("Set up project mates"); expect(button("Save help settings").props.disabled).toBe(false);
  await press("Cancel"); expect(state.set).toHaveBeenCalledTimes(1);
});

it("holds duplicate confirm while a save is in flight", async () => {
  let reject!: (e: Error) => void;
  state.set.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  await mount(); await press("Set up project mates");
  const save = button("Save help settings").props.onPress;
  await act(async () => { save(); save(); });
  expect(state.set).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("lost reply")));
  expect(button("Retry exact settings save")).toBeDefined();
});

it("checks a lost reply through a read without issuing another save", async () => {
  const save = state.set.getMockImplementation()!;
  state.set.mockImplementationOnce(async input => { await save(input); throw new Error("lost reply"); });
  await mount(); await press("Review routine checks");
  await vi.waitFor(async () => { await act(async () => { await new Promise(done => setTimeout(done, 0)); }); expect(button("Review routine-check opt-in")).toBeDefined(); });
  await press("Review routine-check opt-in"); await press("Save help settings");
  await press("Check saved settings"); expect(state.set).toHaveBeenCalledTimes(1); expect(text()).toContain("Your settings are saved and applied here.");
});

it("refuses a stale two-client review and retains it for comparison", async () => {
  await mount(); await press("Set up project mates"); snapshot.revision = 1; snapshot.requested.maintenance = true; snapshot.effective.maintenance = true;
  await update(); expect(text()).toContain("Settings changed while this review was open"); expect(button("Save help settings").props.disabled).toBe(true);
  await press("Cancel"); await press("Set up project mates"); await press("Save help settings");
  expect(state.set.mock.calls[0]![0].expectedRevision).toBe(1); expect(state.set.mock.calls[0]![0].change.requested.maintenance).toBe(true);
});

it("rereads after save rather than accepting a background read begun before it", async () => {
  await mount(); await press("Set up project mates");
  let finishOld!: (s: FeatureReadResult) => void;
  const old = copy(snapshot);
  state.read.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  await act(async () => { void cache.invalidateQueries({ queryKey: FEATURE_SETTINGS_QUERY_KEY }); });
  await press("Save help settings");
  expect(text()).toContain("Your settings are saved and applied here.");
  await act(async () => finishOld(old));
  expect(button("Turn off project mates")).toBeDefined();
  expect(cache.getQueryData<FeatureReadResult>([...FEATURE_SETTINGS_QUERY_KEY, "local", home])?.revision).toBe(1);
});

it("reviews turn-off with overlapping lower bounds, unknown coverage and honest pause semantics", async () => {
  snapshot.requested = helpSelection({ ...FEATURES_OFF, maintenance: true }, "projects", true); snapshot.effective = { ...snapshot.requested };
  snapshot.inventory = { ...snapshot.inventory, active: 2, pending: 3, uncertain: 2 };
  await mount(); await press("Turn off project mates");
  for (const value of ["Active helpers: at least 2", "Pending operations: at least 3", "Uncertain operations: at least 2", "can overlap", "Calls already in flight can finish", "does not delete helpers"]) expect(text()).toContain(value);
  await press("Save help settings"); expect(state.set.mock.calls[0]![0].change.requested).toEqual({ ...snapshot.requested, projectMates: false });
  expect(snapshot.requested.maintenance).toBe(true); expect(snapshot.requested.scopeExecution).toBe(true);
});

it("requires a separate capacity review; never raises capacity while enabling help", async () => {
  await mount(); await press("Help details"); await press("Review capacity");
  await act(async () => { renderer!.root.findByProps({ accessibilityLabel: "Plugin slots" }).props.onChangeText("6"); });
  expect(text()).toContain("Proposed: "); expect(text()).toContain("may increase spending");
  await press("Save help settings"); expect(snapshot.capacity).toEqual({ slots: 6, generalHeadroom: 1 }); expect(snapshot.requested).toEqual(FEATURES_OFF);
});

it("holds damaged policy and read/permission failures without inventing applied state", async () => {
  snapshot.state = "held"; snapshot.revision = null; snapshot.writesAvailable = false; snapshot.capacity = null;
  await mount(); expect(button("Set up project mates").props.disabled).toBe(true); expect(text()).toContain("Advanced work details");
  state.read.mockRejectedValue(new Error("permission denied")); await update();
  expect(text()).toContain("Can't read help settings right now"); expect(state.set).not.toHaveBeenCalled();
});

it("can explicitly repair invalid legacy capacity without normalizing pilot flags", async () => {
  snapshot.source = "legacy-environment"; snapshot.capacity = null; snapshot.state = "held"; snapshot.writesAvailable = false; snapshot.requested.scopeUi = true;
  await mount(); await press("Review capacity"); expect(button("Save help settings").props.disabled).toBe(true);
  await act(async () => {
    renderer!.root.findByProps({ accessibilityLabel: "Plugin slots" }).props.onChangeText("4");
  });
  await act(async () => { renderer!.root.findByProps({ accessibilityLabel: "Slots reserved for FirstMate" }).props.onChangeText("1"); });
  await press("Save help settings"); expect(state.set.mock.calls[0]![0].change.requested).toEqual({ ...FEATURES_OFF, scopeUi: true });
});

it("unmounts an old host/home review and ignores its delayed result", async () => {
  let resolve!: (v: unknown) => void;
  state.set.mockImplementation(() => new Promise(done => { resolve = done; }));
  await mount(); await press("Set up project mates"); await press("Save help settings");
  const request = state.set.mock.calls[0]![0];
  await act(async () => { renderer!.unmount(); }); snapshot = { ...snapshot, homeId: "C:/fixture/other" };
  await mount("remote", "C:/fixture/other"); expect(text()).not.toContain("off → on");
  await act(async () => resolve({ homeId: request.home, requestId: request.requestId, policy: { format: "firstmate.feature-policy/1", homeId: request.home,
    revision: 1, ...request.change, updated: { kind: "plugin-ui-unverified", source: "firstmate.features.set", requestId: id, at: "2026-10-29T13:00:00.000Z" } } }));
  expect(text()).not.toContain("Your settings are saved"); expect(state.set).toHaveBeenCalledTimes(1);
});
