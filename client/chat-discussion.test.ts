import { act, createElement, type ComponentProps } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { attentionCard, attentionRequest, attentionSnapshot, attentionTheme } from "../test/attention-deck-fixture";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import type { WorkflowSnapshot } from "../shared/workflow-rpc";
import type { TimelineEntry } from "./transcript-rows";
import { compactPlansFixture } from "../test/compact-plans-fixture";
import { drafts } from "./draft";
import { pendingAttachments } from "./attachments";
import type { ScopeSnapshot } from "../shared/supervision-rpc";
import { scopeUiKey } from "./draft";
import { scopeDraftKey } from "../shared/scope-discussion";
const scopeFixture: ScopeSnapshot = { homeId: "/home", sequence: 1, freshness: "current", asOf: "2026-10-29T09:00:00Z", uiEnabled: true, executionEnabled: true, problems: [], projects: [], scopes: [{
  id: "project-mate", kind: "project", title: "Reader mate", aliases: [], planId: null, discussionOnly: true,
  target: { homeId: "/home", scopeId: "project-mate", scopeVersion: 1, epoch: 1, agentId: "project-agent" },
  hostId: "local", workspaceId: "project-workspace", state: "active", coverage: "complete", session: "dormant", observedAt: null,
  lastEffectFailure: null, goals: [], activeWorkers: 0, activeEffects: 0, uncertainEffects: 0,
}] };

const state = vi.hoisted(() => ({ snapshot: null as NeedsYouSnapshot | null, plans: undefined as WorkflowSnapshot | undefined, entries: [] as TimelineEntry[], scopes: undefined as ScopeSnapshot | undefined, scopeError: null as Error | null, keyboard: 0, keepAtEnd: vi.fn(), openPlan: vi.fn(), send: vi.fn(), focus: vi.fn() }));
vi.mock("./scope-query", () => ({ useScopeSnapshot: () => ({ data: state.scopes, error: state.scopeError, refetch: vi.fn() }) }));
vi.mock("./scope-discussion", () => ({ ScopeDiscussion: (props: object) => createElement("ScopeDiscussion", props) }));
vi.mock("./project-setup", () => ({ ProjectSetup: (props: object) => createElement("ProjectSetup", props) }));
vi.mock("react-native", () => ({ Platform: { OS: "web" }, ...Object.fromEntries(["View", "Text", "Pressable", "ScrollView", "SafeAreaView", "Image"].map(name => [name, name])) }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: (contract: { name: string }) => async (input: any) => {
  if (contract.name === "firstmate.chat.queue") return { enabled: true, items: [] };
  if (contract.name === "firstmate.chat.submit") { state.send(input.payload.message); return { ...input, state: "sent" }; }
  return {};
}, openExternalUrl() {} }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ TextInput: "TextInput", Icon: () => null, useToast: () => ({ error() {} }) }));
vi.mock("./needs-you-query", () => ({ useNeedsYou: () => ({ data: state.snapshot, error: null }) }));
vi.mock("./use-timeline", () => ({ useAgentTimeline: () => ({ entries: state.entries, error: null, hasOlder: false, loading: false }) }));
vi.mock("./workflow-plans", () => ({ workflowRequestId: () => crypto.randomUUID(), useWorkflowPlans: () => ({ snapshot: state.plans, open: state.openPlan }) }));
vi.mock("./permission-card", () => ({ usePendingRequests: () => ({ pending: [], respond() {} }), PermissionCard: () => null }));
vi.mock("./follow-end", () => ({ useFollowEnd: () => ({ scrollProps: {}, away: false, pin() {}, keepAtEnd: state.keepAtEnd }) }));
vi.mock("./keyboard", () => ({ useKeyboardOverlap: () => state.keyboard }));
vi.mock("./workspace-file-link", () => ({ useWorkspaceFileLink: () => ({ dialog: null }) }));
vi.mock("./mate-send", async importOriginal => ({ ...await importOriginal<typeof import("./mate-send")>(), useMateSender: () => ({ send: state.send, sending: false, command: state.send }) }));
vi.mock("./mate-controls", () => ({ MateControls: () => null }));
vi.mock("./markdown", () => ({ Markdown: () => null }));
vi.mock("./decision-raised-card", () => ({ DecisionRaisedCard: () => null }));
vi.mock("./decision-answer-bubble", () => ({ DecisionAnswerBubble: () => null }));
vi.mock("./message-copy", () => ({ MessageCopy: () => null }));
vi.mock("./chat-image", () => ({ ChatImage: () => null }));
vi.mock("./web", () => ({ cacheSentImages() {}, canAttachFiles: false, receiveFiles: () => () => {}, bindWebKeys: () => () => {} }));
vi.mock("./ui", () => ({
  MONOSPACE: "monospace", Spinner: () => null, JumpToEnd: () => null,
  IconButton: (props: { label: string; onPress(): void; disabled?: boolean }) => createElement("Pressable", { accessibilityLabel: props.label, onPress: props.onPress, disabled: props.disabled }),
}));
import { MateChat } from "./chat";

