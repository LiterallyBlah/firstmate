import { act, createElement, type ElementType } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PluginTheme } from "@getpaseo/plugin";
import { ProjectSetupFolderSchema, type ProjectSetupCatalog, type ProjectSetupPreview } from "../shared/project-setup";
import type { z } from "zod";
import type { ProjectSetupInputSchema } from "../shared/supervision-policy";
const calls = vi.hoisted(() => new Map<string, ReturnType<typeof vi.fn>>());
vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", Platform: { OS: "web" } }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: (c: { name: string }) => {
  if (!calls.has(c.name)) calls.set(c.name, vi.fn()); return calls.get(c.name);
} }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ TextInput: "TextInput", Modal: Object.assign(({ open, children }: { open: boolean; children: unknown }) => open ? children : null, { Content: ({ children }: { children: unknown }) => children }) }));
vi.mock("./option-picker", () => ({ OptionPicker: "Picker" }));
vi.mock("./workflow-plans", () => ({ workflowRequestId: vi.fn(() => "00000000-0000-4000-8000-000000000099") }));
import { workflowRequestId } from "./workflow-plans";
import { ProjectSetup } from "./project-setup";
import type { ProjectBatchCommit, ProjectBatchStatus } from "../shared/project-setup-batch";
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
  vi.mocked(workflowRequestId).mockReturnValue("00000000-0000-4000-8000-000000000099");
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
  calls.set("firstmate.projects.batch.status", vi.fn(async () => []));
});
const batchRpc = (suffix: string) => calls.get(`firstmate.projects.batch.${suffix}`)!;
function batchFixture() {
  const manifest = { version: 1 as const, homeId: home, batchId: "00000000-0000-4000-8000-000000000099", registryDigest: hash, policyHash: hash,
    children: [{ homeId: home, requestId: id, reviewDigest: hash, review: review.review! }], capacity: { slots: 4, generalHeadroom: 1, occupied: 0, available: 3 } };
  const input: ProjectBatchCommit = { manifest, reviewDigest: hash }, results: ProjectBatchStatus[] = [];
  calls.set("firstmate.projects.batch.preview", vi.fn(async () => ({ reviews: [review], commit: input, reasons: [], capacity: manifest.capacity })));
  calls.set("firstmate.projects.batch.commit", vi.fn(async (exact: ProjectBatchCommit) => {
    const result: ProjectBatchStatus = { commit: exact, children: [{ requestId: id, projectId: id, name: "alpha", state: "ready", reason: "Ready", agentId: "alpha-agent", sessions: 1, turns: 1, canContinue: false, canCancel: false }], problems: [] };
    results.push(result); return result;
  }));
  batchRpc("status").mockImplementation(async () => structuredClone(results));
  calls.set("firstmate.projects.batch.continue", vi.fn()); calls.set("firstmate.projects.batch.cancel", vi.fn());
  return { input, results };
}
it("select-all is explicit, excludes existing/invalid projects and reviews without effects", async () => {
  batchFixture();
  data.snapshot.projects.push({ ...data.snapshot.projects[0]!, name: "existing", agentId: "old-agent" }, { ...data.snapshot.projects[0]!, name: "remote", directory: null, hostId: "remote", state: "held" });
  await mount(); expect(button("Select alpha").props.accessibilityState.checked).toBe(false);
  expect(button("Select existing")).toBeUndefined(); expect(button("Select remote")).toBeUndefined();
  await press("Select all eligible projects"); expect(button("Select alpha").props.accessibilityState.checked).toBe(true);
  await press("Review 1 selected project");
  expect(batchRpc("preview")).toHaveBeenCalledOnce(); expect(batchRpc("commit")).not.toHaveBeenCalled(); expect(rpc("commit")).not.toHaveBeenCalled();
  expect(text()).toContain("full-access permissions"); expect(text()).toContain("Existing spend");
  await press("Create 1 project mate"); expect(batchRpc("commit")).toHaveBeenCalledOnce(); expect(text()).toContain("alpha"); expect(text()).toContain("Ready");
  await press("Check saved setup"); expect(batchRpc("commit")).toHaveBeenCalledOnce(); expect(batchRpc("continue")).not.toHaveBeenCalled();
});
it("a shortfall keeps all six selected, offers capacity review and never raises limits", async () => {
  batchFixture();
  for (const name of ["beta", "gamma", "delta", "epsilon", "zeta"]) data.snapshot.projects.push({ ...data.snapshot.projects[0]!, name });
  batchRpc("preview").mockResolvedValue({ reviews: [review], commit: null, reasons: ["6 selected; room for 3. Review capacity or choose fewer projects."], capacity: { slots: 4, generalHeadroom: 1, occupied: 0, available: 3 } });
  await mount(); await press("Select all eligible projects"); await press("Review 6 selected projects");
  const lines = renderer!.root.findAllByType("Text" as ElementType).map(n => [n.props.children].flat().join(""));
  expect(lines.filter(line => line.includes("6 selected; room for 3"))).toHaveLength(1);
  expect(button("Review capacity")).toBeDefined(); expect(button("Create 6 project mates")).toBeUndefined();
  await press("Back to projects"); expect(button("Review 6 selected projects")).toBeDefined();
  expect(batchRpc("commit")).not.toHaveBeenCalled();
});
it("lost batch response uses read-only discovery and never automatically continues an uncertain opening", async () => {
  const { input, results } = batchFixture();
  batchRpc("commit").mockImplementation(async () => {
    results.push({ commit: input, children: [{ requestId: id, projectId: id, name: "alpha", state: "checking", reason: "Checking whether setup finished", agentId: "original-agent", sessions: 1, turns: 1, canContinue: false, canCancel: false }], problems: [] });
    throw Error("Reply lost");
  });
  await mount(); await press("Select all eligible projects"); await press("Review 1 selected project"); await press("Create 1 project mate");
  expect(text()).toContain("Checking whether setup finished"); expect(button("Continue saved batch")).toBeUndefined();
  await press("Check saved setup"); expect(batchRpc("commit")).toHaveBeenCalledOnce(); expect(batchRpc("continue")).not.toHaveBeenCalled();
  await act(async () => renderer?.unmount()); await mount(); expect(text()).toContain("Checking whether setup finished"); expect(batchRpc("commit")).toHaveBeenCalledOnce();
  expect(button("Select alpha")).toBeUndefined();
});
it("P2-1: a refused unsaved batch offers re-check and back without losing selection or its batch identity", async () => {
  batchFixture(); batchRpc("commit").mockRejectedValue(Error("The aggregate review changed. Review all selected projects again."));
  await mount(); await press("Select all eligible projects"); await press("Review 1 selected project"); await press("Create 1 project mate");
  const original = batchRpc("commit").mock.calls[0]![0];
  expect(button("Re-check selected projects")).toBeDefined(); expect(button("Back to projects").props.disabled).toBe(false);
  await press("Back to projects"); expect(button("Select alpha").props.accessibilityState.checked).toBe(true);
  await press("Review 1 selected project"); await press("Re-check selected projects");
  expect(batchRpc("preview")).toHaveBeenCalledTimes(2);
  expect(batchRpc("preview").mock.calls[1]![0]).toMatchObject({ batchId: original.manifest.batchId, choices: [review.choices] });
  expect(button("Create 1 project mate").props.disabled).toBe(false);
});
it("P2-1: an unconfirmed lost reply retains its exact confirmation across back and return", async () => {
  batchFixture(); batchRpc("commit").mockRejectedValue(Error("Connection lost"));
  await mount(); await press("Select all eligible projects"); await press("Review 1 selected project"); await press("Create 1 project mate");
  const original = batchRpc("commit").mock.calls[0]![0];
  await press("Back to projects"); await press("Review 1 selected project"); await press("Check original confirmation");
  expect(batchRpc("commit")).toHaveBeenCalledTimes(2); expect(batchRpc("commit").mock.calls[1]![0]).toEqual(original);
});
it("P2-2: recoverable batch creation has an explicit continuation, while checking is read-only", async () => {
  const { input, results } = batchFixture();
  results.push({ commit: input, children: [{ requestId: id, projectId: id, name: "alpha", state: "checking", reason: "Continue saved batch to find the same mate and finish its first message once creation is confirmed.", agentId: "original-agent", sessions: 1, turns: 1, canContinue: true, canCancel: false }], problems: [] });
  await mount(); await press("Check saved setup"); expect(batchRpc("continue")).not.toHaveBeenCalled();
  await press("Continue saved batch"); expect(batchRpc("continue")).toHaveBeenCalledExactlyOnceWith({ homeId: home, batchId: input.manifest.batchId });
  expect(batchRpc("commit")).not.toHaveBeenCalled(); expect(rpc("commit")).not.toHaveBeenCalled();
});
it("re-check keeps the exact confirmation when saved status cannot be read", async () => {
  batchFixture(); batchRpc("commit").mockRejectedValue(Error("Connection lost"));
  await mount(); await press("Select all eligible projects"); await press("Review 1 selected project"); await press("Create 1 project mate");
  const original = batchRpc("commit").mock.calls[0]![0];
  batchRpc("status").mockRejectedValueOnce(Error("Offline")); await press("Re-check selected projects");
  expect(batchRpc("preview")).toHaveBeenCalledOnce(); expect(button("Create 1 project mate").props.disabled).toBe(true);
  await press("Check original confirmation"); expect(batchRpc("commit").mock.calls[1]![0]).toEqual(original);
});
it("a late saved confirmation discovered during re-check retains the original request", async () => {
  const { input, results } = batchFixture(); batchRpc("commit").mockRejectedValue(Error("Connection lost"));
  await mount(); await press("Select all eligible projects"); await press("Review 1 selected project"); await press("Create 1 project mate");
  batchRpc("preview").mockImplementationOnce(async () => {
    results.push({ commit: input, children: [{ requestId: id, projectId: id, name: "alpha", state: "checking", reason: "Check saved setup", agentId: "original-agent", sessions: 1, turns: 1, canContinue: false, canCancel: false }], problems: [] });
    return { reviews: [review], commit: input, reasons: [], capacity: input.manifest.capacity };
  });
  await press("Re-check selected projects");
  expect(cache.getQueryData<ProjectBatchStatus[]>(["firstmate", "project-batches", "local", home])?.[0]?.commit).toEqual(input);
  expect(button("Create 1 project mate")).toBeUndefined(); expect(button("Continue saved batch")).toBeUndefined();
  expect(batchRpc("commit")).toHaveBeenCalledOnce(); expect(batchRpc("continue")).not.toHaveBeenCalled();
});
it("a known saved batch retains its recovery and a different explicit selection gets a new batch identity", async () => {
  const { input } = batchFixture();
  await mount(); await press("Select all eligible projects"); await press("Review 1 selected project"); await press("Create 1 project mate");
  data.snapshot.projects.push({ ...data.snapshot.projects[0]!, name: "beta", projectId: "00000000-0000-4000-8000-000000000002" });
  vi.mocked(workflowRequestId).mockReturnValue("00000000-0000-4000-8000-000000000100");
  await press("Check saved setup"); await press("Back to projects"); await press("Clear selection"); await press("Select beta"); await press("Review 1 selected project");
  expect(batchRpc("preview").mock.calls[1]![0]).toMatchObject({ batchId: "00000000-0000-4000-8000-000000000100", choices: [{ name: "beta" }] });
  expect(text()).toContain("Ready");
  expect(batchRpc("commit")).toHaveBeenCalledExactlyOnceWith(input);
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
it.each(["alpha", "café"])("missing %s folder offers checked correction through the RPC schema and requires a fresh setup review", async name => {
  Object.assign(data.snapshot.projects[0]!, { name, projectId: null, directory: null, hostId: null, state: "held", version: 0, reason: "Project directory is unavailable; identity was not guessed." });
  review.choices.name = name; review.review!.name = name;
  const issue = { name, location: "C:/missing/alpha", rowDigest: hash, canReplace: true };
  Object.assign(data, { folderIssues: [issue] });
  rpc("folder").mockImplementation(async input => {
    ProjectSetupFolderSchema.parse(input);
    Object.assign(data.snapshot.projects[0]!, { projectId: id, directory: "C:/replacement/alpha", hostId: "local", state: "unadmitted", reason: "Awaiting reviewed admission and allocation." });
    Object.assign(data, { folderIssues: [] }); return data.snapshot;
  });
  await mount(); expect(text()).toContain(issue.location);
  expect(button(`Review ${name}`)).toBeUndefined();
  await press(`Choose a replacement folder for ${name}`);
  expect(rpc("folder")).toHaveBeenCalledExactlyOnceWith({ homeId: home, registryDigest: hash, name, replace: { location: issue.location, rowDigest: hash } });
  expect(button(`Review ${name}`)).toBeDefined();
  expect(rpc("preview")).not.toHaveBeenCalled(); expect(rpc("commit")).not.toHaveBeenCalled();
  await press(`Review ${name}`); await press(`Review ${name} setup`); expect(rpc("preview")).toHaveBeenCalledOnce();
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
