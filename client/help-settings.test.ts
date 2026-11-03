import { act, createElement, type ElementType } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { PluginTheme } from "@getpaseo/plugin";
import { FEATURES_OFF, supervisorCapabilities, type FeatureReadResult, type FeatureSetInput } from "../shared/feature-settings";

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
    const policy = { format: "firstmate.feature-policy/2" as const, homeId: input.home, revision: input.expectedRevision + 1, ...input.change,
      updated: { kind: "plugin-ui-unverified" as const, source: "firstmate.features.set" as const, requestId: input.requestId, at: "2026-10-29T13:00:00.000Z" } };
    const fences = supervisorCapabilities(input.change.supervisors);
    snapshot = { ...snapshot, revision: policy.revision, requested: { ...fences }, capacity: input.change.capacity,
      policy, source: "saved", state: "ready", writesAvailable: true, effective: { ...fences }, dependencyRefusals: [] };
    return { homeId: input.home, requestId: input.requestId, policy };
  });
});
afterEach(() => { act(() => renderer?.unmount()); cache.clear(); });

const ALL_ON = supervisorCapabilities(true);
const capacity = { slots: 4, generalHeadroom: 1 };

it("keeps first-update Supervisors off; opening, canceling and details only read", async () => {
  await mount();
  expect(text()).toContain("Supervisors"); expect(text()).toContain("Off");
  expect(text()).not.toMatch(/project mates|plan help/i);
  await press("Turn on Supervisors"); expect(text()).toContain("This save creates no session"); await press("Cancel");
  await press("Set up routine checks"); await press("Back to settings");
  await press("Help details"); await press("Review capacity"); await press("Cancel");
  expect(state.set).not.toHaveBeenCalled(); expect(state.id).not.toHaveBeenCalled(); expect(snapshot.effective).toEqual(FEATURES_OFF);
});

it("saves one Supervisors setting, immediately, without a session or restart, listing each fence it turns on", async () => {
  await mount(); await press("Turn on Supervisors");
  for (const label of ["Project Supervisors: off → on", "Plan execution: off → on", "Routine checks: off → on"]) expect(text()).toContain(label);
  await press("Save help settings");
  expect(state.set).toHaveBeenCalledExactlyOnceWith({ home, expectedRevision: 0, requestId: id, change: { supervisors: true, capacity } });
  expect(text()).toContain("Your settings are saved and applied here."); expect(text()).toContain("Turn off Supervisors");
  expect(() => button("Turn on Supervisors").props).toThrow();
  expect(text()).not.toMatch(/project setup|create a mate/i);
});

it("turns Supervisors on from routine-check setup and reopens it", async () => {
  await mount(); await press("Set up routine checks");
  await vi.waitFor(async () => { await act(async () => { await new Promise(done => setTimeout(done, 0)); }); expect(button("Review routine-check opt-in")).toBeDefined(); });
  await press("Review routine-check opt-in"); await press("Save help settings");
  expect(state.set.mock.calls[0]![0].change).toEqual({ supervisors: true, capacity });
  await vi.waitFor(async () => { await act(async () => { await new Promise(done => setTimeout(done, 0)); }); expect(text()).toContain("Review before anything starts"); });
});

it("shows the daemon's environment switches until saved, and replaces them with one saved setting", async () => {
  snapshot.source = "legacy-environment"; snapshot.requested = { ...ALL_ON }; snapshot.effective = { ...ALL_ON };
  await mount(); expect(text()).toContain("Using the daemon's environment switches"); expect(text()).toContain("On");
  expect(state.set).not.toHaveBeenCalled();
  await press("Save Supervisors setting"); expect(text()).toContain("Supervisors stay on");
  expect(text()).toContain("Saving replaces the daemon's FIRSTMATE_* environment switches");
  await press("Save help settings");
  expect(state.set.mock.calls[0]![0].change).toEqual({ supervisors: true, capacity });
  expect(snapshot.source).toBe("saved"); expect(text()).not.toContain("Using the daemon's environment switches");
});

