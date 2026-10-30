import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { displaySettings } from "../shared/settings";

const state = vi.hoisted(() => ({ display: {} as Record<string, unknown>, save: vi.fn(), error: vi.fn() }));
vi.mock("react-native", () => ({ ScrollView: "ScrollView", Text: "Text", Platform: { OS: "web" } }));
vi.mock("@getpaseo/plugin/client", () => ({ useSettings: () => state.display, useRpc: () => vi.fn() }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ useToast: () => ({ error: state.error }) }));
vi.mock("@getpaseo/plugin/client/ui", () => ({
  SettingsGroup: "SettingsGroup", SettingsSection: "SettingsSection", SettingsRow: "SettingsRow",
  SettingsAction: "SettingsAction", SettingsInput: "SettingsInput", SettingsSelect: "SettingsSelect", SettingsSwitch: "SettingsSwitch",
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({}), useQueryClient: () => ({}) }));
vi.mock("./fleet", () => ({ useFleet: () => ({}), FLEET_QUERY_KEY: [] }));
vi.mock("./task-layout", () => ({ useTaskLayout: () => ({ values: { mode: "summary" } }) }));
vi.mock("./deck-setting-query", () => ({ useDeckSettings: () => ({}) }));
vi.mock("./models", () => ({ useModeOptions: () => [], useModelOptions: () => ({ options: [] }), withCurrent: () => [] }));
vi.mock("./option-picker", () => ({ OptionPicker: "OptionPicker" }));
vi.mock("./workflow-plans", () => ({ WorkflowSurface: ({ children }: { children: unknown }) => children }));
vi.mock("./work-details", () => ({ WorkDetails: "WorkDetails" }));
vi.mock("./ui", () => ({ errorText: (error: unknown) => String(error) }));
import { SettingsScreen } from "./settings-screen";

let renderer: ReactTestRenderer | null = null;
const props = { theme: { colors: {} }, layout: { compact: false } } as PluginSurfaceProps;
const toggle = () => renderer!.root.findByProps({ label: "Hide workers on disconnected hosts" });
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  state.save.mockReset().mockResolvedValue(true);
  state.error.mockReset();
  state.display = { status: "ready", values: displaySettings.schema.parse({ density: "compact" }), revision: 7, save: state.save };
});
afterEach(() => { act(() => renderer?.unmount()); renderer = null; });

it("queues messages by default and saves turning the behavior off at the displayed revision", async () => {
  await act(async () => { renderer = create(createElement(SettingsScreen, props)); });
  const messages = renderer!.root.findByProps({ label: "Queue messages while busy" });
  expect(messages.props.value).toBe(true);
  await act(async () => messages.props.onValueChange(false));
  expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ queueMessagesWhileBusy: false }), 7);
});

it("shows the default and saves the switch in the host display document at its revision", async () => {
  await act(async () => { renderer = create(createElement(SettingsScreen, props)); });
  expect(toggle().props.value).toBe(true);
  await act(async () => toggle().props.onValueChange(false));
  expect(state.save).toHaveBeenCalledExactlyOnceWith({ ...(state.display.values as object), hideDisconnectedWorkers: false }, 7);
  state.display.values = displaySettings.schema.parse({ ...(state.display.values as object), hideDisconnectedWorkers: false });
  await act(async () => { renderer!.unmount(); renderer = create(createElement(SettingsScreen, props)); });
  expect(toggle().props.value).toBe(false);
});

it("leaves visibility unchanged after a refused or failed save and waits for valid settings", async () => {
  await act(async () => { renderer = create(createElement(SettingsScreen, props)); });
  state.save.mockResolvedValueOnce(false);
  await act(async () => toggle().props.onValueChange(false));
  expect(state.error).toHaveBeenCalledWith("The worker visibility setting was not saved.");
  expect(toggle().props.value).toBe(true);
  state.save.mockRejectedValueOnce(new Error("offline"));
  await act(async () => toggle().props.onValueChange(false));
  expect(state.error).toHaveBeenCalledTimes(2);
  state.display.status = "invalid";
  await act(async () => renderer!.update(createElement(SettingsScreen, props)));
  expect(toggle().props.disabled).toBe(true);
  await act(async () => toggle().props.onValueChange(false));
  expect(state.save).toHaveBeenCalledTimes(2);
});
