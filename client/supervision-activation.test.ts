import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PluginTheme } from "@getpaseo/plugin";
import type { ActivationSnapshot } from "../shared/supervision-activation";
const mocks = vi.hoisted(() => ({ read: vi.fn(), attach: vi.fn(), models: vi.fn(), snapshot: undefined as ActivationSnapshot | undefined }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: (rpc: { name: string }) => rpc.name.endsWith("attach-ui") ? mocks.attach : rpc.name.endsWith("activation") ? mocks.read : mocks.models }));
vi.mock("react-native", () => ({ Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View" }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ TextInput: "TextInput", Modal: Object.assign(({ open, children }: { open: boolean; children: ReactNode }) => open ? children : null, { Content: "Content" }) }));
vi.mock("./option-picker", () => ({ OptionPicker: "OptionPicker" }));
vi.mock("./workflow-plans", () => ({ workflowRequestId: () => "00000000-0000-4000-8000-000000000003", useWorkflowPlans: () => ({ activation: mocks.snapshot }) }));
import { AttachConfirmation, SupervisionActivationBoard } from "./supervision-activation";
import { visibleText } from "../test/visible-text";
const theme = { colors: { foreground: "#fff", foregroundMuted: "#aaa", border: "#444", surface1: "#222" } } as PluginTheme;
const plan = { plan: "scheduler", title: "Scheduler", hash: "a".repeat(64), scopeId: "00000000-0000-4000-8000-000000000001",
  scopeVersion: 1, supervisorId: "00000000-0000-4000-8000-000000000002", canAttach: true, binding: null, opening: null } as const;
const snapshot = (): ActivationSnapshot => ({ enabled: true, homeId: "fixture-home", problems: [], plans: [plan], audits: [], migrations: [], dispositions: [] });
let renderer: ReactTestRenderer | null, cache: QueryClient;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); renderer = null; cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.snapshot = snapshot(); mocks.read.mockResolvedValue(snapshot()); mocks.models.mockResolvedValue({ targets: [{ provider: "codex/test", label: "Test model", modes: [{ id: "read-only", label: "Read only" }] }] });
});
afterEach(async () => { await act(async () => renderer?.unmount()); cache.clear(); });
async function render(child: ReactNode) {
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, child)); });
  await act(async () => { await new Promise(r => setTimeout(r, 20)); });
}
const button = (text: string) => renderer!.root.find(n => n.type === "Pressable" as never && n.props.accessibilityLabel === text);
async function fill() {
  await act(async () => renderer!.root.find(n => n.type === "OptionPicker" as never && n.props.label === "Supervisor model").props.onSelect("codex/test"));
  await act(async () => renderer!.root.find(n => n.type === "OptionPicker" as never && n.props.label === "Permission mode").props.onSelect("read-only"));
  await act(async () => renderer!.root.findByType("TextInput" as never).props.onChangeText("Read the Scheduler plan."));
}
it("a disabled board has no layout, attach button or write on view", async () => {
  mocks.snapshot = { ...snapshot(), enabled: false, plans: [] };
  await render(createElement(SupervisionActivationBoard, { theme, compact: false }));
  expect(renderer!.toJSON()).toBe(null); expect(mocks.attach).not.toHaveBeenCalled();
});
it("board history shows time, plan, supervisor and unverified source without attaching", async () => {
  mocks.snapshot = { ...snapshot(), audits: [{ at: "2026-10-28T12:00:00Z", plan: "scheduler", supervisor: plan.supervisorId,
    source: "client UI (unverified)", authorization: "by convention, not verified" }] };
  await render(createElement(SupervisionActivationBoard, { theme, compact: true }));
  const text = visibleText(renderer!.toJSON());
  for (const part of ["2026-10-28T12:00:00Z", "scheduler", plan.supervisorId, "client UI (unverified)", "by convention, not verified"]) expect(text).toContain(part);
  expect(mocks.attach).not.toHaveBeenCalled();
});
it("confirmation names the plan and supervisor; cancel and form edits never invoke attach", async () => {
  const close = vi.fn(); await render(createElement(AttachConfirmation, { theme, compact: true, homeId: "fixture-home", plan, stale: false, onClose: close, onRead: vi.fn() }));
  expect(visibleText(renderer!.toJSON())).toContain(plan.supervisorId);
  expect(visibleText(renderer!.toJSON())).toContain("Plan: Scheduler (scheduler)");
  await fill(); expect(mocks.attach).not.toHaveBeenCalled();
  await act(async () => button("Cancel").props.onPress()); expect(close).toHaveBeenCalledOnce();
});
it("only explicit confirmation writes; double presses and a lost reply keep one immutable request", async () => {
  mocks.attach.mockRejectedValue(new Error("reply lost"));
  await render(createElement(AttachConfirmation, { theme, compact: false, homeId: "fixture-home", plan, stale: false, onClose: vi.fn(), onRead: vi.fn() }));
  await fill(); const label = `Attach ${plan.supervisorId} to Scheduler`;
  await act(async () => { button(label).props.onPress(); button(label).props.onPress(); });
  expect(mocks.attach).toHaveBeenCalledTimes(1);
  const input = mocks.attach.mock.calls[0]![0]; expect(input).not.toHaveProperty("actor");
  await act(async () => button("Retry this attachment request").props.onPress());
  expect(mocks.attach).toHaveBeenCalledTimes(2); expect(mocks.attach.mock.calls[1]![0]).toEqual(input);
});
