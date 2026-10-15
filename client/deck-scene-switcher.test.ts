import { act, createElement, type ComponentProps } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { PluginTheme } from "@getpaseo/plugin";
import type { DeckSettingSummary } from "../shared/deck-rpc";
import { displaySettings } from "../shared/settings";
import type { OptionPicker } from "./option-picker";

const state = vi.hoisted(() => ({
  display: {} as Record<string, unknown>,
  installed: { data: undefined as DeckSettingSummary[] | undefined, isError: false },
  error: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@getpaseo/plugin/client", () => ({ useSettings: () => state.display }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ useToast: () => ({ error: state.error }) }));
vi.mock("./deck-setting-query", () => ({ useDeckSettings: () => state.installed }));
vi.mock("./option-picker", () => ({ OptionPicker: "OptionPicker" }));
import { DeckSceneSwitcher } from "./deck-scene-switcher";

let renderer: ReactTestRenderer | null = null;
const view = () => createElement(DeckSceneSwitcher, { theme: {} as PluginTheme });
const picker = () =>
  renderer!.root.find((node) => (node.type as unknown) === "OptionPicker").props as ComponentProps<typeof OptionPicker>;
const pack = (id: string, compatible = true): DeckSettingSummary => ({
  id,
  name: id,
  compatible,
  reason: compatible ? null : "Needs walk-in@2",
  version: "1.0.0",
  formatVersion: 1,
  preview: null,
  bytes: 0,
});
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  state.save.mockReset().mockResolvedValue(true);
  state.error.mockReset();
  state.display = {
    status: "ready",
    values: displaySettings.schema.parse({ density: "compact" }),
    revision: 7,
    save: state.save,
  };
  state.installed = { data: [pack("ship"), pack("office"), pack("studio"), pack("future", false)], isError: false };
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
});

it("discovers future packs and saves a compatible scene in the global document at its revision", async () => {
  await act(async () => {
    renderer = create(view());
  });
  expect(picker().inline).toBe(true);
  expect(picker().options.map((option) => option.value)).toEqual(["ship", "office", "studio", "future"]);
  expect(picker().options.at(-1)).toMatchObject({ disabled: true, detail: "Needs walk-in@2" });
  await act(async () => picker().onSelect("studio"));
  expect(state.save).toHaveBeenCalledExactlyOnceWith({ ...(state.display.values as object), deckSetting: "studio" }, 7);
  // Selection follows the host document, including remounts and another settings screen/device.
  state.display.values = { ...(state.display.values as object), deckSetting: "studio" };
  await act(async () => renderer!.update(view()));
  expect(picker().value).toBe("studio");
  await act(async () => {
    renderer!.unmount();
    renderer = create(view());
  });
  expect(picker().value).toBe("studio");
});

it("rejects missing, incompatible and unchanged choices, and waits for metadata and settings", async () => {
  await act(async () => {
    renderer = create(view());
  });
  for (const id of ["missing", "future", "ship"]) await act(async () => picker().onSelect(id));
  state.installed.data = undefined;
  await act(async () => renderer!.update(view()));
  expect(picker().disabled).toBe(true);
  await act(async () => picker().onSelect("office"));
  state.installed.data = [pack("office")];
  state.display.status = "loading";
  await act(async () => renderer!.update(view()));
  expect(picker().disabled).toBe(true);
  await act(async () => picker().onSelect("office"));
  expect(state.save).not.toHaveBeenCalled();
});

it("serializes selection and reports a refused save without claiming the choice was persisted", async () => {
  let finish!: (ok: boolean) => void;
  state.save.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    renderer = create(view());
  });
  await act(async () => {
    picker().onSelect("office");
    picker().onSelect("studio");
  });
  expect(picker().disabled).toBe(true);
  expect(state.save).toHaveBeenCalledTimes(1);
  await act(async () => finish(false));
  expect(picker().disabled).toBe(false);
  expect(picker().value).toBe("ship");
  expect(state.error).toHaveBeenCalledWith("The scene was not saved. Please try again.");
});

it("reports a rejected save and permits retry", async () => {
  state.save.mockRejectedValueOnce(new Error("Disconnected"));
  await act(async () => {
    renderer = create(view());
  });
  await act(async () => picker().onSelect("office"));
  expect(state.error).toHaveBeenCalledTimes(1);
  expect(picker().disabled).toBe(false);
  await act(async () => picker().onSelect("office"));
  expect(state.save).toHaveBeenCalledTimes(2);
});
