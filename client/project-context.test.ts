import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProjectRuntimeSnapshot } from "../shared/project-runtime";
import { attentionTheme as theme } from "../test/attention-deck-fixture";
const state = vi.hoisted(() => ({ data: null as ProjectRuntimeSnapshot | null, calls: [] as string[], recover: vi.fn() }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: (rpc: { name: string }) => async (input: unknown) => {
  state.calls.push(rpc.name);
  if (rpc.name === "firstmate.projects.read") return structuredClone(state.data);
  if (rpc.name.endsWith("recover-ui")) return state.recover(input);
  throw new Error(`Unexpected effect: ${rpc.name}`);
} }));
vi.mock("react-native", () => ({ Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View" }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: () => null, Modal: Object.assign(({ open, children }: { open: boolean; children: ReactNode }) => open ? children : null, { Content: "Content" }) }));
import { ProjectContextBoard, projectReadProblems, projectStatus } from "./project-context";
import { visibleText } from "../test/visible-text";
let renderer: ReactTestRenderer | undefined, cache: QueryClient;
type Project = ProjectRuntimeSnapshot["projects"][number];
const alpha: Project = { name: "Alpha", projectId: "00000000-0000-4000-8000-000000000001", scopeId: "00000000-0000-4000-8000-000000000002", hostId: "local", directory: "C:/Alpha", state: "admitted", reason: null, version: 2, aliases: [],
  agentId: "alpha-supervisor", workspaceId: "workspace", provisionRequestId: null, sessions: 1, turns: 3, uncertain: 0, memoryPending: 0, profile: { provider: "codex/test", modeId: "full-access" }, limits: { supervisorSessions: 1, supervisorTurns: 5 }, plans: [] };
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.calls = []; state.recover.mockReset(); cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  state.data = { enabled: true, homeId: "fixture", registryDigest: "a".repeat(64), sequence: 10, hash: "a".repeat(64), freshness: "current", problems: [],
    general: { agentId: "general", scopeId: null, slots: 4, headroom: 1, providerAvailability: "unknown" }, projects: [structuredClone(alpha)] };
});
afterEach(async () => { await act(async () => renderer?.unmount()); cache.clear(); });
const button = (label: string) => renderer!.root.find(n => n.type === "Pressable" as never && n.props.accessibilityLabel === label);
const text = () => visibleText(renderer!.toJSON());
async function mount() {
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(ProjectContextBoard, { theme, compact: true }))); });
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(done => setTimeout(done, 0)); });
    expect(button("Projects")).toBeDefined();
  }, { timeout: 20000 });
}

it("shows projects as context, with nested technical and plan disclosures and no mate setup", async () => {
  state.data!.projects = ["Ariadne", "firstmate", "Starpath", "blahsec-business"].map((name, i) => ({ ...alpha, name, projectId: `00000000-0000-4000-8000-00000000000${i + 1}`,
    plans: i ? [] : [{ id: "older", title: "Older associated plan", backend: "legacy" as const, state: "Pending migration; project oversight only", projectIds: [], sponsorScopeId: null, ownerScopeId: null }] }));
  state.data!.projects.push(...["Blahsec", "blahsec-site"].map(name => ({ ...alpha, name, state: "held", directory: null, registryLocation: `remote-host:/Projects/${name}`, reason: "A canonical local project directory is required." })));
  state.data!.associationWarnings = Array.from({ length: 60 }, (_, i) => `Plan old-${i} has unresolved project or host membership; no ownership was guessed.`);
  state.data!.problems = [...state.data!.associationWarnings];
  await mount();
  expect(text()).toContain("6 projects · context for plans and Supervisors");
  expect(text()).not.toContain("Ariadne");
  await act(async () => button("Projects").props.onPress());
  let words = text();
  expect(words).toContain("Some older plans aren't linked to a project. No action needed.");
  expect(words).toContain("Admitted"); expect(words).toContain("On another computer (remote-host)");
  expect(words).not.toMatch(/\bmates?\b|Create|Set up|ready to create|Discuss|Open .* conversation/i);
  expect(words).not.toContain("no ownership was guessed"); expect(words).not.toContain("Stored state:");
  await act(async () => button("Show Ariadne details").props.onPress());
  words = text(); expect(words).toContain("Stored state: admitted"); expect(words).toContain("1 plan"); expect(words).not.toContain("Older associated plan");
  await act(async () => button("Ariadne plans: 1").props.onPress());
  expect(text()).toContain("Older associated plan");
  expect(button("Read Ariadne memory")).toBeDefined();
  await act(async () => button("Project technical details").props.onPress());
  expect(text()).toContain("Plan old-59 has unresolved project or host membership");
  expect(state.calls.every(name => name === "firstmate.projects.read")).toBe(true);
});

it("record recovery is the one explicit write, and it reaches the existing recovery RPC", async () => {
  state.data!.recovery = { sequence: 10, hash: "a".repeat(64) } as never;
  state.recover.mockImplementation(async () => { delete state.data!.recovery; return structuredClone(state.data); });
  await mount();
  await act(async () => button("Projects").props.onPress());
  expect(state.recover).not.toHaveBeenCalled();
  await act(async () => button("Recover project records").props.onPress());
  expect(state.recover).toHaveBeenCalledWith({ homeId: "fixture", sequence: 10, hash: "a".repeat(64) });
  expect(state.calls.filter(name => name !== "firstmate.projects.read")).toEqual(["firstmate.projects.recover-ui"]);
});

it("states what the stored record says, never a setup action", () => {
  expect(projectStatus(alpha)).toBe("Admitted");
  expect(projectStatus({ ...alpha, state: "unadmitted", reason: "Awaiting reviewed admission and allocation.", version: 0, agentId: null })).toBe("In the project list");
  expect(projectStatus({ ...alpha, directory: null, state: "held", registryLocation: "ssh://captain@ariadne-dev/home/project" })).toBe("On another computer (ariadne-dev)");
  expect(projectStatus({ ...alpha, directory: null, state: "held", registryLocation: "https://example.test/repository" })).toBe("Repository URL; no local folder recorded");
  expect(projectStatus({ ...alpha, state: "held", reason: "Project directory is unavailable." })).toBe("Folder not found");
  expect(projectStatus({ ...alpha, state: "stopped", reason: null })).toBe("Stopped");
});

it("legacy handoff context is not a failed read, while unknown records remain problems", () => {
  const warning = "Plan remote-reader has unresolved project or host membership; no ownership was guessed.";
  const snapshot = { ...state.data!, freshness: "uninitialized" as const, sequence: 0, hash: null, problems: [warning] };
  expect(projectReadProblems(snapshot)).toEqual([]);
  expect(projectReadProblems({ ...snapshot, freshness: "current", sequence: 5 })).toEqual([warning]);
  expect(projectReadProblems({ ...snapshot, freshness: "current", sequence: 5, associationWarnings: [warning] })).toEqual([]);
  expect(projectReadProblems({ ...snapshot, problems: [warning, "Journal hash mismatch"] })).toEqual(["Journal hash mismatch"]);
});
