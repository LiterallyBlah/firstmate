import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ProjectRuntime, registerProjectRuntime } from "../server/project-runtime";
import { SyntheticReceiver } from "../test/synthetic-receiver";
import { projectRuntimeFixture } from "../test/project-runtime-fixture";
import { updateFirstmateConfig } from "../server/config";
import type { PaseoApi } from "../server/host-types";
import type { ProjectRuntimeSnapshot } from "../shared/project-runtime";
import { attentionTheme as theme } from "../test/attention-deck-fixture";
const state = vi.hoisted(() => ({ data: null as ProjectRuntimeSnapshot | null, read: vi.fn(), provision: vi.fn(), recover: vi.fn(), abort: vi.fn(), discuss: vi.fn(), canDiscuss: false }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: (rpc: { name: string }) => rpc.name.endsWith("provision-ui") ? state.provision : rpc.name.endsWith("recover-ui") ? state.recover : rpc.name.endsWith("abort-ui") ? state.abort : state.read }));
vi.mock("react-native", () => ({ Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View" }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: () => null, Modal: Object.assign(({ open, children }: { open: boolean; children: ReactNode }) => open ? children : null, { Content: "Content" }) }));
vi.mock("./workflow-plans", () => ({ useWorkflowPlans: () => ({ discussScope: state.discuss, canDiscussScope: () => state.canDiscuss }), workflowRequestId: () => "00000000-0000-4000-8000-000000000099" }));
import { ProjectOwnershipBoard } from "./project-ownership";
import { visibleText } from "../test/visible-text";
let renderer: ReactTestRenderer | undefined, cache: QueryClient;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); state.discuss.mockReset(); state.canDiscuss = false; cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  state.data = { enabled: true, homeId: "fixture", registryDigest: "a".repeat(64), sequence: 10, hash: "a".repeat(64), freshness: "current", problems: [],
    general: { agentId: "general", scopeId: null, slots: 4, headroom: 1, providerAvailability: "unknown" }, projects: [{ name: "Alpha", projectId: "00000000-0000-4000-8000-000000000001", scopeId: "00000000-0000-4000-8000-000000000002", hostId: "local", directory: "C:/Alpha", state: "admitted", reason: null, version: 2, aliases: [], agentId: null, workspaceId: null, provisionRequestId: null,
      sessions: 0, turns: 0, uncertain: 0, memoryPending: 0, profile: { provider: "codex/test", modeId: "full-access" }, limits: { supervisorSessions: 1, supervisorTurns: 5 }, plans: [] }] };
  state.read.mockImplementation(async () => structuredClone(state.data));
});
afterEach(async () => { await act(async () => renderer?.unmount()); cache.clear(); });
const button = (label: string) => renderer!.root.find(n => n.type === "Pressable" as never && n.props.accessibilityLabel === label);
async function mount(extra: Partial<Parameters<typeof ProjectOwnershipBoard>[0]> = {}) {
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(ProjectOwnershipBoard, { theme, compact: true, ...extra }))); });
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(done => setTimeout(done, 0)); });
    expect(button("Project mates and plans")).toBeDefined();
  }, { timeout: 20000 });
}
it("keeps the live-shaped project inventory compact, with nested technical and plan disclosures", async () => {
  const original = state.data!.projects[0]!;
  state.data!.projects = ["Ariadne", "firstmate", "Starpath", "blahsec-business"].map((name, i) => ({ ...original, name, projectId: `00000000-0000-4000-8000-00000000000${i + 1}`, plans: i ? [] : [{ id: "older", title: "Older associated plan", backend: "legacy" as const, state: "Pending migration; project oversight only", projectIds: [original.projectId!], sponsorScopeId: null, ownerScopeId: null }] }));
  state.data!.projects.push(...["Blahsec", "blahsec-site"].map(name => ({ ...original, name, state: "held", directory: null, registryLocation: `remote-host:/Projects/${name}`, reason: "A canonical local project directory is required." })));
  state.data!.associationWarnings = Array.from({ length: 60 }, (_, i) => `Plan old-${i} has unresolved project or host membership; no ownership was guessed.`);
  state.data!.problems = [...state.data!.associationWarnings];
  await mount({ advanced: true });
  expect(visibleText(renderer!.toJSON())).toContain("4 ready to create · 2 on another machine");
  expect(visibleText(renderer!.toJSON())).not.toContain("Ariadne");
  await act(async () => button("Project mates and plans").props.onPress());
  let words = visibleText(renderer!.toJSON());
  expect(words).toContain("Some older plans aren't linked to a project. No action needed.");
  expect(words).not.toContain("no ownership was guessed"); expect(words).not.toContain("Stored state:"); expect(words).not.toContain("Older associated plan");
  expect(button("Create Ariadne mate").props.disabled).toBe(false);
  await act(async () => button("Show Ariadne details").props.onPress());
  words = visibleText(renderer!.toJSON()); expect(words).toContain("Stored state: admitted"); expect(words).toContain("1 plan"); expect(words).not.toContain("Older associated plan");
  await act(async () => button("Ariadne plans: 1").props.onPress());
  expect(visibleText(renderer!.toJSON())).toContain("Older associated plan");
  await act(async () => button("Project technical details").props.onPress());
  expect(visibleText(renderer!.toJSON())).toContain("Plan old-59 has unresolved project or host membership");
  expect(state.provision).not.toHaveBeenCalled(); expect(state.recover).not.toHaveBeenCalled(); expect(state.abort).not.toHaveBeenCalled();
});
it("opening, reading and remounting creates no session; explicit confirmation retains the request after uncertainty", async () => {
  state.provision.mockRejectedValue(new Error("reply lost")); await mount();
  await act(async () => button("Project mates and plans").props.onPress());
  expect(state.provision).not.toHaveBeenCalled();
  await act(async () => button("Create Alpha mate").props.onPress()); expect(state.provision).not.toHaveBeenCalled();
  await act(async () => { const press = button("Create project mate").props.onPress; press(); press(); });
  expect(state.provision).toHaveBeenCalledTimes(1);
  await act(async () => button("Resume recorded request").props.onPress());
  expect(state.provision.mock.calls[0]![0]).toEqual(state.provision.mock.calls[1]![0]);
});
it("a failed refresh disables a pending explicit confirmation", async () => {
  await mount(); await act(async () => button("Project mates and plans").props.onPress());
  await act(async () => button("Create Alpha mate").props.onPress());
  state.read.mockRejectedValue(new Error("offline"));
  await act(async () => { await cache.refetchQueries(); });
  await act(async () => { await new Promise(done => setTimeout(done, 20)); });
  expect(button("Create project mate").props.disabled).toBe(true); expect(state.provision).not.toHaveBeenCalled();
});
it("feature-off history keeps a stopped project without an agent inspectable", async () => {
  state.data!.enabled = false;
  Object.assign(state.data!.projects[0]!, { state: "stopped", sessions: 1, turns: 1, uncertain: 1,
    reason: "Provisioning stopped; identity and spend retained. Inspect any uncertain operation." });
  await mount();
  await act(async () => button("Project mates and plans").props.onPress());
  await act(async () => button("Show Alpha details").props.onPress());
  expect(visibleText(renderer!.toJSON())).toContain("saved mate and spending are kept");
  expect(state.provision).not.toHaveBeenCalled(); expect(state.abort).not.toHaveBeenCalled();
});
it("F1: dismisses details after a checked discussion route and keeps it open if eligibility changed", async () => {
  const order: string[] = [], onNavigate = vi.fn(() => order.push("dismiss"));
  state.canDiscuss = true; state.discuss.mockImplementation(() => order.push("discuss"));
  await mount({ onNavigate }); await act(async () => button("Project mates and plans").props.onPress());
  await act(async () => button("Show Alpha details").props.onPress());
  const discuss = button("Discuss Alpha scope").props.onPress;
  state.canDiscuss = false;
  await act(async () => discuss());
  expect(state.discuss).not.toHaveBeenCalled(); expect(onNavigate).not.toHaveBeenCalled();
  state.canDiscuss = true;
  await act(async () => discuss());
  expect(state.discuss).toHaveBeenCalledExactlyOnceWith(state.data!.projects[0]!.scopeId, "fixture");
  expect(order).toEqual(["discuss", "dismiss"]);
  expect(state.provision).not.toHaveBeenCalled(); expect(state.recover).not.toHaveBeenCalled(); expect(state.abort).not.toHaveBeenCalled();
});
it("F1: native conversation navigation preserves the host and agent before dismissing details", async () => {
  Object.assign(state.data!.projects[0]!, { agentId: "recorded-agent", workspaceId: "recorded-workspace" });
  const order: string[] = [], openAgent = vi.fn(() => order.push("open")), onNavigate = vi.fn(() => order.push("dismiss"));
  await mount({ hostId: "other-host", navigation: { openAgent, openWorkspace: vi.fn() }, onNavigate });
  await act(async () => button("Project mates and plans").props.onPress());
  await act(async () => button("Open Alpha conversation").props.onPress());
  expect(openAgent).toHaveBeenCalledExactlyOnceWith({ agentId: "recorded-agent", serverId: "other-host" });
  expect(order).toEqual(["open", "dismiss"]); expect(state.provision).not.toHaveBeenCalled();
});
it("shows concrete per-project blockers and opens the shared setup for the ready project without provisioning", async () => {
  const ready = { ...state.data!.projects[0]!, name: "Starpath", state: "unadmitted", version: 0, profile: null, limits: null, reason: "Awaiting reviewed admission and allocation." };
  const remote = { ...ready, name: "Ariadne", projectId: null, scopeId: null, hostId: null, directory: null, registryLocation: "ariadne-dev:/home/ariadne/Projects/Aradne", state: "held", reason: "A canonical local project directory is required; URLs and remote locations need explicit mapping." };
  const missing = { ...remote, name: "FirstMate", registryLocation: "C:/Projects/firstmate (clone of https://example.test/repository)", reason: "Project directory is unavailable; identity was not guessed." };
  state.data!.projects = [remote, missing, ready]; state.data!.freshness = "uninitialized"; state.data!.sequence = 0; state.data!.hash = null;
  state.data!.problems = ["Plan old-plan has unresolved project or host membership; no ownership was guessed."];
  const onSetup = vi.fn(); await mount({ advanced: true, onSetup });
  expect(button("Project mates and plans").props.accessibilityState.expanded).toBe(false);
  await act(async () => button("Project mates and plans").props.onPress());
  await act(async () => button("Show Ariadne details").props.onPress());
  expect(visibleText(renderer!.toJSON())).toContain("another computer (ariadne-dev)");
  await act(async () => button("Show FirstMate details").props.onPress());
  const words = visibleText(renderer!.toJSON());
  expect(words).toContain("On another machine");
  expect(words).toContain("Folder not found: C:/Projects/firstmate"); expect(words).toContain("clone note");
  expect(words).not.toContain("need review"); expect(words).not.toContain("couldn't be checked"); expect(words).not.toContain("refresh before continuing");
  expect(button("Set up a mate for Starpath").props.disabled).toBe(false);
  await act(async () => button("Set up a mate for Starpath").props.onPress());
  expect(onSetup).toHaveBeenCalledExactlyOnceWith(ready); expect(state.provision).not.toHaveBeenCalled();
});

