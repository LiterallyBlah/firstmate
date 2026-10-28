import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProjectRuntimeSnapshot } from "../shared/project-runtime";
import { attentionTheme as theme } from "../test/attention-deck-fixture";
const state = vi.hoisted(() => ({ data: null as ProjectRuntimeSnapshot | null, read: vi.fn(), provision: vi.fn() }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: (rpc: { name: string }) => rpc.name.endsWith("provision-ui") ? state.provision : state.read }));
vi.mock("react-native", () => ({ Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View" }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Modal: Object.assign(({ open, children }: { open: boolean; children: ReactNode }) => open ? children : null, { Content: "Content" }) }));
vi.mock("./workflow-plans", () => ({ workflowRequestId: () => "00000000-0000-4000-8000-000000000099" }));
import { ProjectOwnershipBoard } from "./project-ownership";
let renderer: ReactTestRenderer | undefined, cache: QueryClient;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  state.data = { enabled: true, homeId: "fixture", registryDigest: "a".repeat(64), sequence: 10, hash: "a".repeat(64), freshness: "current", problems: [],
    general: { agentId: "general", scopeId: null, slots: 4, headroom: 1, providerAvailability: "unknown" }, projects: [{ name: "Alpha", projectId: "00000000-0000-4000-8000-000000000001", scopeId: "00000000-0000-4000-8000-000000000002", hostId: "local", directory: "C:/Alpha", state: "admitted", reason: null, version: 2, aliases: [], agentId: null, workspaceId: null, provisionRequestId: null,
      sessions: 0, turns: 0, uncertain: 0, memoryPending: 0, profile: { provider: "codex/test", modeId: "full-access" }, limits: { supervisorSessions: 1, supervisorTurns: 5 }, plans: [] }] };
  state.read.mockImplementation(async () => structuredClone(state.data));
});
afterEach(async () => { await act(async () => renderer?.unmount()); cache.clear(); });
const button = (label: string) => renderer!.root.find(n => n.type === "Pressable" as never && n.props.accessibilityLabel === label);
async function mount() {
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(ProjectOwnershipBoard, { theme, compact: true }))); });
  await act(async () => { await new Promise(done => setTimeout(done, 20)); });
}
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
