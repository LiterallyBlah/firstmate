import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PluginTheme } from "@getpaseo/plugin";
import type { PlanHelpReview as Review } from "../shared/plan-help";
const mocks = vi.hoisted(() => ({ read: vi.fn(), evidence: vi.fn(), backup: vi.fn(), save: vi.fn(), migrate: vi.fn(), context: {} as any }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: (rpc: { name: string }) => rpc.name.endsWith("plan-help.evidence") ? mocks.evidence : rpc.name.endsWith("plan-help.read") ? mocks.read : rpc.name.endsWith("backup.read") ? mocks.backup : rpc.name.endsWith("backup.set") ? mocks.save : mocks.migrate }));
vi.mock("react-native", () => ({ Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View" }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ TextInput: "TextInput", Modal: Object.assign(({ children }: { children: ReactNode }) => children, { Content: "Content" }) }));
vi.mock("./workflow-plans", () => ({ workflowRequestId: () => "00000000-0000-4000-8000-000000000009", useWorkflowPlans: () => mocks.context }));
vi.mock("./supervision-activation", () => ({ SupervisionActivationBoard: "ExistingAttachBoard" }));
import { PlanHelpAction, PlanHelpReview, PlanHelpSurface } from "./plan-help";
import { compactPlansFixture } from "../test/compact-plans-fixture";
import { visibleText } from "../test/visible-text";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const review = (): Review => ({ homeId: "home", plan: "reader", title: "Reader", planHash: "a".repeat(64), reviewHash: "b".repeat(64), currentOwner: "FirstMate", projectId: uuid(1), scopeId: uuid(2), migrationId: uuid(3), supervisorId: uuid(4), budget: { agents: 2, turns: 2 }, spent: { agents: 1, turns: 1 }, problems: [], sourcePaths: ["data/orders.md"], backupRevision: 1, preparation: null, canCorrectPreparation: false });
const backup = { homeId: "home", revision: 1, requestId: uuid(5), source: "saved", backup: { destination: "C:/Backups", retention: "Keep 30 days" }, problems: [] };
const theme = { colors: { foreground: "#fff", foregroundMuted: "#aaa", border: "#444", surface1: "#222" } } as PluginTheme;
let renderer: ReactTestRenderer | null, cache: QueryClient;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.clearAllMocks(); renderer = null;
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.context = { activation: { homeId: "home", enabled: true, plans: [], problems: [], migrations: [], dispositions: [], audits: [] }, updateActivation: vi.fn(), refreshActivation: vi.fn() };
  mocks.read.mockResolvedValue(review()); mocks.backup.mockResolvedValue(backup);
});
afterEach(async () => { await act(async () => renderer?.unmount()); cache.clear(); });
async function render() { await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(PlanHelpReview, { theme, homeId: "home", planId: "reader", onClose: vi.fn() }))); }); await act(async () => { await new Promise(r => setTimeout(r, 20)); }); }
const button = (label: string) => renderer!.root.find(n => n.type === "Pressable" as never && n.props.accessibilityLabel === label);
const press = async (label: string) => { await act(async () => button(label).props.onPress()); };
async function fill() { await press("Advanced evidence references"); for (const [label, text] of [["Reviewed delivery inventory", "inventory"], ["Compatible rollback build", "build"], ["Accepted permission import", "policy"]]) await act(async () => renderer!.root.find(n => n.type === "TextInput" as never && n.props.accessibilityLabel === label).props.onChangeText(text)); }
it("R4: ordinary evidence review selects actual files and checked sources without typing operator references", async () => {
  mocks.evidence.mockImplementation(async (input: any) => ({ homeId: "home", plan: "reader", reviewHash: review().reviewHash, folder: "data", entries: [{ name: "rollback.md", path: "data/rollback.md", kind: "file" }], problems: [],
    inventory: { hash: "c".repeat(64), summary: ["0 pending or recorded deliveries checked."], problems: [] },
    policy: { hash: "d".repeat(64), sources: [{ path: "data/orders.md", lines: "1–1", content: "Reviewed project permissions." }] },
    rollback: input.rollbackPath ? { path: input.rollbackPath, hash: "e".repeat(64), content: "Retained build and tested recovery evidence." } : null }));
  await render();
  expect(renderer!.root.findAll(n => n.props.accessibilityLabel === "Compatible rollback build")).toHaveLength(0);
  await press("Check handover evidence"); await act(async () => { await new Promise(done => setTimeout(done, 20)); });
  await press("I reviewed pending deliveries"); await press("I reviewed accepted permissions");
  await press("Read rollback.md"); await act(async () => { await new Promise(done => setTimeout(done, 20)); });
  expect(visibleText(renderer!.toJSON())).toContain("Retained build and tested recovery evidence.");
  await press("Use this rollback report"); await press("Use reviewed evidence");
  expect(button("Review handover").props.disabled).toBe(false);
  await press("Review handover");
  expect(mocks.migrate).not.toHaveBeenCalled(); // Review and file selection do not prepare or attach.
  mocks.migrate.mockRejectedValue(new Error("test stops before mutation")); await press("Confirm this handover step");
  expect(mocks.migrate.mock.calls[0]![0].evidence.rollback).toEqual({ path: "data/rollback.md", hash: "e".repeat(64) });
});
it("view, evidence disclosure and cancel cause no mutation or Attach; review explains retained owner/spend", async () => {
  await render(); await fill(); await press("Review handover"); await press("Keep current owner");
  expect(mocks.migrate).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  expect(visibleText(renderer!.toJSON())).toContain("Current owner: FirstMate");
  expect(visibleText(renderer!.toJSON())).toContain("Already spent: 1 sessions / 1 turns");
  expect(renderer!.root.findAllByType("ExistingAttachBoard" as never)).toHaveLength(0);
});
it("permission/inventory/backup holds keep preparation unavailable without a bypass", async () => {
  mocks.read.mockResolvedValue({ ...review(), problems: ["Decisions haven't all been checked."] });
  await render(); await fill(); expect(button("Review handover").props.disabled).toBe(true);
  expect(mocks.migrate).not.toHaveBeenCalled();
});
it("only explicit confirmation mutates; a lost reply and duplicate press retain the exact preparation", async () => {
  mocks.migrate.mockRejectedValue(new Error("reply lost"));
  await render(); await fill(); await press("Review handover");
  await act(async () => { button("Confirm this handover step").props.onPress(); button("Confirm this handover step").props.onPress(); });
  expect(mocks.migrate).toHaveBeenCalledTimes(1);
  await press("Retry this handover request"); expect(mocks.migrate.mock.calls[1]![0]).toEqual(mocks.migrate.mock.calls[0]![0]);
  expect(mocks.migrate.mock.calls[0]![0]).not.toHaveProperty("actor");
});
it("an invalid backup save keeps its draft and can be corrected after a fresh settings read", async () => {
  mocks.save.mockRejectedValue(new Error("Choose a separate backup folder"));
  await render(); await press("Save backup settings");
  expect(visibleText(renderer!.toJSON())).toContain("Choose a separate backup folder");
  await press("Review corrected backup settings");
  const field = renderer!.root.find(n => n.type === "TextInput" as never && n.props.accessibilityLabel === "Backup folder");
  expect(field.props.editable).toBe(true); expect(field.props.value).toBe("C:/Backups");
});
it("R3: only a fresh proof of no freeze lets the captain clear a refused request for explicit correction", async () => {
  mocks.read.mockResolvedValue({ ...review(), canCorrectPreparation: true }); mocks.migrate.mockRejectedValue(new Error("refused before freeze"));
  await render(); await fill(); await press("Review handover"); await press("Confirm this handover step");
  expect(mocks.migrate).toHaveBeenCalledTimes(1);
  await press("Review corrected handover");
  expect(renderer!.root.findAll(n => n.props.accessibilityLabel === "Retry this handover request")).toHaveLength(0);
  expect(mocks.migrate).toHaveBeenCalledTimes(1); expect(button("Review handover").props.disabled).toBe(false);
  // A different client may have frozen it since the error; the fresh read must retain the exact request.
  await press("Review handover"); await press("Confirm this handover step");
  mocks.read.mockResolvedValue({ ...review(), canCorrectPreparation: false }); await press("Review corrected handover");
  expect(button("Retry this handover request")).toBeDefined();
});
it("only a committed handover exposes the existing Attach board; uncertain setup is never ready", async () => {
  mocks.context.activation.migrations = [{ id: uuid(3), planId: "reader", state: "prepared" }];
  await render(); expect(renderer!.root.findAllByType("ExistingAttachBoard" as never)).toHaveLength(0);
  await act(async () => { mocks.context.activation.migrations[0].state = "committed"; renderer!.update(createElement(QueryClientProvider, { client: cache }, createElement(PlanHelpReview, { theme, homeId: "home", planId: "reader", onClose: vi.fn() }))); });
  expect(renderer!.root.findAllByType("ExistingAttachBoard" as never)).toHaveLength(1);
});
it("readiness names only an active binding with a successful opening from a readable snapshot", async () => {
  const plan = compactPlansFixture().find(p => !p.definition.implicit)!;
  mocks.context.snapshot = { homeId: "home", plans: [plan] };
  mocks.context.activation.plans = [{ plan: plan.definition.id, binding: "active", opening: "uncertain" }];
  const tree = () => createElement(PlanHelpSurface, { theme, children: createElement(PlanHelpAction, { theme, plan }) });
  await act(async () => { renderer = create(tree()); });
  expect(visibleText(renderer!.toJSON())).not.toContain("Plan helper is ready");
  await act(async () => { mocks.context.activation.plans[0].opening = "succeeded"; renderer!.update(tree()); });
  expect(visibleText(renderer!.toJSON())).toContain("Plan helper is ready");
  await act(async () => { mocks.context.activationError = true; renderer!.update(tree()); });
  expect(visibleText(renderer!.toJSON())).not.toContain("Plan helper is ready");
});
it("a freeze without a migration receipt keeps a named recovery entry after the plan row disappears", async () => {
  mocks.context.snapshot = { homeId: "home", plans: [], planHelpPending: [{ plan: "reader", title: "Reader update" }] };
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(PlanHelpSurface, { theme, children: null }))); });
  expect(button("Continue handover: Reader update")).toBeDefined(); expect(mocks.migrate).not.toHaveBeenCalled();
});