it.each(["mounted", "remounted", "stop"])("review F2: %s app repairs through the production RPC and resumes the same recorded input", async mode => {
  const previousHome = process.env.PASEO_HOME!, root = join(previousHome, randomUUID()), home = join(root, "home"), data = join(root, "data"), text = "Reviewed Alpha allocation.\n";
  process.env.PASEO_HOME = root;
  await mkdir(join(home, "data"), { recursive: true }); await mkdir(join(home, "Alpha"));
  await writeFile(join(home, "data/projects.md"), `- Alpha [reviewed] - ${join(home, "Alpha")} - fixture\n`);
  await writeFile(join(home, "data/orders.md"), text);
  await updateFirstmateConfig({ home, mateAgentId: "", migration: null, mateLaunch: null }); await updateFirstmateConfig({ mateAgentId: "general" });
  const receiver = new SyntheticReceiver(), api = {} as PaseoApi;
  let armed = false;
  const runtime = projectRuntimeFixture(data, { boundary: async name => {
    if (armed && name === "publication:linked") { armed = false; throw Error("review F2 interrupted checkpoint"); }
  } });
  const service = new ProjectRuntime(runtime, { enabled: true, receiver: () => receiver });
  const handlers = new Map<string, (input: any, context?: any) => Promise<any>>();
  registerProjectRuntime({ handle: ((rpc: { name: string }, handler: any) => handlers.set(rpc.name, handler)) as never }, service);
  const call = (name: string, input: unknown) => handlers.get(`firstmate.projects.${name}`)!(input, { paseo: api });
  state.read.mockImplementation(() => call("read", {})); state.provision.mockImplementation(input => call("provision-ui", input));
  state.recover.mockImplementation(input => call("recover-ui", input)); state.abort.mockImplementation(input => call("abort-ui", input));
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  try {
    const read = await service.read();
    await service.admin({ homeId: read.homeId, requestId: randomUUID(), actorId: "general", command: { op: "admit", name: "Alpha", aliases: [], registryDigest: read.registryDigest!,
      source: { id: randomUUID(), version: 1, path: "data/orders.md", lineStart: 1, lineEnd: 1, fileHash: sha(text), excerptHash: sha(text.trim()),
        provenance: { kind: "mate-chat", id: "general", source: "project administration (same-user role convention, unverified)" }, supersedes: [] },
      profile: { provider: "codex/test", modeId: "full-access" }, budget: { agents: 4, turns: 12 }, limits: { supervisorSessions: 1, supervisorTurns: 5 } } });
    await mount(); await act(async () => button("Project mates and plans").props.onPress());
    await act(async () => button("Create Alpha mate").props.onPress()); armed = true;
    await act(async () => { button("Create project mate").props.onPress(); await state.provision.mock.results.at(-1)!.value.catch(() => {}); });
    const input = state.provision.mock.calls[0]![0];
    await act(async () => { await cache.refetchQueries(); await new Promise(done => setTimeout(done, 20)); });
    expect(button("Resume recorded request").props.disabled).toBe(true);
    if (mode === "remounted") {
      await act(async () => renderer?.unmount()); renderer = undefined; cache.clear();
      const readRpc = state.read.getMockImplementation()!;
      // A fresh client must wait for its cold RPC rather than assuming it finishes in 20 ms.
      state.read.mockImplementationOnce(async () => { await new Promise(done => setTimeout(done, 100)); return readRpc(); });
      await mount(); await act(async () => button("Project mates and plans").props.onPress());
      expect(renderer!.root.findAll(n => n.type === "Pressable" as never && n.props.accessibilityLabel === "Create Alpha mate")).toHaveLength(0);
    }
    expect(button("Recover project records").props.disabled).toBe(false);
    await act(async () => { button("Recover project records").props.onPress(); await state.recover.mock.results.at(-1)!.value; await cache.refetchQueries(); await new Promise(done => setTimeout(done, 20)); });
    expect(state.recover).toHaveBeenCalledTimes(1); expect(receiver.calls).toHaveLength(0);
    if (mode === "remounted") {
      await act(async () => button("Show Alpha details").props.onPress());
      await act(async () => button("Resume Alpha mate").props.onPress());
    }
    if (mode === "stop") receiver.faults.send = ["lose"];
    await act(async () => { button(mode !== "remounted" ? "Resume recorded request" : "Resume project provisioning").props.onPress(); await state.provision.mock.results.at(-1)!.value; await new Promise(done => setTimeout(done, 20)); });
    expect(state.provision.mock.calls[1]![0]).toEqual(input);
    expect(receiver.agents.size).toBe(1); expect(receiver.sends).toHaveLength(1);
    expect((await service.read()).projects[0]).toMatchObject({ sessions: 1, turns: 1 });
    if (mode === "stop") {
      await act(async () => { button("Stop recorded provisioning").props.onPress(); await state.abort.mock.results.at(-1)!.value; await cache.refetchQueries(); await new Promise(done => setTimeout(done, 20)); });
      expect(state.abort).toHaveBeenCalledTimes(1);
      expect((await service.read()).projects[0]).toMatchObject({ sessions: 1, turns: 1, uncertain: 1, reason: expect.stringContaining("Provisioning stopped") });
      await expect(service.provision(input, api)).rejects.toMatchObject({ code: "HELD" });
      expect(receiver.agents.size).toBe(1); expect(receiver.sends).toHaveLength(1);
    }
  } finally {
    await act(async () => { renderer?.unmount(); renderer = undefined; cache.clear();
      await Promise.allSettled(state.read.mock.results.map(result => Promise.resolve(result.value))); });
    await runtime.stop(); process.env.PASEO_HOME = previousHome;
  }
});