it("shows a partial pilot as partly on and makes every fence change explicit either way", async () => {
  snapshot.source = "legacy-environment"; snapshot.requested.scopeExecution = true;
  snapshot.dependencyRefusals = [{ capability: "scopeExecution", code: "DEPENDENCY_DISABLED", reason: "Enable conversation controls before sending contextual messages." }];
  await mount(); expect(text()).toContain("Partly on · review setup"); expect(text()).toContain("Contextual sending is paused");
  expect(() => button("Save Supervisors setting").props).toThrow();
  await press("Turn off Supervisors"); expect(text()).toContain("Contextual messages and answers: on → off"); await press("Cancel");
  await press("Turn on Supervisors"); expect(text()).toContain("Project Supervisors: off → on"); expect(text()).not.toContain("Contextual messages and answers:");
  await press("Save help settings"); expect(state.set.mock.calls[0]![0].change).toEqual({ supervisors: true, capacity });
});

it("keeps a failed save's draft and old state, and retries only the original request", async () => {
  state.set.mockRejectedValueOnce(new Error("permission denied"));
  await mount(); await press("Turn on Supervisors"); await press("Save help settings");
  expect(text()).toContain("permission denied"); expect(text()).toContain("Your review is kept"); expect(snapshot.effective).toEqual(FEATURES_OFF);
  const original = copy(state.set.mock.calls[0]![0]);
  await press("Close review"); expect(button("Turn on Supervisors").props.disabled).toBe(true);
  await press("Review saved settings request"); await press("Retry exact settings save");
  expect(state.set.mock.calls[1]![0]).toEqual(original); expect(state.id).toHaveBeenCalledTimes(1);
});

it("can replace a refused request with a fresh read-only review of current settings", async () => {
  state.set.mockRejectedValueOnce(new Error("Feature settings changed in another client"));
  await mount(); await press("Turn on Supervisors"); await press("Save help settings");
  snapshot.revision = 1;
  await press("Review current setup"); expect(state.set).toHaveBeenCalledTimes(1);
  await press("Turn on Supervisors"); expect(button("Save help settings").props.disabled).toBe(false);
  await press("Cancel"); expect(state.set).toHaveBeenCalledTimes(1);
});

it("holds duplicate confirm while a save is in flight", async () => {
  let reject!: (e: Error) => void;
  state.set.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  await mount(); await press("Turn on Supervisors");
  const save = button("Save help settings").props.onPress;
  await act(async () => { save(); save(); });
  expect(state.set).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("lost reply")));
  expect(button("Retry exact settings save")).toBeDefined();
});

it("checks a lost reply through a read without issuing another save", async () => {
  const save = state.set.getMockImplementation()!;
  state.set.mockImplementationOnce(async input => { await save(input); throw new Error("lost reply"); });
  await mount(); await press("Turn on Supervisors"); await press("Save help settings");
  await press("Check saved settings"); expect(state.set).toHaveBeenCalledTimes(1); expect(text()).toContain("Your settings are saved and applied here.");
});

it("refuses a stale two-client review and retains it for comparison", async () => {
  await mount(); await press("Turn on Supervisors"); snapshot.revision = 1;
  await update(); expect(text()).toContain("Settings changed while this review was open"); expect(button("Save help settings").props.disabled).toBe(true);
  await press("Cancel"); await press("Turn on Supervisors"); await press("Save help settings");
  expect(state.set.mock.calls[0]![0].expectedRevision).toBe(1);
});

it("rereads after save rather than accepting a background read begun before it", async () => {
  await mount(); await press("Turn on Supervisors");
  let finishOld!: (s: FeatureReadResult) => void;
  const old = copy(snapshot);
  state.read.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  await act(async () => { void cache.invalidateQueries({ queryKey: FEATURE_SETTINGS_QUERY_KEY }); });
  await press("Save help settings");
  expect(text()).toContain("Your settings are saved and applied here.");
  await act(async () => finishOld(old));
  expect(button("Turn off Supervisors")).toBeDefined();
  expect(cache.getQueryData<FeatureReadResult>([...FEATURE_SETTINGS_QUERY_KEY, "local", home])?.revision).toBe(1);
});

