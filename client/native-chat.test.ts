import type { PluginClientContext, PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { act, createElement } from "react";
import { create } from "react-test-renderer";
import { beforeAll, expect, it, vi } from "vitest";
import { board, planTransfer, planTransferId, watch } from "../docs/native-chat-format/fixtures";

vi.mock("react-native", () => ({ Pressable: "Pressable", Text: "Text", View: "View" }));
import { MachineNote, machineNoteSchema, registerNativeChat } from "./native-chat";
import { nativeChatTransformer, nativeNoteSummary } from "./native-chat-transform";
import { bearingsMessage } from "../shared/bearings";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

it("shows only the Bearings request and collapsed watch-style disclosure until expanded", () => {
  const overview = "Open plans\n- scheduler: 1 of 2 complete; running: build; next: review.", text = bearingsMessage("Bearings, please.", overview);
  const data = nativeChatTransformer.transform({ item: { type: "user_message", text, clientMessageId: "firstmate-bearings-11111111-1111-4111-8111-111111111111" }, phase: "complete" })!.items[0]!.data;
  const props = { item: { data }, theme: { colors: { foreground: "#fff", foregroundMuted: "#aaa", surface1: "#111", surface2: "#222" } } } as PluginTimelineItemProps<{ summary: string; original: string; visible?: string }>;
  let rendered!: ReturnType<typeof create>;
  act(() => { rendered = create(createElement(MachineNote, props)); });
  try {
    expect(JSON.stringify(rendered.toJSON())).toContain("Bearings, please.");
    expect(JSON.stringify(rendered.toJSON())).not.toContain("Open plans");
    const button = rendered.root.find(n => (n.type as unknown) === "Pressable");
    expect(button.props.accessibilityState).toEqual({ expanded: false });
    act(() => button.props.onPress()); expect(JSON.stringify(rendered.toJSON())).toContain("Open plans");
    act(() => button.props.onPress()); expect(JSON.stringify(rendered.toJSON())).not.toContain("Open plans");
  } finally { act(() => rendered.unmount()); }
});

it.each([watch, board])(
  "reveals selectable original text and collapses it without changing the transform",
  (original) => {
    const props: PluginTimelineItemProps<{ summary: string; original: string }> = {
      item: {
        type: "plugin",
        kind: "firstmate-machine-note",
        version: 1,
        data: { summary: nativeNoteSummary(original)!, original },
      },
      theme: {
        colors: {
          surface0: "#000",
          surface1: "#111",
          surface2: "#222",
          foreground: "#fff",
          foregroundMuted: "#aaa",
          border: "#333",
          accent: "#0f0",
          accentForeground: "#000",
          statusSuccess: "#0f0",
          statusWarning: "#ff0",
          statusDanger: "#f00",
        },
      },
      host: { id: "host", label: "Host" },
      layout: { platform: "android", compact: true },
      agentId: "mate",
      timestamp: new Date(0),
    };
    let rendered!: ReturnType<typeof create>;
    act(() => {
      rendered = create(createElement(MachineNote, props));
    });
    try {
      const button = rendered.root.find((node) => (node.type as unknown) === "Pressable");
      const originals = () =>
        rendered.root.findAll((node) => (node.type as unknown) === "Text" && node.props.children === original);
      expect(button.props.accessibilityState).toEqual({ expanded: false });
      expect(originals()).toHaveLength(0);
      act(() => button.props.onPress());
      expect(button.props.accessibilityState).toEqual({ expanded: true });
      expect(originals()).toHaveLength(1);
      expect(originals()[0]!.props.selectable).toBe(true);
      act(() => button.props.onPress());
      expect(originals()).toHaveLength(0);
      expect(props.item.data.original).toBe(original);
    } finally {
      act(() => rendered.unmount());
    }
  },
);

it("draws a generated plan transfer note collapsed like a watch, revealing and hiding the exact original", () => {
  const output = nativeChatTransformer.transform({ item: { type: "user_message", text: planTransfer, clientMessageId: `firstmate-plan-${planTransferId}` }, phase: "complete" })!;
  const data = machineNoteSchema.parse(output.items[0]!.data);
  const props = { item: { data }, theme: { colors: { foreground: "#fff", foregroundMuted: "#aaa", surface1: "#111", surface2: "#222" } } } as PluginTimelineItemProps<{ summary: string; original: string; visible?: string }>;
  let rendered!: ReturnType<typeof create>;
  act(() => { rendered = create(createElement(MachineNote, props)); });
  try {
    const texts = () => rendered.root.findAll(n => (n.type as unknown) === "Text").map(n => n.props.children);
    const button = rendered.root.find(n => (n.type as unknown) === "Pressable");
    expect(texts()).toEqual(["Plan owner transferred · ariadne-character-dialogue-scout", "Show original"]);
    expect(button.props.accessibilityLabel).toBe("Show original: Plan owner transferred · ariadne-character-dialogue-scout");
    act(() => button.props.onPress());
    expect(texts()).toEqual(["Plan owner transferred · ariadne-character-dialogue-scout", "Hide original", planTransfer]);
    act(() => button.props.onPress());
    expect(texts()).not.toContain(planTransfer);
  } finally { act(() => rendered.unmount()); }
});

it("registers the matching schema and component and disposes both contributions", () => {
  const removals: string[] = [];
  const addTimelineTransformer = vi.fn(() => () => {
    removals.push("transformer");
  });
  const addTimelineRenderer = vi.fn(() => () => {
    removals.push("renderer");
  });
  const stop = registerNativeChat({ addTimelineTransformer, addTimelineRenderer } as unknown as PluginClientContext);
  expect(addTimelineTransformer).toHaveBeenCalledExactlyOnceWith(nativeChatTransformer);
  expect(addTimelineRenderer).toHaveBeenCalledTimes(2);
  expect(addTimelineRenderer).toHaveBeenCalledWith({
    kind: "firstmate-machine-note",
    version: 1,
    schema: machineNoteSchema,
    Component: MachineNote,
  });
  expect(machineNoteSchema.safeParse({ summary: "Missing original" }).success).toBe(false);
  stop();
  expect(removals).toEqual(["renderer", "transformer", "renderer"]);
});