let renderer: ReactTestRenderer;
let client: QueryClient;
const mate = attentionCard("chat-test-mate", "idle").agent!;
const reference = { mateId: mate.id, homeId: "sample-home", requestId: "local:release", recordRevision: 1 };
const onReturnDecision = vi.fn();
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
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
  drafts.set(scopeDraftKey("local", "/home", "project-mate"), "");
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

const button = (label: string) => renderer.root.findAll(n => n.type === ("Pressable" as never) && n.props.accessibilityLabel === label)[0]!;
it("offers the existing mate from @, carries words into its named draft and preserves General", async () => {
  state.scopes = structuredClone(scopeFixture);
  await render();
  await act(async () => renderer.root.findByType("TextInput" as never).props.onChangeText("@reader Explain this"));
  await act(async () => renderer.root.findByType("TextInput" as never).props.onSelectionChange({ nativeEvent: { selection: { start: 7, end: 7 } } }));
  expect(button("Send").props.disabled).toBe(false);
  await act(async () => button("Reader mate. Project: Reader mate").props.onPress());
  await act(async () => button("Message Reader mate").props.onPress());
  expect(renderer.root.findByType("ScopeDiscussion" as never).props.initialScope).toBe("project-mate");
  expect(renderer.root.findByType("ScopeDiscussion" as never).props.capturedTarget).toEqual(scopeFixture.scopes[0]!.target);
  expect(drafts.get(scopeDraftKey("local", "/home", "project-mate"))).toBe("Explain this");
  expect(drafts.get(mate.id)).toBe("@reader Explain this");
  expect(state.send).not.toHaveBeenCalled();
  await act(async () => button("Back to FirstMate").props.onPress());
  expect(renderer.root.findByType("TextInput" as never).props.value).toBe("@reader Explain this");
});

it.each(["pending", "failed", "empty"])("keeps %s conversation discovery distinct while ordinary @ text can be sent to FirstMate", async kind => {
  state.scopes = kind === "empty" ? { ...structuredClone(scopeFixture), scopes: [] } : undefined;
  state.scopeError = kind === "failed" ? new Error("Offline") : null;
  await render();
  await act(async () => renderer.root.findByType("TextInput" as never).props.onChangeText("@"));
  expect(renderer.root.findAll(n => n.type === ("Pressable" as never) && n.props.accessibilityLabel === "No project mates yet. Set one up")).toHaveLength(kind === "empty" ? 1 : 0);
  if (kind === "empty") {
    await act(async () => button("No project mates yet. Set one up").props.onPress());
    expect(renderer.root.findAllByType("ProjectSetup" as never)).toHaveLength(1);
  }
  await act(async () => button("Send").props.onPress());
  expect(state.send).toHaveBeenCalledOnce();
});

it("keeps a filtered picker reachable through every keystroke of a leading @ sentence", async () => {
  state.scopes = structuredClone(scopeFixture);
  await render();
  const words = "@reader check chapter three please";
  for (let length = 1; length <= words.length; length++) {
    await act(async () => renderer.root.findByType("TextInput" as never).props.onChangeText(words.slice(0, length)));
    expect(button("Reader mate. Project: Reader mate")).toBeDefined();
    expect(button("Send").props.disabled).toBe(false);
  }
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Choose a mate above");
  await act(async () => button("Reader mate. Project: Reader mate").props.onPress());
  await act(async () => button("Message Reader mate").props.onPress());
  expect(drafts.get(scopeDraftKey("local", "/home", "project-mate"))).toBe("check chapter three please");
  expect(state.send).not.toHaveBeenCalled();
});

