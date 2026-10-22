import { act, createElement, type ComponentProps } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { attentionCard, attentionRequest, attentionSnapshot, attentionTheme } from "../test/attention-deck-fixture";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import { drafts } from "./draft";
import { pendingAttachments } from "./attachments";

const state = vi.hoisted(() => ({ snapshot: null as NeedsYouSnapshot | null, send: vi.fn(), focus: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "web" }, ...Object.fromEntries(["View", "Text", "Pressable", "ScrollView", "SafeAreaView", "Image"].map(name => [name, name])) }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => async () => ({}), openExternalUrl() {} }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ TextInput: "TextInput", Icon: () => null, useToast: () => ({ error() {} }) }));
vi.mock("./needs-you-query", () => ({ useNeedsYou: () => ({ data: state.snapshot, error: null }) }));
vi.mock("./use-timeline", () => ({ useAgentTimeline: () => ({ entries: [], error: null, hasOlder: false, loading: false }) }));
vi.mock("./permission-card", () => ({ usePendingRequests: () => ({ pending: [], respond() {} }), PermissionCard: () => null }));
vi.mock("./follow-end", () => ({ useFollowEnd: () => ({ scrollProps: {}, away: false, pin() {} }) }));
vi.mock("./keyboard", () => ({ useKeyboardOverlap: () => 0 }));
vi.mock("./workspace-file-link", () => ({ useWorkspaceFileLink: () => ({ dialog: null }) }));
vi.mock("./mate-send", () => ({ useMateSender: () => ({ send: state.send, sending: false, command: state.send }) }));
vi.mock("./mate-controls", () => ({ MateControls: () => null }));
vi.mock("./markdown", () => ({ Markdown: () => null }));
vi.mock("./decision-raised-card", () => ({ DecisionRaisedCard: () => null }));
vi.mock("./decision-answer-bubble", () => ({ DecisionAnswerBubble: () => null }));
vi.mock("./message-copy", () => ({ MessageCopy: () => null }));
vi.mock("./chat-image", () => ({ ChatImage: () => null }));
vi.mock("./web", () => ({ cacheSentImages() {}, canAttachFiles: false, receiveFiles: () => () => {} }));
vi.mock("./ui", () => ({
  MONOSPACE: "monospace", Spinner: () => null, JumpToEnd: () => null,
  IconButton: (props: { label: string; onPress(): void }) => createElement("Pressable", { accessibilityLabel: props.label, onPress: props.onPress }),
}));
import { MateChat } from "./chat";

let renderer: ReactTestRenderer;
let client: QueryClient;
const mate = attentionCard("chat-test-mate", "idle").agent!;
const reference = { mateId: mate.id, homeId: "sample-home", requestId: "local:release", recordRevision: 1 };
const onReturnDecision = vi.fn();
const props: ComponentProps<typeof MateChat> = { mate, theme: attentionTheme, compact: false, onChanged() {}, onOpenFile() {}, discussion: reference, onReturnDecision };
async function render() {
  state.snapshot = attentionSnapshot([attentionRequest("release")]);
  client = new QueryClient();
  await act(async () => {
    renderer = create(createElement(QueryClientProvider, { client }, createElement(MateChat, props)), {
      createNodeMock: element => element.type === "TextInput" ? { focus: state.focus } : null,
    });
  });
}
afterEach(async () => {
  await act(async () => renderer?.unmount()); client?.clear();
  drafts.set(mate.id, ""); pendingAttachments.set(mate.id, []); vi.clearAllMocks();
});

it("focuses the real composer and offers a return while preserving its existing words and attachment", async () => {
  drafts.set(mate.id, "Keep my unfinished question");
  const file = { id: "f", kind: "file" as const, fileName: "notes.txt", mimeType: "text/plain", size: 5, data: "aGVsbG8=" };
  pendingAttachments.set(mate.id, [file]);
  await render();
  expect(state.focus).toHaveBeenCalledOnce();
  expect(renderer.root.findByType("TextInput" as never).props.value).toBe("Keep my unfinished question");
  expect(pendingAttachments.get(mate.id)).toEqual([file]);
  await act(async () => renderer.root.findByProps({ accessibilityLabel: "Back to the decision: release" }).props.onPress());
  expect(onReturnDecision).toHaveBeenCalledOnce();
  expect(state.send).not.toHaveBeenCalled();
});

it("removes the return action when the reference becomes stale without changing the draft", async () => {
  drafts.set(mate.id, "About «release»: ");
  await render();
  state.snapshot!.requests[0]!.revision++;
  await act(async () => renderer.update(createElement(QueryClientProvider, { client }, createElement(MateChat, props))));
  expect(renderer.root.findAllByProps({ accessibilityLabel: "Back to the decision: release" })).toHaveLength(0);
  expect(renderer.root.findByType("TextInput" as never).props.value).toBe("About «release»: ");
  expect(state.send).not.toHaveBeenCalled();
});
