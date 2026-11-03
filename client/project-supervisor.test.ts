import { createElement, type ReactElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProjectRuntimeSnapshot } from "../shared/project-runtime";
import { attentionTheme as theme } from "../test/attention-deck-fixture";
import { visibleText } from "../test/visible-text";
const state = vi.hoisted(() => ({ calls: [] as { name: string; input: unknown }[], provision: vi.fn(), folder: vi.fn(), ids: 0 }));
vi.mock("react-native", () => ({ Pressable: "Pressable", Text: "Text", View: "View" }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: (rpc: { name: string }) => async (input: unknown) => {
  state.calls.push({ name: rpc.name, input: structuredClone(input) });
  if (rpc.name === "firstmate.mate.targets") return { targets: [{ provider: "codex/test", label: "Test", modes: [{ id: "full-access", label: "Full access" }], thinking: [] }] };
  if (rpc.name === "firstmate.projects.provision-ui") return state.provision(input);
  if (rpc.name === "firstmate.projects.folder") return state.folder(input);
  if (rpc.name === "firstmate.projects.abort-ui") return data;
  throw new Error(`Unexpected effect: ${rpc.name}`);
} }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ TextInput: "TextInput", Modal: Object.assign(({ open, children }: { open: boolean; children: ReactNode }) => open ? children : null, { Content: "Content" }) }));
vi.mock("./supervisor-profile", () => ({ SupervisorProfileFields: "SupervisorProfileFields" }));
vi.mock("./workflow-plans", () => ({ workflowRequestId: () => `00000000-0000-4000-8000-${String(++state.ids).padStart(12, "0")}` }));
import { AddProjectFolder, ProjectSupervisorAdd } from "./project-supervisor";
type Project = ProjectRuntimeSnapshot["projects"][number];
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const project = (name: string, n: number, extra: Partial<Project> = {}): Project => ({ name, projectId: id(100 + n), scopeId: id(200 + n), hostId: "local", directory: `C:/${name}`, state: "admitted", reason: null, version: 2, aliases: [],
  agentId: null, workspaceId: null, provisionRequestId: null, sessions: 0, turns: 0, uncertain: 0, memoryPending: 0, profile: { provider: "codex/test", modeId: "full-access" },
  limits: { supervisorSessions: 1, supervisorTurns: 5 }, plans: [], ...extra });
let renderer: ReactTestRenderer | undefined, cache: QueryClient, data: ProjectRuntimeSnapshot;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.calls = []; state.ids = 0; state.provision.mockReset(); state.folder.mockReset();
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  data = { enabled: true, homeId: "fixture", registryDigest: "a".repeat(64), sequence: 3, hash: "b".repeat(64), freshness: "current", problems: [],
    general: { agentId: "general", scopeId: null, slots: 4, headroom: 1, providerAvailability: "unknown" },
    projects: [project("Ariadne", 1, { agentId: "ariadne-supervisor", sessions: 1, turns: 1 }), project("Starpath", 2), project("paseo", 3, { state: "unadmitted", version: 0, profile: null, limits: null })] };
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; cache.clear(); });
const onRead = vi.fn();
async function mount(element: ReactElement = createElement(ProjectSupervisorAdd, { theme, compact: true, data, stale: false, onRead })) {
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, element)); });
  await act(async () => { await new Promise(done => setTimeout(done, 10)); });
}
const button = (label: string) => renderer!.root.find(n => n.type === "Pressable" as never && n.props.accessibilityLabel === label);
const press = (label: string) => act(async () => { await button(label).props.onPress(); await new Promise(done => setTimeout(done, 10)); });
const input = (label: string) => renderer!.root.find(n => n.type === "TextInput" as never && n.props.accessibilityLabel === label);
const text = () => visibleText(renderer!.toJSON());
const effects = () => state.calls.filter(c => c.name !== "firstmate.mate.targets");