it("reviews turn-off with overlapping lower bounds, unknown coverage and honest pause semantics", async () => {
  snapshot.requested = { ...ALL_ON }; snapshot.effective = { ...ALL_ON };
  snapshot.inventory = { ...snapshot.inventory, active: 2, pending: 3, uncertain: 2 };
  await mount(); await press("Turn off Supervisors");
  for (const value of ["Active Supervisors: at least 2", "Pending operations: at least 3", "Uncertain operations: at least 2", "can overlap", "Calls already in flight can finish", "does not delete Supervisors"]) expect(text()).toContain(value);
  await press("Save help settings"); expect(state.set.mock.calls[0]![0].change).toEqual({ supervisors: false, capacity });
  expect(snapshot.effective).toEqual(FEATURES_OFF);
});

it("requires a separate capacity review; never raises capacity while turning Supervisors on", async () => {
  await mount(); await press("Help details"); await press("Review capacity");
  await act(async () => { renderer!.root.findByProps({ accessibilityLabel: "Plugin slots" }).props.onChangeText("6"); });
  expect(text()).toContain("Proposed: "); expect(text()).toContain("may increase spending");
  await press("Save help settings"); expect(snapshot.capacity).toEqual({ slots: 6, generalHeadroom: 1 }); expect(snapshot.requested).toEqual(FEATURES_OFF);
  await press("Turn on Supervisors"); await press("Save help settings");
  expect(state.set.mock.calls[1]![0].change).toEqual({ supervisors: true, capacity: { slots: 6, generalHeadroom: 1 } });
});

it("holds damaged policy and read/permission failures without inventing applied state", async () => {
  snapshot.state = "held"; snapshot.revision = null; snapshot.writesAvailable = false; snapshot.capacity = null;
  await mount(); expect(button("Turn on Supervisors").props.disabled).toBe(true); expect(text()).toContain("review Supervisors");
  state.read.mockRejectedValue(new Error("permission denied")); await update();
  expect(text()).toContain("Can't read help settings right now"); expect(state.set).not.toHaveBeenCalled();
});

it("can explicitly repair invalid legacy capacity, showing any fence the one setting changes", async () => {
  snapshot.source = "legacy-environment"; snapshot.capacity = null; snapshot.state = "held"; snapshot.writesAvailable = false; snapshot.requested.scopeUi = true;
  await mount(); await press("Review capacity"); expect(button("Save help settings").props.disabled).toBe(true);
  expect(text()).toContain("Contextual conversation controls: on → off");
  await act(async () => {
    renderer!.root.findByProps({ accessibilityLabel: "Plugin slots" }).props.onChangeText("4");
  });
  await act(async () => { renderer!.root.findByProps({ accessibilityLabel: "Slots reserved for FirstMate" }).props.onChangeText("1"); });
  await press("Save help settings"); expect(state.set.mock.calls[0]![0].change).toEqual({ supervisors: false, capacity });
});

it("unmounts an old host/home review and ignores its delayed result", async () => {
  let resolve!: (v: unknown) => void;
  state.set.mockImplementation(() => new Promise(done => { resolve = done; }));
  await mount(); await press("Turn on Supervisors"); await press("Save help settings");
  const request = state.set.mock.calls[0]![0];
  await act(async () => { renderer!.unmount(); }); snapshot = { ...snapshot, homeId: "C:/fixture/other" };
  await mount("remote", "C:/fixture/other"); expect(text()).not.toContain("off → on");
  await act(async () => resolve({ homeId: request.home, requestId: request.requestId, policy: { format: "firstmate.feature-policy/2", homeId: request.home,
    revision: 1, ...request.change, updated: { kind: "plugin-ui-unverified", source: "firstmate.features.set", requestId: id, at: "2026-10-29T13:00:00.000Z" } } }));
  expect(text()).not.toContain("Your settings are saved"); expect(state.set).toHaveBeenCalledTimes(1);
});
