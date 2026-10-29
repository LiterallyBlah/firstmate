import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PluginTheme } from "@getpaseo/plugin";
import type { ActivationSnapshot } from "../shared/supervision-activation";
const mocks = vi.hoisted(() => ({ migrate: vi.fn() }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => mocks.migrate }));
vi.mock("react-native", () => ({ Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View" }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ TextInput: "TextInput", Modal: Object.assign(({ open, children }: { open: boolean; children: ReactNode }) => open ? children : null, { Content: "Content" }) }));
import { MigrationOperations } from "./migration-operations";
const theme = { colors: { foreground: "#fff", foregroundMuted: "#aaa", border: "#444", surface1: "#222" } } as PluginTheme;
const snapshot: ActivationSnapshot = { enabled: true, operatorEnabled: true, homeId: "fixture-home", problems: [], plans: [], audits: [], migrations: [], dispositions: [] };
const original = { op: "prepare", homeId: "fixture-home", plan: "scheduler", migrationId: "00000000-0000-4000-8000-000000000001",
  scopeId: "00000000-0000-4000-8000-000000000002", projectId: "00000000-0000-4000-8000-000000000003", prerequisites: { inventory: "drained original callbacks", policy: "reviewed policy", rollbackBuild: "compatible old writer" } };
let renderer: ReactTestRenderer;
const button = (label: string) => renderer.root.find(n => n.type === "Pressable" as never && n.props.accessibilityLabel === label);
const render = async (data = snapshot) => act(async () => { renderer = create(createElement(MigrationOperations, { theme, data, onRead: vi.fn() })); });
const press = async (label: string) => act(async () => button(label).props.onPress());
const fill = async (data = original) => act(async () => renderer.root.findByType("TextInput" as never).props.onChangeText(JSON.stringify(data)));
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.clearAllMocks(); });
afterEach(async () => act(async () => renderer?.unmount()));
it("view, expand, edit, review and cancel send no migration or Attach", async () => {
  await render(); await press("Migration controls"); await fill(); await press("Review migration command");
  expect(mocks.migrate).not.toHaveBeenCalled(); await press("Cancel migration change"); expect(mocks.migrate).not.toHaveBeenCalled();
});
it("explicit double press makes one call; lost reply keeps the same command for deliberate retry", async () => {
  mocks.migrate.mockRejectedValue(new Error("reply lost")); await render(); await press("Migration controls"); await fill(); await press("Review migration command");
  await act(async () => { button("Run migration prepare").props.onPress(); button("Run migration prepare").props.onPress(); });
  expect(mocks.migrate).toHaveBeenCalledExactlyOnceWith(original);
  await press("Retry this migration command"); expect(mocks.migrate.mock.calls[1]![0]).toEqual(original);
});
it("a home change cannot retarget an open reviewed command", async () => {
  await render(); await press("Migration controls"); await fill(); await press("Review migration command");
  await act(async () => renderer.update(createElement(MigrationOperations, { theme, data: { ...snapshot, homeId: "other-home" }, onRead: vi.fn() })));
  expect(button("Run migration prepare").props.disabled).toBe(true); await press("Run migration prepare"); expect(mocks.migrate).not.toHaveBeenCalled();
});
