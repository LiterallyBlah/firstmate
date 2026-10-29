import { act, createElement, type ComponentProps } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { attentionCard, attentionRequest, attentionSnapshot, attentionTheme } from "../test/attention-deck-fixture";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import type { WorkflowSnapshot } from "../shared/workflow-rpc";
import type { TimelineEntry } from "./transcript-rows";
import { compactPlansFixture } from "../test/compact-plans-fixture";
import { drafts } from "./draft";
import { pendingAttachments } from "./attachments";
import type { ScopeSnapshot } from "../shared/supervision-rpc";
import { scopeUiKey } from "./draft";
const scopeFixture: ScopeSnapshot = { homeId: "/home", sequence: 1, freshness: "current", asOf: "2026-10-29T09:00:00Z", uiEnabled: true, executionEnabled: true, problems: [], projects: [], scopes: [{
  id: "project-mate", kind: "project", title: "Reader mate", aliases: [], planId: null, discussionOnly: true,
  target: { homeId: "/home", scopeId: "project-mate", scopeVersion: 1, epoch: 1, agentId: "project-agent" },
  hostId: "local", workspaceId: "project-workspace", state: "active", coverage: "complete", session: "dormant", observedAt: null,
  lastEffectFailure: null, goals: [], activeWorkers: 0, activeEffects: 0, uncertainEffects: 0,
}] };

const state = vi.hoisted(() => ({ snapshot: null as NeedsYouSnapshot | null, plans: undefined as WorkflowSnapshot | undefined, entries: [] as TimelineEntry[], scopes: undefined as ScopeSnapshot | undefined, scopeError: null as Error | null, keyboard: 0, keepAtEnd: vi.fn(), openPlan: vi.fn(), send: vi.fn(), focus: vi.fn() }));
vi.mock("./scope-query", () => ({ useScopeSnapshot: () => ({ data: state.scopes, error: state.scopeError, refetch: vi.fn() }) }));
vi.mock("./scope-discussion", () => ({ ScopeDiscussion: (props: object) => createElement("ScopeDiscussion", props) }));
vi.mock("react-native", () => ({ Platform: { OS: "web" }, ...Object.fromEntries(["View", "Text", "Pressable", "ScrollView", "SafeAreaView", "Image"].map(name => [name, name])) }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => async () => ({}), openExternalUrl() {} }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ TextInput: "TextInput", Icon: () => null, useToast: () => ({ error() {} }) }));
vi.mock("./needs-you-query", () => ({ useNeedsYou: () => ({ data: state.snapshot, error: null }) }));
vi.mock("./use-timeline", () => ({ useAgentTimeline: () => ({ entries: state.entries, error: null, hasOlder: false, loading: false }) }));
vi.mock("./workflow-plans", () => ({ useWorkflowPlans: () => ({ snapshot: state.plans, open: state.openPlan }) }));
vi.mock("./permission-card", () => ({ usePendingRequests: () => ({ pending: [], respond() {} }), PermissionCard: () => null }));
vi.mock("./follow-end", () => ({ useFollowEnd: () => ({ scrollProps: {}, away: false, pin() {}, keepAtEnd: state.keepAtEnd }) }));
vi.mock("./keyboard", () => ({ useKeyboardOverlap: () => state.keyboard }));
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
  state.plans = undefined; state.entries = [];
  state.scopes = undefined; state.scopeError = null;
  state.keyboard = 0;
  drafts.set(scopeUiKey("local", "/home"), "");
});

