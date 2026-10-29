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
async function press(name: string) { await act(async () => { const b = button(name); expect(b, name).toBeDefined(); expect(b.props.disabled).toBe(false); b.props.onPress(); }); await settle(); }
async function settle() {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(done => setTimeout(done, 0)); });
    expect(cache.isFetching()).toBe(0);
  }, { timeout: 1000, interval: 1 });
  await act(async () => { await new Promise(done => setTimeout(done, 0)); });
}
async function mount(initialProjectName?: string) {
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(ProjectSetup, { theme, compact: false, home, hostId: "local", open: true, onClose: closed, ...(initialProjectName ? { initialProjectName } : {}) }))); }); await settle();
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
    sources: [{ path: "data/orders.md", text: "The captain permits one project mate for alpha.", problem: null }], reviewed: [choices], problems: [], folderIssues: [] };
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
it("lost create recovery stays available for the exact saved request while uncertain openings stay held", async () => {
  saved = [{ homeId: home, requestId: id, reviewDigest: hash, review: review.review! }];
  Object.assign(data.snapshot.projects[0]!, { agentId: "reserved-agent", uncertain: 1, reason: "Provisioning incomplete; inspect and resume the recorded request." });
  rpc("status").mockImplementation(async () => ({ snapshot: structuredClone(data.snapshot), requests: saved, recoverableCreates: [id] }));
  rpc("resume").mockResolvedValue(data.snapshot);
  await mount(); await press("Check saved setup");
  expect(rpc("resume")).not.toHaveBeenCalled();
  await press("Continue alpha saved setup");
  expect(rpc("resume")).toHaveBeenCalledExactlyOnceWith({ homeId: home, requestId: id });
  expect(rpc("commit")).not.toHaveBeenCalled();
});
it("missing unadmitted folder offers checked correction and requires a fresh setup review", async () => {
  Object.assign(data.snapshot.projects[0]!, { projectId: null, directory: null, hostId: null, state: "held", version: 0, reason: "Project directory is unavailable; identity was not guessed." });
  const issue = { name: "alpha", location: "C:/missing/alpha", rowDigest: hash, canReplace: true };
  Object.assign(data, { folderIssues: [issue] });
  rpc("folder").mockImplementation(async () => {
    Object.assign(data.snapshot.projects[0]!, { projectId: id, directory: "C:/replacement/alpha", hostId: "local", state: "unadmitted", reason: "Awaiting reviewed admission and allocation." });
    Object.assign(data, { folderIssues: [] }); return data.snapshot;
  });
  await mount(); expect(text()).toContain(issue.location);
  expect(button("Review alpha")).toBeUndefined();
  await press("Choose a replacement folder for alpha");
  expect(rpc("folder")).toHaveBeenCalledExactlyOnceWith({ homeId: home, registryDigest: hash, name: "alpha", replace: { location: issue.location, rowDigest: hash } });
  expect(button("Review alpha")).toBeDefined();
  expect(rpc("preview")).not.toHaveBeenCalled(); expect(rpc("commit")).not.toHaveBeenCalled();
  await press("Review alpha"); await press("Review alpha setup"); expect(rpc("preview")).toHaveBeenCalledOnce();
});
it("missing retained folder shows the exact restoration path and offers no rebinding", async () => {
  Object.assign(data.snapshot.projects[0]!, { directory: null, state: "held" });
  data.folderIssues = [{ name: "alpha", location: "C:/original/alpha", rowDigest: hash, canReplace: false }];
  await mount(); expect(text()).toContain("C:/original/alpha"); expect(text()).toContain("saved identity cannot be moved");
  expect(button("Choose a replacement folder for alpha")).toBeUndefined(); expect(button("Review alpha")).toBeUndefined();
  expect(rpc("folder")).not.toHaveBeenCalled();
});
it("an explicit named entry opens that project's profile review without authorizing any setup effect", async () => {
  await mount("alpha"); expect(button("Review alpha setup")).toBeDefined();
  expect(rpc("preview")).not.toHaveBeenCalled(); expect(rpc("commit")).not.toHaveBeenCalled(); expect(rpc("resume")).not.toHaveBeenCalled();
  await press("Review alpha setup"); expect(rpc("preview")).toHaveBeenCalledExactlyOnceWith(review.choices);
});
