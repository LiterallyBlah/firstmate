import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { attentionSnapshot, attentionTheme } from "../test/attention-deck-fixture";
import { decisionSession, newDecisionBatch } from "./needs-you-state";

vi.mock("react-native", () => ({ Pressable: "Pressable", Text: "Text", View: "View" }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: "Icon" }));
vi.mock("./web", () => ({
  webAttributes: () => ({}),
  webSurfaceVisible: (target: { visible: boolean } | null) => !!target?.visible,
}));
import { NeedsYouIndicator, useDecisionVisibility } from "./needs-you";

it("keeps toast suppression tied to Deck visibility without a pill and cleans up on unmount", async () => {
  const client = new QueryClient(), session = decisionSession(client);
  const target = { visible: true };
  function DeckHeading({ enabled }: { enabled: boolean }) {
    useDecisionVisibility(enabled).current = target;
    return createElement("Text", null, "Deck");
  }
  const tree = (enabled: boolean) => createElement(QueryClientProvider, { client },
    createElement(DeckHeading, { enabled }));
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(tree(true)); });
  try {
    expect(session.surfaces.size).toBe(1);
    newDecisionBatch(session, attentionSnapshot([]));
    expect(newDecisionBatch(session, attentionSnapshot())).toEqual([]);
    target.visible = false;
    newDecisionBatch(session, attentionSnapshot([]));
    expect(newDecisionBatch(session, attentionSnapshot())).toHaveLength(1);
    await act(async () => { renderer.update(tree(false)); });
    expect(session.surfaces.size).toBe(0);
    await act(async () => { renderer.update(tree(true)); });
    expect(session.surfaces.size).toBe(1);
  } finally {
    await act(async () => renderer.unmount());
    client.clear();
  }
  expect(session.surfaces.size).toBe(0);
});

it.each([false, true])("keeps other views' empty and counted pills clickable (compact=%s)", async compact => {
  const client = new QueryClient(), onOpen = vi.fn();
  const tree = (empty: boolean) => createElement(QueryClientProvider, { client },
    createElement(NeedsYouIndicator, {
      theme: attentionTheme, snapshot: empty ? attentionSnapshot([]) : attentionSnapshot(), compact, onOpen,
    }));
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(tree(true)); });
  try {
    expect(JSON.stringify(renderer.toJSON())).toContain("Nothing needs you");
    renderer.root.findByProps({ accessibilityRole: "button" }).props.onPress();
    expect(onOpen).toHaveBeenLastCalledWith({ requestId: "next", homeId: "sample-home" }, expect.any(String));
    await act(async () => renderer.update(tree(false)));
    expect(JSON.stringify(renderer.toJSON())).toContain("Needs you · 2");
    renderer.root.findByProps({ accessibilityRole: "button" }).props.onPress();
    expect(onOpen).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => renderer.unmount());
    client.clear();
  }
});