it.each(["Escape", "Close mentions", "Cancel mention", "unmatched", "no mates"])("sends @ prose to FirstMate after %s without a scoped fallback", async dismissal => {
  state.scopes = { ...structuredClone(scopeFixture), ...(dismissal === "no mates" ? { scopes: [], uiEnabled: false } : {}) };
  await render();
  const text = dismissal === "unmatched" || dismissal === "no mates" ? "@sarah said the cover looks great" : "@reader check chapter three please";
  await act(async () => renderer.root.findByType("TextInput" as never).props.onChangeText(text));
  if (dismissal === "Escape") await act(async () => renderer.root.findByType("TextInput" as never).props.onKeyPress({ nativeEvent: { key: "Escape" }, preventDefault() {} }));
  if (dismissal === "Close mentions") await act(async () => button("Close mentions").props.onPress());
  if (dismissal === "Cancel mention") {
    await act(async () => button("Reader mate. Project: Reader mate").props.onPress());
    await act(async () => button("Cancel mention").props.onPress());
  }
  if (["Escape", "Close mentions", "Cancel mention"].includes(dismissal)) {
    await act(async () => renderer.root.findByType("TextInput" as never).props.onChangeText(`${text}!`));
    expect(renderer.root.findAllByProps({ testID: "mate-mentions" })).toHaveLength(0);
    await act(async () => renderer.root.findByType("TextInput" as never).props.onChangeText(text));
  }
  expect(button("Send").props.disabled).toBe(false);
  await act(async () => button("Send").props.onPress());
  expect(state.send).toHaveBeenCalledOnce();
  expect(state.send.mock.calls[0]![0]).toMatchObject({ text });
  expect(renderer.root.findAllByType("ScopeDiscussion" as never)).toHaveLength(0);
});

it("leaves the empty never-enabled Home without conversation switcher chrome", async () => {
  state.scopes = { ...structuredClone(scopeFixture), uiEnabled: false, scopes: [] };
  await render();
  expect(renderer.root.findAllByProps({ testID: "conversation-switcher" })).toHaveLength(0);
  await act(async () => renderer.root.findByType("TextInput" as never).props.onChangeText("@"));
  expect(button("No project mates yet. Set one up")).toBeDefined();
});

it("keeps a chosen owner pinned when its binding changes", async () => {
  state.scopes = structuredClone(scopeFixture);
  await render();
  await act(async () => button("Conversations: FirstMate").props.onPress());
  await act(async () => renderer.root.findAll(n => n.type === ("Pressable" as never) && /^Reader mate, /.test(n.props.accessibilityLabel ?? ""))[0]!.props.onPress());
  state.scopes = structuredClone(scopeFixture);
  state.scopes.scopes[0]!.target.epoch++;
  await act(async () => renderer.update(createElement(QueryClientProvider, { client }, createElement(MateChat, props))));
  expect(renderer.root.findAllByType("ScopeDiscussion" as never)).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).toContain("owner changed");
  expect(state.send).not.toHaveBeenCalled();
});

it("updates the conversation switcher when the existing recipient control changes the discussion", async () => {
  state.scopes = structuredClone(scopeFixture);
  const helper = structuredClone(state.scopes.scopes[0]!);
  helper.id = "plan-helper"; helper.kind = "plan"; helper.title = "Phone layout";
  helper.target = { ...helper.target, scopeId: helper.id, agentId: "helper-agent" };
  state.scopes.scopes.push(helper);
  await render();
  await act(async () => button("Conversations: FirstMate").props.onPress());
  await act(async () => renderer.root.findAll(n => n.type === ("Pressable" as never) && /^Reader mate, /.test(n.props.accessibilityLabel ?? ""))[0]!.props.onPress());
  await act(async () => renderer.root.findByType("ScopeDiscussion" as never).props.onSelectScope("plan-helper"));
  expect(renderer.root.findByType("ScopeDiscussion" as never).props.initialScope).toBe("plan-helper");
  expect(renderer.root.findAll(n => n.type === ("Pressable" as never) && /^Conversations: Phone layout helper/.test(n.props.accessibilityLabel ?? ""))).toHaveLength(1);
  expect(state.send).not.toHaveBeenCalled();
});
