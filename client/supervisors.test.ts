import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { attentionTheme as theme } from "../test/attention-deck-fixture";
import { visibleText } from "../test/visible-text";
const plan = "00000000-0000-4000-8000-000000000011", project = "00000000-0000-4000-8000-000000000012", checks = "00000000-0000-4000-8000-000000000013";
const state = vi.hoisted(() => ({ activation: undefined as any, refreshActivation: vi.fn(), list: {} as any, projects: {} as any, checks: {} as any, watches: {} as any, calls: [] as string[], hold: null as Promise<void> | null, fail: false }));
vi.mock("react-native", () => ({ Pressable: "Pressable", Text: "Text", View: "View" }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: (rpc: { name: string }) => async () => {
  state.calls.push(rpc.name);
  await state.hold;
  if (state.fail) throw new Error("read unavailable");
  if (rpc.name === "firstmate.supervisors.read") return structuredClone(state.list);
  if (rpc.name === "firstmate.projects.read") return structuredClone(state.projects);
  if (rpc.name === "firstmate.maintenance.read") return structuredClone(state.checks);
  if (rpc.name === "firstmate.watch.supervisors.read") return structuredClone(state.watches);
  throw new Error(`Unexpected effect: ${rpc.name}`);
} }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: () => null, Modal: Object.assign(({ open, children }: { open: boolean; children: ReactNode }) => open ? children : null, { Content: "Content" }) }));
vi.mock("./project-context", async importOriginal => ({ ...await importOriginal<typeof import("./project-context")>(), ProjectContextBoard: "ProjectContextBoard" }));
// The assignment's own strict shape is pinned by watch-supervisors tests; here only its target scope matters.
vi.mock("../shared/watch-routing", async importOriginal => ({ ...await importOriginal<typeof import("../shared/watch-routing")>(), WatchSupervisorSnapshotSchema: { parse: (value: unknown) => value } }));
vi.mock("./project-supervisor", () => ({ ProjectSupervisorAdd: "ProjectSupervisorAdd", AddProjectFolder: "AddProjectFolder" }));
vi.mock("./maintenance-ownership", () => ({ MaintenanceOwnershipBoard: "MaintenanceOwnershipBoard" }));
vi.mock("./supervision-activation", () => ({ SupervisionActivationBoard: "SupervisionActivationBoard" }));
vi.mock("./workflow-plans", () => ({ useWorkflowPlans: () => ({ activation: state.activation, activationError: null, refreshActivation: state.refreshActivation }) }));
vi.mock("./supervisor-controls", () => ({ SupervisorControlsButton: "SupervisorControlsButton" }));
vi.mock("./watch-supervisors", () => ({ WatchSupervisorButton: "WatchSupervisorButton" }));
import { SupervisorsEntry } from "./supervisors";
let renderer: ReactTestRenderer | undefined, cache: QueryClient;
const row = (scopeId: string, kind: string, title: string, extra = {}) => ({ scopeId, kind, title, planId: kind === "plan" ? "reader" : null, state: "active", agentId: `${title}-agent`, epoch: 1,
  profile: { provider: "codex/gpt-6.1-sol", modeId: "full-access", thinkingOptionId: "high" }, sessions: 1, turns: 4, limits: { supervisorSessions: 2, supervisorTurns: 20 }, lastFailure: null, ...extra });
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.calls = []; state.hold = null; state.fail = false; state.refreshActivation.mockReset();
  state.activation = { enabled: true, homeId: "fixture", problems: [], plans: [], audits: [], migrations: [], dispositions: [] };
  state.list = { homeId: "fixture", rows: [], problems: [] };
  state.projects = { enabled: true, homeId: "fixture", registryDigest: null, sequence: 0, hash: null, freshness: "uninitialized", problems: [],
    general: { agentId: null, scopeId: null, slots: 4, headroom: 1, providerAvailability: "unknown" }, projects: [] };
  state.checks = { enabled: true, homeId: "fixture", sequence: 0, freshness: "uninitialized", lowerBound: false, problems: [],
    cleanup: { state: "held", reason: "G8", conditions: [] }, jobs: [], occurrences: [], hosts: [], incidents: [], reservations: [], owners: [], deliveries: [], captainDecisions: [], decisions: [], outbox: [] };
  state.watches = { homeId: "fixture", watches: [], targets: [], owners: [], problems: [], observer: { enabled: false, reason: "Unavailable" } };
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => { await act(async () => renderer?.unmount()); cache.clear(); });
const tree = (always = false, navigation?: { openAgent: (input: object) => void }) => createElement(QueryClientProvider, { client: cache }, createElement(SupervisorsEntry, { theme, compact: true, always, ...(navigation ? { navigation: navigation as never } : {}) }));
async function mount(always = false, navigation?: { openAgent: (input: object) => void }) {
  await act(async () => { renderer = create(tree(always, navigation)); });
  await settle();
}
async function settle() { await vi.waitFor(async () => { await act(async () => { await new Promise(done => setTimeout(done, 10)); }); expect(cache.isFetching()).toBe(0); }); }
const text = () => visibleText(renderer!.toJSON());
const press = (label: string) => act(async () => renderer!.root.find(n => n.type === "Pressable" as never && n.props.accessibilityLabel === label).props.onPress());

