import { act, createElement, type ElementType } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PluginTheme } from "@getpaseo/plugin";
import type { ProjectSetupCatalog, ProjectSetupPreview } from "../shared/project-setup";
import type { z } from "zod";
import type { ProjectSetupInputSchema } from "../shared/supervision-policy";
const calls = vi.hoisted(() => new Map<string, ReturnType<typeof vi.fn>>());
vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable" }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: (c: { name: string }) => {
  if (!calls.has(c.name)) calls.set(c.name, vi.fn()); return calls.get(c.name);
} }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ TextInput: "TextInput", Modal: Object.assign(({ open, children }: { open: boolean; children: unknown }) => open ? children : null, { Content: ({ children }: { children: unknown }) => children }) }));
vi.mock("./option-picker", () => ({ OptionPicker: "Picker" }));
vi.mock("./workflow-plans", () => ({ workflowRequestId: () => "00000000-0000-4000-8000-000000000099" }));
import { ProjectSetup } from "./project-setup";
const home = "C:/fixture/home", id = "00000000-0000-4000-8000-000000000001", hash = "a".repeat(64), theme = { colors: {} } as PluginTheme;
let renderer: ReactTestRenderer | null, cache: QueryClient, data: ProjectSetupCatalog, review: ProjectSetupPreview, saved: z.infer<typeof ProjectSetupInputSchema>[], closed: () => void;
const rpc = (suffix: string) => calls.get(`firstmate.projects.setup.${suffix}`)!;
const text = () => JSON.stringify(renderer?.toJSON());
const button = (name: string) => renderer!.root.findAllByType("Pressable" as ElementType).find(n => n.props.accessibilityLabel === name)!;
async function press(name: string) { await act(async () => { const b = button(name); expect(b, name).toBeDefined(); expect(b.props.disabled).toBe(false); b.props.onPress(); }); }
async function settle() { await act(async () => { await new Promise(done => setTimeout(done, 5)); }); }
async function mount() {
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(ProjectSetup, { theme, compact: false, home, hostId: "local", open: true, onClose: closed }))); }); await settle();
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; renderer = null; calls.clear(); closed = vi.fn();
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); saved = [];
  const profile = { provider: "fixture/model", modeId: "full-access" }, limits = { supervisorSessions: 1 as const, supervisorTurns: 5 }, budget = { agents: 2, turns: 9 };
  const choices = { homeId: home, name: "alpha", profile, limits, budget, sourcePath: "data/orders.md" };
  data = { snapshot: { enabled: true, homeId: home, registryDigest: hash, sequence: 0, hash: null, freshness: "current", problems: [], general: { agentId: "general", scopeId: null, headroom: 1, slots: 4, providerAvailability: "unknown" },
    projects: [{ name: "alpha", projectId: id, scopeId: id, directory: "C:/alpha", hostId: "local", state: "admitted", version: 2, aliases: [], agentId: null, workspaceId: null, provisionRequestId: null,
      profile, limits, sessions: 0, turns: 0, uncertain: 0, memoryPending: 0, plans: [], reason: null }] },
    models: [{ provider: profile.provider, label: "Fixture model", modes: [{ id: "full-access", label: "Full access" }], thinking: [] }],
    sources: [{ path: "data/orders.md", text: "The captain permits one project mate for alpha.", problem: null }], reviewed: [choices], problems: [] };
  review = { choices, reasons: [], reviewDigest: hash, review: { homeId: home, registryDigest: hash, generalAgentId: "general", projectId: id, name: "alpha", projectVersion: 2, aliases: [],
    source: { id, version: 1, path: "data/orders.md", lineStart: 1, lineEnd: 1, fileHash: hash, excerptHash: hash, supersedes: [], provenance: { kind: "plugin-ui-unverified", id: "unauthenticated-plugin-call", source: "project setup review (unverified)" } },
    profile, limits, budget, policyHash: hash, sourceVector: [{ kind: "policy-source", id, version: 1, digest: hash }], opening: "Keep track of alpha; do not create workers or invoke Attach.", capacity: { slots: 4, generalHeadroom: 1 }, spent: { sessions: 0, turns: 0 } } };
  for (const suffix of ["read", "preview", "status", "commit", "resume", "folder", "instructions"]) calls.set(`firstmate.projects.setup.${suffix}`, vi.fn());
  rpc("read").mockImplementation(async () => structuredClone(data)); rpc("status").mockImplementation(async () => ({ snapshot: structuredClone(data.snapshot), requests: structuredClone(saved) }));
  rpc("preview").mockImplementation(async () => structuredClone(review)); rpc("commit").mockImplementation(async (input: z.infer<typeof ProjectSetupInputSchema>) => { saved = [input]; return structuredClone(data.snapshot); });
});
afterEach(() => { act(() => renderer?.unmount()); cache.clear(); });
it("chooser, supported reviewed profile, review and close perform reads only; creation alone authorizes effects", async () => {
  await mount(); await press("Review alpha"); await press("Review alpha setup");
  expect(rpc("preview")).toHaveBeenCalledWith(review.choices); expect(text()).toContain("full-access permissions"); expect(text()).toContain("Existing spend");
  expect(rpc("commit")).not.toHaveBeenCalled(); expect(rpc("resume")).not.toHaveBeenCalled();
  await press("Close setup"); expect(closed).toHaveBeenCalledOnce();
});
it("lost reply retains the exact request and read-only checking never resends it", async () => {
  rpc("commit").mockImplementation(async (input: z.infer<typeof ProjectSetupInputSchema>) => { saved = [input]; throw Error("lost create response"); });
  await mount(); await press("Review alpha"); await press("Review alpha setup"); await press("Create project mate"); await settle();
  expect(text()).toContain("Couldn't confirm setup"); const original = rpc("commit").mock.calls[0]![0];
  await press("Check saved setup"); expect(rpc("commit")).toHaveBeenCalledTimes(1); expect(rpc("resume")).not.toHaveBeenCalled();
  await press("Continue exact setup"); expect(rpc("commit")).toHaveBeenCalledTimes(2); expect(rpc("commit").mock.calls[1]![0]).toEqual(original);
});
it("a remounted chooser discovers the saved original request, offers its recovery, and invents no new request", async () => {
  saved = [{ homeId: home, requestId: id, reviewDigest: hash, review: review.review! }];
  await mount(); expect(button("Review alpha")).toBeUndefined(); expect(button("Continue alpha saved setup")).toBeDefined();
  await press("Check saved setup"); expect(rpc("commit")).not.toHaveBeenCalled(); expect(rpc("resume")).not.toHaveBeenCalled();
  data.snapshot.projects[0]!.uncertain = 1;
  await press("Check saved setup"); expect(button("Continue alpha saved setup").props.disabled).toBe(true);
});
it("an incomplete saved-status response holds setup without blanking the parent screen", async () => {
  rpc("status").mockResolvedValue({}); await mount();
  expect(text()).toContain("Saved setup couldn't be checked"); expect(button("Review alpha").props.disabled).toBe(true);
  expect(rpc("commit")).not.toHaveBeenCalled(); expect(rpc("resume")).not.toHaveBeenCalled();
});
