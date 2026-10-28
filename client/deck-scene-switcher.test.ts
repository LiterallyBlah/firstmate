import { act, createElement, StrictMode, type ComponentProps } from "react";
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
  reload: vi.fn(),
}));
vi.mock("@getpaseo/plugin/client", () => ({ useSettings: () => state.display }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ useToast: () => ({ error: state.error }) }));
vi.mock("./deck-setting-query", () => ({ useDeckSettings: () => state.installed }));
vi.mock("./option-picker", () => ({ OptionPicker: "OptionPicker" }));
import { DeckSceneSwitcher, useDeckSceneSwitcher } from "./deck-scene-switcher";

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
  state.reload.mockReset().mockResolvedValue(undefined);
  state.error.mockReset();
  state.display = {
    status: "ready",
    values: displaySettings.schema.parse({ density: "compact" }),
    revision: "revision-7",
    save: state.save,
    reload: state.reload,
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
  expect(state.save).toHaveBeenCalledExactlyOnceWith({ ...(state.display.values as object), deckSetting: "studio" }, "revision-7");
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

it("reloads an externally replaced document and retries only the scene against its fresh revision", async () => {
  const before = state.display.values as object;
  const restored = displaySettings.schema.parse({ deckSetting: "office", density: "comfortable", pollSeconds: 30 });
  state.save.mockResolvedValueOnce(false);
  state.reload.mockImplementation(async () => {
    // reload returns void: the new hook snapshot arrives only on the next render.
    state.display = { ...state.display, values: restored, revision: "restored-8" };
  });
  await act(async () => { renderer = create(view()); });
  await act(async () => picker().onSelect("studio"));
  expect(state.reload).toHaveBeenCalledTimes(1);
  expect(state.save.mock.calls).toEqual([
    [{ ...before, deckSetting: "studio" }, "revision-7"],
    [{ ...restored, deckSetting: "studio" }, "restored-8"],
  ]);
  expect(state.error).not.toHaveBeenCalled();
  expect(picker().disabled).toBe(false);
});

it("stops after a second conflict and leaves the fresh choice visible with an error", async () => {
  state.save.mockResolvedValue(false);
  state.reload.mockImplementation(async () => {
    state.display = { ...state.display, values: displaySettings.schema.parse({ deckSetting: "office" }), revision: "restored-8" };
  });
  await act(async () => { renderer = create(view()); });
  await act(async () => picker().onSelect("studio"));
  expect(state.save).toHaveBeenCalledTimes(2);
  expect(state.reload).toHaveBeenCalledTimes(1);
  expect(state.error).toHaveBeenCalledExactlyOnceWith("The scene was not saved. Please try again.");
  expect(picker().value).toBe("office");
  expect(picker().disabled).toBe(false);
});

it("reports a failed refresh without retrying a stale save", async () => {
  state.save.mockResolvedValue(false);
  state.reload.mockRejectedValue(new Error("Disconnected"));
  await act(async () => { renderer = create(view()); });
  await act(async () => picker().onSelect("studio"));
  expect(state.reload).toHaveBeenCalledTimes(1);
  expect(state.save).toHaveBeenCalledTimes(1);
  expect(state.error).toHaveBeenCalledTimes(1);
  expect(picker().disabled).toBe(false);
});

it("refreshes external settings at the configured interval and stops when unmounted", async () => {
  vi.useFakeTimers();
  try {
    state.reload.mockImplementation(async () => {
      state.display = { ...state.display, values: displaySettings.schema.parse({ deckSetting: "studio" }), revision: "restored-8" };
      renderer!.update(view());
    });
    await act(async () => { renderer = create(view()); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(state.reload).toHaveBeenCalledTimes(1);
    expect(picker().value).toBe("studio");
    await act(async () => { renderer!.unmount(); renderer = null; });
    await vi.advanceTimersByTimeAsync(10000);
    expect(state.reload).toHaveBeenCalledTimes(1);
    expect(state.save).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

it("keeps one selection in flight through refresh and retries once under StrictMode", async () => {
  let release!: () => void;
  state.save.mockResolvedValueOnce(false);
  state.reload.mockImplementation(() => new Promise<void>(resolve => {
    release = () => {
      state.display = { ...state.display, revision: "restored-8", values: displaySettings.schema.parse({ pollSeconds: 30 }) };
      resolve();
    };
  }));
  await act(async () => { renderer = create(createElement(StrictMode, null, view())); });
  await act(async () => picker().onSelect("studio"));
  expect(picker().disabled).toBe(true);
  await act(async () => picker().onSelect("office"));
  expect(state.save).toHaveBeenCalledTimes(1);
  await act(async () => release());
  expect(state.save).toHaveBeenCalledTimes(2);
  expect(state.save.mock.calls[1]).toEqual([{ ...state.display.values as object, deckSetting: "studio" }, "restored-8"]);
  expect(state.error).not.toHaveBeenCalled();
});

it("accepts a refreshed document already at the requested scene without another write", async () => {
  state.save.mockResolvedValueOnce(false);
  state.reload.mockImplementation(async () => {
    state.display = { ...state.display, revision: "restored-8", values: displaySettings.schema.parse({ deckSetting: "studio" }) };
  });
  await act(async () => { renderer = create(view()); });
  await act(async () => picker().onSelect("studio"));
  expect(state.save).toHaveBeenCalledTimes(1);
  expect(picker().value).toBe("studio");
  expect(picker().disabled).toBe(false);
  expect(state.error).not.toHaveBeenCalled();
});

it("does not retry after unmounting during the conflict refresh", async () => {
  let release!: () => void;
  state.save.mockResolvedValue(false);
  state.reload.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
  await act(async () => { renderer = create(view()); });
  await act(async () => picker().onSelect("studio"));
  await act(async () => { renderer!.unmount(); renderer = null; });
  await act(async () => release());
  expect(state.save).toHaveBeenCalledTimes(1);
  expect(state.error).not.toHaveBeenCalled();
});

it("cancels a pending retry when leaving Deck even after returning before the read settles", async () => {
  let enabled = true;
  let release!: () => void;
  function Controller() {
    const scene = useDeckSceneSwitcher({ theme: {} as PluginTheme, enabled,
      display: state.display as Parameters<typeof useDeckSceneSwitcher>[0]["display"] });
    return enabled ? scene.picker : null;
  }
  state.save.mockResolvedValueOnce(false);
  state.reload.mockImplementation(() => new Promise<void>(resolve => { release = () => {
    state.display = { ...state.display, revision: "restored-9", values: displaySettings.schema.parse({ deckSetting: "office" }) };
    resolve();
  }; }));
  await act(async () => { renderer = create(createElement(Controller)); });
  await act(async () => picker().onSelect("studio"));
  enabled = false;
  await act(async () => renderer!.update(createElement(Controller)));
  enabled = true;
  await act(async () => renderer!.update(createElement(Controller)));
  await act(async () => release());
  // The host hook publishes the completed read independently of the cancelled attempt.
  await act(async () => renderer!.update(createElement(Controller)));
  expect(state.save).toHaveBeenCalledTimes(1);
  expect(picker().value).toBe("office");
  expect(picker().disabled).toBe(false);
  expect(state.error).not.toHaveBeenCalled();
});

it("does not rebase a retry past the first revision observed after the refused save", async () => {
  let release!: () => void;
  state.save.mockResolvedValueOnce(false);
  state.reload.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
  await act(async () => { renderer = create(view()); });
  await act(async () => picker().onSelect("studio"));
  state.display = { ...state.display, revision: "restored-8", values: displaySettings.schema.parse({ deckSetting: "office" }) };
  await act(async () => renderer!.update(view()));
  state.display = { ...state.display, revision: "restored-9", values: displaySettings.schema.parse({ deckSetting: "ship" }) };
  await act(async () => renderer!.update(view()));
  await act(async () => release());
  expect(state.save).toHaveBeenCalledTimes(1);
  expect(picker().value).toBe("ship");
  expect(state.error).toHaveBeenCalledExactlyOnceWith("The scene was not saved. Please try again.");
});

it("cancels synchronously and keeps an abandoned read from finishing a new selection", async () => {
  let controller!: ReturnType<typeof useDeckSceneSwitcher>;
  let finishRead!: () => void, finishSave!: (ok: boolean) => void;
  function Controller() {
    controller = useDeckSceneSwitcher({ theme: {} as PluginTheme,
      display: state.display as Parameters<typeof useDeckSceneSwitcher>[0]["display"] });
    return controller.picker;
  }
  state.save.mockResolvedValueOnce(false).mockImplementationOnce(() => new Promise<boolean>(resolve => { finishSave = resolve; }));
  state.reload.mockImplementation(() => new Promise<void>(resolve => { finishRead = resolve; }));
  await act(async () => { renderer = create(createElement(Controller)); });
  await act(async () => picker().onSelect("studio"));
  await act(async () => {
    // Fleet navigation cancels at the event, including a leave/return batched
    // before the next render, when enabled never becomes false in an effect.
    controller.cancel();
    picker().onSelect("office");
  });
  await act(async () => finishRead());
  expect(state.save).toHaveBeenCalledTimes(2);
  expect(state.reload).toHaveBeenCalledTimes(1);
  expect(picker().disabled).toBe(true);
  await act(async () => finishSave(true));
  expect(picker().disabled).toBe(false);
  expect(state.error).not.toHaveBeenCalled();
});

it("cancels before a refused initial save settles and stops polling while away from Deck", async () => {
  vi.useFakeTimers();
  try {
    let enabled = true;
    let finishSave!: (ok: boolean) => void;
    function Controller() {
      return useDeckSceneSwitcher({ theme: {} as PluginTheme, enabled,
        display: state.display as Parameters<typeof useDeckSceneSwitcher>[0]["display"] }).picker;
    }
    state.save.mockImplementation(() => new Promise<boolean>(resolve => { finishSave = resolve; }));
    await act(async () => { renderer = create(createElement(Controller)); });
    await act(async () => picker().onSelect("studio"));
    enabled = false;
    await act(async () => renderer!.update(createElement(Controller)));
    await act(async () => finishSave(false));
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(state.save).toHaveBeenCalledTimes(1);
    expect(state.reload).not.toHaveBeenCalled();
    expect(state.error).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

it.each(["unreadable", "incompatible"])("refuses a retry when the refreshed choice is %s", async (problem) => {
  state.save.mockResolvedValue(false);
  state.reload.mockImplementation(async () => {
    state.display = { ...state.display, revision: "restored-8", ...(problem === "unreadable" ? { status: "invalid" } : {}) };
    if (problem === "incompatible") state.installed.data = [pack("studio", false)];
  });
  await act(async () => { renderer = create(view()); });
  await act(async () => picker().onSelect("studio"));
  expect(state.save).toHaveBeenCalledTimes(1);
  expect(state.error).toHaveBeenCalledTimes(1);
});

it("reports unreadable refreshed settings even when Home falls back away from Deck", async () => {
  function HomeController() {
    return useDeckSceneSwitcher({ theme: {} as PluginTheme, enabled: state.display.status === "ready",
      display: state.display as Parameters<typeof useDeckSceneSwitcher>[0]["display"] }).picker;
  }
  state.save.mockResolvedValue(false);
  state.reload.mockImplementation(async () => { state.display = { ...state.display, status: "invalid" }; });
  await act(async () => { renderer = create(createElement(HomeController)); });
  await act(async () => picker().onSelect("studio"));
  expect(state.save).toHaveBeenCalledTimes(1);
  expect(state.error).toHaveBeenCalledExactlyOnceWith("The scene was not saved. Please try again.");
});

it("keeps passive refreshes from overlapping or interrupting a scene save", async () => {
  vi.useFakeTimers();
  try {
    let finishRead!: () => void, finishSave!: (ok: boolean) => void;
    state.reload.mockImplementation(() => new Promise<void>(resolve => { finishRead = resolve; }));
    state.save.mockImplementation(() => new Promise<boolean>(resolve => { finishSave = resolve; }));
    await act(async () => { renderer = create(view()); });
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(state.reload).toHaveBeenCalledTimes(1);
    await act(async () => finishRead());
    await act(async () => picker().onSelect("studio"));
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(state.reload).toHaveBeenCalledTimes(1);
    await act(async () => finishSave(true));
  } finally { vi.useRealTimers(); }
});