it("offers only admitted projects without a Supervisor, and opening the review starts no work", async () => {
  await mount();
  await press("Add project Supervisor");
  expect(renderer!.root.findAllByProps({ testID: "project-supervisor-review" })).toHaveLength(1);
  expect(renderer!.root.findAll(n => n.type === "Pressable" as never && /^(Ariadne|paseo)/.test(n.props.accessibilityLabel ?? ""))).toHaveLength(0);
  expect(button("Starpath (selected)")).toBeDefined();
  expect(text()).toContain("up to 5, the project's allocation");
  expect(effects()).toEqual([]);
});

it("sends the reviewed profile, caps and opening once; a lost reply retries the exact request", async () => {
  await mount(); await press("Add project Supervisor");
  await act(async () => input("Cumulative turn limit").props.onChangeText("6"));
  expect(button("Add Supervisor for Starpath").props.disabled).toBe(true);
  await act(async () => input("Cumulative turn limit").props.onChangeText("3"));
  await act(async () => input("Opening for this project Supervisor").props.onChangeText("  Watch Starpath releases.  "));
  state.provision.mockRejectedValueOnce(new Error("Connection lost"));
  await press("Add Supervisor for Starpath");
  const sent = effects().map(c => c.input);
  expect(sent).toEqual([{ homeId: "fixture", requestId: id(1), projectId: id(102), projectVersion: 2, profile: { provider: "codex/test", modeId: "full-access" },
    limits: { supervisorSessions: 1, supervisorTurns: 3 }, opening: "Watch Starpath releases." }]);
  expect(text()).toContain("The exact request is kept");
  const done = structuredClone(data); done.projects[1] = { ...done.projects[1]!, agentId: "starpath-supervisor" };
  state.provision.mockResolvedValueOnce(done);
  await press("Retry this exact request");
  expect(effects().map(c => c.input)).toEqual([sent[0], sent[0]]);
  expect(renderer!.root.findAllByProps({ testID: "project-supervisor-review" })).toHaveLength(0);
  expect(onRead).toHaveBeenCalled();
});

it("resumes a saved request with its original input and never mints a new one", async () => {
  const saved = { homeId: "fixture", requestId: id(77), projectId: id(102), projectVersion: 2, profile: { provider: "codex/test", modeId: "full-access" } };
  data.projects[1] = { ...data.projects[1]!, provisionInput: saved, provisionRequestId: id(77), reason: "Provisioning incomplete; inspect and resume the recorded request." };
  state.provision.mockResolvedValue(data);
  await mount();
  expect(button("Add project Supervisor").props.disabled).toBe(true);
  await press("Resume Starpath Supervisor setup");
  await press("Retry this exact request");
  expect(effects().map(c => c.input)).toEqual([saved]);
  await press("Stop this setup");
  expect(effects().at(-1)).toEqual({ name: "firstmate.projects.abort-ui", input: { homeId: "fixture", projectId: id(102), projectVersion: 2, provisionRequestId: id(77) } });
});

it("points to settings while project help is off, and holds actions on stale records", async () => {
  data.enabled = false; await mount();
  expect(text()).toContain("Turn on project help in FirstMate settings");
  expect(renderer!.root.findAll(n => n.type === "Pressable" as never)).toHaveLength(0);
  await act(async () => renderer!.unmount());
  data.enabled = true;
  await mount(createElement(ProjectSupervisorAdd, { theme, compact: true, data, stale: true, onRead }));
  expect(button("Add project Supervisor").props.disabled).toBe(true);
});

it("Add project validates the name and records only a folder mapping", async () => {
  state.folder.mockResolvedValue(data);
  await mount(createElement(AddProjectFolder, { theme, data, onRead }));
  await act(async () => input("New project name").props.onChangeText("bad name"));
  expect(button("Choose folder and add project").props.disabled).toBe(true);
  await act(async () => input("New project name").props.onChangeText("orion"));
  await press("Choose folder and add project");
  expect(effects()).toEqual([{ name: "firstmate.projects.folder", input: { homeId: "fixture", registryDigest: "a".repeat(64), name: "orion" } }]);
});