it("an empty home uses no main-screen space, while settings keeps a Supervisors entry; reading writes nothing", async () => {
  await mount(); expect(renderer!.toJSON()).toBe(null);
  await act(async () => renderer!.unmount()); await mount(true);
  expect(text()).toContain("Supervisors"); expect(text()).not.toMatch(/Work details|project mates/i);
  await press("Supervisors"); await settle();
  expect(text()).toContain("No Supervisors yet.");
  expect(state.calls.length).toBeGreaterThan(0); expect(state.calls.every(name => name.endsWith(".read"))).toBe(true);
});

it("lists plan, project and routine-check Supervisors with their kind, state, profile, usage and failure; opening starts no work", async () => {
  state.list.rows = [row(plan, "plan", "Reader pass"), row(project, "project", "Ariadne", { state: "paused" }),
    row(checks, "maintenance", "Storage checks", { lastFailure: "agent.send failed", limits: null })];
  state.watches.watches = [{ name: "pr-watch", definitionDigest: "a".repeat(64), assignment: { stage: "committed", target: { scopeId: plan } } }];
  await mount();
  const entry = renderer!.root.findByProps({ testID: "supervisors-entry" });
  expect(entry).toBeDefined(); expect(text()).not.toMatch(/\d/);
  await press("Supervisors"); await settle();
  const body = text();
  expect(renderer!.root.findAllByProps({ testID: "supervisor-row" })).toHaveLength(3);
  expect(body).toContain("Plan · fed by pr-watch · Active");
  expect(body).toContain("Project · Paused");
  expect(body).toContain("Routine checks · Active");
  expect(body).toContain("codex/gpt-6.1-sol · full-access · reasoning high");
  expect(body).toContain("Used 1 of 2 sessions · 4 of 20 turns");
  expect(body).toContain("Used 1 session · 4 turns");
  expect(body).toContain("Last failure: agent.send failed");
  expect(body).not.toMatch(/Project mates|Create .* mate|Set up a mate|Mate active/);
  expect(renderer!.root.findAllByType("SupervisorControlsButton" as never).map(b => b.props.scopeId)).toEqual([plan, project, checks]);
  expect(renderer!.root.findByType("MaintenanceOwnershipBoard" as never).props.listed).toBe(true);
  expect(renderer!.root.findAllByType("ProjectContextBoard" as never)).toHaveLength(1);
  // A project Supervisor is added here, from the project records, like routine checks.
  expect(renderer!.root.findByType("ProjectSupervisorAdd" as never).props.data.homeId).toBe("fixture");
  expect(state.calls.every(name => name.endsWith(".read"))).toBe(true);
});

it("opens an exact native session and closes the list", async () => {
  state.list.rows = [row(plan, "plan", "Reader pass")];
  const openAgent = vi.fn();
  await mount(false, { openAgent });
  await press("Supervisors"); await settle();
  await press("Open Reader pass native session");
  expect(openAgent).toHaveBeenCalledWith({ agentId: "Reader pass-agent" });
  expect(renderer!.root.findAllByProps({ testID: "supervisor-list" })).toHaveLength(0);
});

it("cold read failure stays visible even with no saved inventory", async () => {
  state.fail = true; await mount();
  expect(text()).toContain("Supervisors");
  await press("Supervisors"); await settle();
  expect(text()).toContain("Supervisors couldn't be loaded");
});

it("refreshing is silent and keeps its ordinary button label", async () => {
  await mount(true); await press("Supervisors"); await settle();
  let release!: () => void; state.hold = new Promise<void>(done => { release = done; });
  try {
    await press("Refresh Supervisors");
    expect(cache.isFetching()).toBeGreaterThan(0);
    expect(text()).toContain("Refresh Supervisors"); expect(text()).not.toMatch(/Refreshing|Updating/);
  } finally { await act(async () => { release(); state.hold = null; await new Promise(done => setTimeout(done, 0)); }); }
});

it("first recovered metadata keeps the list open; a changed known home closes it", async () => {
  state.fail = true; await mount(true);
  await press("Supervisors");
  state.fail = false; await act(async () => { await cache.refetchQueries(); }); await settle();
  expect(renderer!.root.findAllByProps({ testID: "supervisor-list" })).toHaveLength(1);
  state.list.homeId = "another-home"; state.projects.homeId = "another-home"; state.checks.homeId = "another-home";
  await act(async () => { await cache.refetchQueries(); }); await settle();
  expect(renderer!.root.findAllByProps({ testID: "supervisor-list" })).toHaveLength(0);
});

it("the narrow desktop header shows only the icon, keeping Supervisors as the accessible name", async () => {
  state.list.rows = [row(plan, "plan", "Reader pass")];
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(SupervisorsEntry, { theme, compact: true, iconOnly: true }))); });
  await settle();
  expect(text()).not.toContain("Supervisors");
  expect(renderer!.root.find(n => n.type === "Pressable" as never && n.props.accessibilityLabel === "Supervisors")).toBeDefined();
});

it("a prepared plan handover keeps its recovery reachable: the entry shows, opening refreshes plan help, and the board mounts", async () => {
  state.activation.migrations = [{ id: "00000000-0000-4000-8000-000000000021", planId: "reader", state: "prepared" }];
  await mount();
  expect(renderer!.root.findByProps({ testID: "supervisors-entry" })).toBeDefined();
  await press("Supervisors"); await settle();
  expect(state.refreshActivation).toHaveBeenCalled();
  const board = renderer!.root.findByType("SupervisionActivationBoard" as never);
  expect(board.props.advanced).toBe(true); expect(board.props.assignWatches).toBe(false);
  expect(state.calls.every(name => name.endsWith(".read"))).toBe(true);
});
