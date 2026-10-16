import type { PluginClientContext, PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { act, createElement } from "react";
import { create } from "react-test-renderer";
import { beforeAll, expect, it, vi } from "vitest";
import { board, watch } from "../docs/native-chat-format/fixtures";

vi.mock("react-native", () => ({ Pressable: "Pressable", Text: "Text", View: "View" }));
import { MachineNote, machineNoteSchema, registerNativeChat } from "./native-chat";
import { nativeChatTransformer, nativeNoteSummary } from "./native-chat-transform";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
  expect(addTimelineRenderer).toHaveBeenCalledExactlyOnceWith({
    kind: "firstmate-machine-note",
    version: 1,
    schema: machineNoteSchema,
    Component: MachineNote,
  });
  expect(machineNoteSchema.safeParse({ summary: "Missing original" }).success).toBe(false);
  stop();
  expect(removals).toEqual(["transformer", "renderer"]);
});
