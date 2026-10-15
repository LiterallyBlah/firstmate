import { act, createElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { PluginTheme } from "@getpaseo/plugin";

vi.mock("react-native", () => ({ Image: "Image", Pressable: "Pressable", Text: "Text", View: "View" }));
vi.mock("@getpaseo/plugin/client/ui", () => ({ SettingsRow: "SettingsRow" }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: "Icon",
  TextInput: "TextInput",
  Modal: Object.assign(({ open, children }: { open: boolean; children: ReactNode }) => (open ? children : null), {
    Content: "Content",
  }),
  FlatList: ({ data, renderItem }: { data: unknown[]; renderItem: (row: { item: unknown }) => ReactNode }) =>
    data.map((item, index) => createElement("Row", { key: index }, renderItem({ item }))),
}));
import { OptionPicker } from "./option-picker";

let renderer: ReactTestRenderer | null = null;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
});

it("offers a labelled toolbar trigger at the existing toolbar height", async () => {
  const theme = {
    colors: { foregroundMuted: "#888888", foreground: "#ffffff", surface1: "#111111", accent: "#00ffff" },
  } as PluginTheme;
  await act(async () => {
    renderer = create(
      createElement(OptionPicker, {
        inline: true,
        label: "Scene",
        title: "Deck scene",
        hint: "For the whole fleet",
        value: "ship",
        theme,
        compact: false,
        options: [{ label: "Ship", value: "ship" }],
        onSelect: vi.fn(),
      }),
    );
  });
  expect(renderer!.root.findAll((node) => (node.type as unknown) === "SettingsRow")).toHaveLength(0);
  const trigger = renderer!.root.find((node) => (node.type as unknown) === "Pressable");
  expect(trigger.props.accessibilityLabel).toBe("Scene: Ship. Change");
  expect(trigger.props.style).toContainEqual({ height: 28 });
  expect(trigger.props.accessibilityState).toMatchObject({ expanded: false });
  await act(async () => trigger.props.onPress());
  expect(trigger.props.accessibilityState).toMatchObject({ expanded: true });
  expect(
    renderer!.root
      .findAll((node) => (node.type as unknown) === "Text")
      .some((node) => node.children.includes("For the whole fleet")),
  ).toBe(true);
});

it("shows previews and incompatibility reasons without allowing an unavailable setting to be selected", async () => {
  const select = vi.fn();
  const theme = {
    colors: { foregroundMuted: "#888888", foreground: "#ffffff", surface1: "#111111", accent: "#00ffff" },
  } as PluginTheme;
  await act(async () => {
    renderer = create(
      createElement(OptionPicker, {
        label: "Deck setting",
        title: "Deck setting",
        value: "ship",
        theme,
        compact: false,
        onSelect: select,
        options: [
          { label: "Ship", value: "ship", preview: "data:image/png;base64,preview" },
          { label: "Future", value: "future", disabled: true, detail: "Needs walk-in@2" },
        ],
      }),
    );
  });
  const buttons = () => renderer!.root.findAll((node) => (node.type as unknown) === "Pressable");
  await act(async () => buttons()[0]!.props.onPress());
  expect(renderer!.root.find((node) => (node.type as unknown) === "Image").props.source.uri).toBe(
    "data:image/png;base64,preview",
  );
  const unavailable = buttons().find((node) => node.props.accessibilityLabel === "Future, Needs walk-in@2")!;
  expect(unavailable.props.disabled).toBe(true);
  expect(unavailable.props.accessibilityState).toEqual({ disabled: true, selected: false });
  await act(async () => unavailable.props.onPress());
  expect(select).not.toHaveBeenCalled();
  await act(async () =>
    buttons()
      .find((node) => node.props.accessibilityLabel === "Ship")!
      .props.onPress(),
  );
  expect(select).toHaveBeenCalledExactlyOnceWith("ship");
  expect(buttons()).toHaveLength(1);
});