it.each([false, true])("opens one compact plan-ready reference from the actual chat (compact %s)", async compact => {
  const plan = structuredClone(compactPlansFixture()[0]!);
  plan.status = "review"; plan.definition.implicit = false;
  plan.history = [{ revision: 1, at: "2026-10-23T12:00:00Z", by: "mate", reason: "draft" }];
  state.plans = { homeId: "home", version: "1", plans: [plan], subjects: {}, now: [], comingUp: [] };
  state.entries = [{ seqStart: 1, timestamp: "2026-10-23T11:00:00Z", item: { type: "user_message", text: "Please draft a plan" } }] as unknown as TimelineEntry[];
  client = new QueryClient();
  const chat = () => createElement(QueryClientProvider, { client }, createElement(MateChat, { ...props, compact, mateSince: "2026-10-23T10:00:00Z" }));
  await act(async () => { renderer = create(chat()); });
  const label = `Review plan: ${plan.definition.title}`;
  expect(renderer.root.findAllByProps({ accessibilityLabel: label })).toHaveLength(1);
  state.plans = structuredClone(state.plans);
  await act(async () => renderer.update(chat()));
  expect(renderer.root.findAllByProps({ accessibilityLabel: label })).toHaveLength(1);
  await act(async () => renderer.root.findByProps({ accessibilityLabel: label }).props.onPress());
  expect(state.openPlan).toHaveBeenCalledWith(plan.definition.id);
  expect(state.send).not.toHaveBeenCalled();
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

it("keeps the original chat through late enablement and old scope preference, then returns from only an explicit target", async () => {
  drafts.set(mate.id, "Unfinished General draft");
  const file = { id: "f", kind: "file" as const, fileName: "notes.txt", mimeType: "text/plain", size: 5, data: "aGVsbG8=" };
  pendingAttachments.set(mate.id, [file]);
  await render();
  const inputValue = renderer.root.findByType("TextInput" as never).props.value;
  state.scopes = structuredClone(scopeFixture) as ScopeSnapshot;
  state.scopes.uiEnabled = true;
  const contextual = state.scopes.scopes.find(s => s.kind !== "general")!;
  const chatProps = { ...props, discussion: null, imageContext: { serverId: "local", home: "/home" } };
  const tree = (scopeRequest?: { homeId: string; scopeId: string; navigationId?: string }) => createElement(QueryClientProvider, { client }, createElement(MateChat, { ...chatProps, scopeRequest }));
  drafts.set(scopeUiKey("local", "/home"), "enabled");
  await act(async () => renderer.update(tree()));
  expect(renderer.root.findAllByType("ScopeDiscussion" as never)).toHaveLength(0);
  expect(renderer.root.findByType("TextInput" as never).props.value).toBe(inputValue);
  await act(async () => renderer.update(tree({ homeId: state.scopes!.homeId, scopeId: contextual.id })));
  expect(renderer.root.findByType("ScopeDiscussion" as never).props.initialScope).toBe(contextual.id);
  // General stays mounted, preserving attachments, disclosures, pagination and scroll refs.
  expect(renderer.root.findByType("TextInput" as never).props.value).toBe("Unfinished General draft");
  await act(async () => renderer.root.findByProps({ accessibilityLabel: "Back to FirstMate" }).props.onPress());
  expect(renderer.root.findAllByType("ScopeDiscussion" as never)).toHaveLength(0);
  expect(state.focus).toHaveBeenCalled();
  expect(pendingAttachments.get(mate.id)).toEqual([file]);
  await act(async () => renderer.update(tree({ homeId: state.scopes!.homeId, scopeId: contextual.id, navigationId: "second-explicit-open" })));
  expect(renderer.root.findByType("ScopeDiscussion" as never).props.initialScope).toBe(contextual.id);
  expect(state.send).not.toHaveBeenCalled();
});

it.each(["unavailable", "cross-home"])("keeps a restored %s route scoped until an explicit return", async kind => {
  await render();
  state.scopes = structuredClone(scopeFixture) as ScopeSnapshot;
  state.scopes.uiEnabled = true;
  const request = { scopeId: "missing-recipient", homeId: kind === "cross-home" ? "other-home" : state.scopes.homeId };
  const tree = () => createElement(QueryClientProvider, { client }, createElement(MateChat, { ...props, scopeRequest: request }));
  await act(async () => renderer.update(tree()));
  expect(renderer.root.findAllByProps({ testID: "contextual-chat" })).toHaveLength(1);
  expect(renderer.root.findAllByType("ScopeDiscussion" as never)).toHaveLength(0);
  await act(async () => renderer.unmount());
  await act(async () => { renderer = create(tree()); });
  expect(renderer.root.findAllByProps({ testID: "contextual-chat" })).toHaveLength(1);
  expect(state.send).not.toHaveBeenCalled();
});
it("keeps the phone composer above the keyboard and leaves Enter for a newline", async () => {
  await render();
  state.keyboard = 280;
  await act(async () => renderer.update(createElement(QueryClientProvider, { client }, createElement(MateChat, { ...props, compact: true }))));
  expect(renderer.root.findAll(node => node.type === ("View" as never) && Array.isArray(node.props.style) && node.props.style.some((style: { paddingBottom?: number }) => style?.paddingBottom === 280))).toHaveLength(1);
  expect(state.keepAtEnd).toHaveBeenCalledOnce();
  expect(renderer.root.findByType("TextInput" as never).props.onKeyPress).toBeUndefined();
  expect(state.send).not.toHaveBeenCalled();
});
