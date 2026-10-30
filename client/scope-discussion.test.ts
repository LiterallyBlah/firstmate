import { act, createElement, type ComponentProps } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Pressable } from "react-native";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { attentionTheme } from "../test/attention-deck-fixture";
import type { ScopeSnapshot } from "../shared/supervision-rpc";
import { drafts } from "./draft";
import { scopeDraftKey } from "../shared/scope-discussion";
import { discussionSender, discussionSendKey, type DiscussionInput } from "./scope-send";
import { ScopeDiscussion } from "./scope-discussion";
import { useScopeSnapshot } from "./scope-query";
const rpc = vi.hoisted(() => ({ read: vi.fn(), send: vi.fn(), snapshot: vi.fn() }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView" }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: (contract: { name: string }) => {
  if (contract.name === "firstmate.scope.read") return rpc.snapshot;
  if (contract.name === "firstmate.chat.queue") return async () => ({ enabled: true, items: [] });
  if (contract.name === "firstmate.chat.submit") return async (input: any) => { await rpc.send(input.payload.input); return { ...input, state: "sent" }; };
  return contract.name.endsWith(".conversation") ? rpc.read : rpc.send;
} }));
vi.mock("./growing-chat-input", () => ({ GrowingChatInput: (props: object) => createElement("Input", props) }));
vi.mock("./option-picker", () => ({ OptionPicker: (props: object) => createElement("Picker", props) }));
vi.mock("./keyboard", () => ({ useKeyboardOverlap: () => 0 }));
vi.mock("./workflow-plans", () => ({ workflowRequestId: () => "00000000-0000-4000-8000-000000000999" }));
let tree: ReactTestRenderer; let client: QueryClient;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { await act(async () => tree?.unmount()); client?.clear(); vi.clearAllMocks(); });
it("opens a retained uncertain message from an explicitly routed discussion without resending", async () => {
  const snapshot = { homeId: "recovery-home", sequence: 1, freshness: "current", asOf: "now", uiEnabled: true, executionEnabled: true, problems: [], projects: [], scopes: ["project", "plan"].map(id => ({
    id, kind: id, title: id, aliases: [], planId: null, discussionOnly: true,
    target: { homeId: "recovery-home", scopeId: id, scopeVersion: 1, epoch: 1, agentId: "owner" },
    hostId: "local", workspaceId: "workspace", state: "active", coverage: "complete", session: "dormant", observedAt: null,
    lastEffectFailure: null, goals: [], activeWorkers: 0, activeEffects: 0, uncertainEffects: 0,
  })) } as ScopeSnapshot;
  const request: DiscussionInput = { id: "retained-request", text: "original", addressedText: "original", defaultScope: "plan", route: { target: snapshot.scopes[1]!.target!, recipient: "plan", projectIds: [], conversationId: "main", replyTo: null } };
  const gate = discussionSender(globalThis, discussionSendKey("local", snapshot.homeId, "plan"));
  gate.send(request, async () => ({ outcome: "uncertain", message: "Lost response" }), vi.fn());
  await Promise.resolve(); await Promise.resolve();
  drafts.set(JSON.stringify(["firstmate.scope-selection/1", "local", snapshot.homeId]), "plan");
  drafts.set(scopeDraftKey("local", snapshot.homeId, "plan"), "Keep original draft");
  rpc.read.mockImplementation(async () => ({ key: "unknown", title: "Conversation", messages: [] }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { tree = create(createElement(QueryClientProvider, { client }, createElement(ScopeDiscussion, { snapshot, hostId: "local", theme: attentionTheme, compact: false, initialScope: "project", refresh() {} }))); });
  expect(rpc.read.mock.calls[0]![0].scopeId).toBe("project");
  const button = tree.root.findAll(node => node.type === Pressable && node.props.accessibilityLabel === "Open original message to plan")[0]!;
  await act(async () => button.props.onPress());
  expect(rpc.read.mock.calls.at(-1)![0].scopeId).toBe("plan");
  expect(tree.root.findByProps({ accessibilityLabel: "Message recipient" }).props.value).toBe("Keep original draft");
  expect(tree.root.findAll(node => node.type === Pressable && node.props.accessibilityLabel === "Reconcile original message")).toHaveLength(1);
  expect(gate.snapshot().pending).toEqual(request); expect(rpc.send).not.toHaveBeenCalled();
  await act(async () => tree.update(createElement(QueryClientProvider, { client }, createElement(ScopeDiscussion, { snapshot, hostId: "another-host", theme: attentionTheme, compact: false, initialScope: "project", refresh() {} }))));
  expect(rpc.read.mock.calls.at(-1)![0].scopeId).toBe("project");
  expect(tree.root.findByProps({ accessibilityLabel: "Message recipient" }).props.value).toBe("");
});

function fixture(): ScopeSnapshot {
  const homeId = `recipient-test-${crypto.randomUUID()}`;
  return { homeId, sequence: 1, freshness: "current", asOf: "2026-10-29T10:00:00Z", uiEnabled: true, executionEnabled: true, problems: [], projects: [{ id: "reader", name: "Reader" }], scopes: ["project", "plan", "new", "remote", "maintenance"].map(id => ({
    id, kind: id === "maintenance" ? "maintenance" : id === "project" ? "project" : "plan", title: `${id} mate`, aliases: [id], planId: id,
    discussionOnly: true, target: { homeId, scopeId: id, scopeVersion: 1, epoch: id === "new" ? 0 : 1, agentId: id === "new" ? null : `${id}-owner` },
    hostId: id === "remote" ? "original-host" : "local", workspaceId: "workspace", state: "active", coverage: "complete", session: id === "new" ? "not-created" : "dormant", observedAt: null,
    lastEffectFailure: null, goals: [], activeWorkers: 0, activeEffects: 0, uncertainEffects: 0,
  })) };
}
const press = async (label: string) => act(async () => tree.root.findAll(n => n.type === Pressable && n.props.accessibilityLabel === label)[0]!.props.onPress());
const input = () => tree.root.findByProps({ accessibilityLabel: "Message recipient" });
async function mount(snapshot: ScopeSnapshot, initialScope = "project", navigation?: ComponentProps<typeof ScopeDiscussion>["navigation"]) {
  client ??= new QueryClient({ defaultOptions: { queries: { retry: false } } });
  rpc.read.mockImplementation(async ({ scopeId }) => ({ key: JSON.stringify(["firstmate.scope-conversation/1", snapshot.homeId, scopeId, "main"]), title: scopeId, messages: [] }));
  await act(async () => { tree = create(createElement(QueryClientProvider, { client }, createElement(ScopeDiscussion, { snapshot, hostId: "local", theme: attentionTheme, compact: false, initialScope, refresh() {}, ...(navigation ? { navigation } : {}) }))); });
  await act(async () => { await new Promise(done => setTimeout(done, 0)); });
}

it("Refresh rereads scope status and replaces unavailable with the observed idle/working status without sending", async () => {
  const snapshot = fixture(); snapshot.scopes[0]!.session = "unknown";
  let latest = snapshot;
  rpc.snapshot.mockImplementation(async () => latest);
  rpc.read.mockResolvedValue({ key: "project", title: "Project", messages: [] });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Conversation() {
    const query = useScopeSnapshot("local", snapshot.homeId);
    return query.data ? createElement(ScopeDiscussion, { snapshot: query.data, hostId: "local", theme: attentionTheme,
      compact: false, initialScope: "project", refresh: () => { void query.refetch(); } }) : null;
  }
  await act(async () => { tree = create(createElement(QueryClientProvider, { client }, createElement(Conversation))); });
  await act(async () => { await new Promise(done => setTimeout(done, 20)); });
  expect(JSON.stringify(tree.toJSON())).toContain("Status unavailable. Refresh to check again.");
  for (const [session, label] of [["dormant", "Not currently working"], ["awake", "Working"]] as const) {
    latest = structuredClone(snapshot); latest.scopes[0]!.session = session; latest.scopes[0]!.observedAt = new Date().toISOString();
    await press("Refresh");
    await act(async () => { await new Promise(done => setTimeout(done, 20)); });
    expect(JSON.stringify(tree.toJSON())).toContain(label);
    expect(JSON.stringify(tree.toJSON())).not.toContain("Status unavailable. Refresh to check again.");
  }
  expect(rpc.snapshot).toHaveBeenCalledTimes(3); expect(rpc.send).not.toHaveBeenCalled();
});
it("loads only the named history, switches recipients and restores each draft on remount without sending", async () => {
  const snapshot = fixture(); client = new QueryClient();
  await mount(snapshot);
  await act(async () => input().props.onChangeText("Project words"));
  await act(async () => tree.root.findByType("Picker" as never).props.onSelect("plan"));
  await act(async () => input().props.onChangeText("Plan words"));
  await act(async () => tree.root.findByType("Picker" as never).props.onSelect("project"));
  expect(input().props.value).toBe("Project words");
  expect(rpc.read.mock.calls.map(c => c[0].scopeId)).not.toContain("general");
  await act(async () => tree.unmount());
  await mount(snapshot, "plan");
  expect(input().props.value).toBe("Plan words");
  expect(rpc.send).not.toHaveBeenCalled();
});

it.each([false, true])("focuses the composer only for an explicit message action (compose=%s)", async focusComposer => {
  const snapshot = fixture(), focus = vi.fn(); client = new QueryClient();
  rpc.read.mockResolvedValue({ key: "project", title: "Project", messages: [] });
  await act(async () => { tree = create(createElement(QueryClientProvider, { client }, createElement(ScopeDiscussion, {
    snapshot, hostId: "local", theme: attentionTheme, compact: true, initialScope: "project", focusComposer, refresh() {},
  })), { createNodeMock: node => node.type === "Input" ? { focus } : {} }); });
  expect(focus).toHaveBeenCalledTimes(focusComposer ? 1 : 0);
  expect(rpc.send).not.toHaveBeenCalled();
});

it("uses a readable stale timestamp only while the conversation read failed", async () => {
  const snapshot = fixture(); client = new QueryClient();
  rpc.read.mockResolvedValue({ key: "project", title: "Project", messages: [] });
  const render = (offline: boolean) => createElement(QueryClientProvider, { client }, createElement(ScopeDiscussion, {
    snapshot, offline, hostId: "local", theme: attentionTheme, compact: true, initialScope: "project", refresh() {},
  }));
  await act(async () => { tree = create(render(true)); });
  expect(JSON.stringify(tree.toJSON())).toContain(new Date(snapshot.asOf).toLocaleString());
  expect(JSON.stringify(tree.toJSON())).not.toContain(snapshot.asOf);
  await act(async () => tree.update(render(false)));
  expect(JSON.stringify(tree.toJSON())).not.toContain("Last updated");
});
it("shows the actual addressed recipient/context before sending and keeps ambiguous addresses intact", async () => {
  const snapshot = fixture(); snapshot.scopes[2]!.aliases = ["plan"];
  client = new QueryClient(); await mount(snapshot);
  await act(async () => input().props.onChangeText("@remote #Reader Explain"));
  expect(tree.root.findByType("Picker" as never).props.value).toBe("remote");
  expect(tree.root.findAll(n => n.type === Pressable && n.props.accessibilityLabel === "Send")[0]!.props.disabled).toBe(true);
  await act(async () => input().props.onChangeText("@plan Explain"));
  expect(tree.root.findByType("Picker" as never).props.value).toBe("");
  expect(JSON.stringify(tree.toJSON())).toContain("Ambiguous recipient @plan");
  expect(input().props.value).toBe("@plan Explain");
  expect(rpc.send).not.toHaveBeenCalled();
});
it("reviews first creation without effects, invalidates a changed target and sends only the reviewed message", async () => {
  const snapshot = fixture(); client = new QueryClient(); await mount(snapshot, "new");
  await act(async () => input().props.onChangeText("Start with this question"));
  await press("Review first message");
  expect(rpc.send).not.toHaveBeenCalled();
  await act(async () => input().props.onChangeText("Changed question"));
  expect(tree.root.findAll(n => n.type === Pressable && n.props.accessibilityLabel === "Start conversation and send")[0]!.props.disabled).toBe(true);
  await press("Review first message");
  const reviewed = structuredClone(snapshot.scopes[2]!.target);
  rpc.send.mockImplementation(async (captured: DiscussionInput) => ({ outcome: "recorded", thread: { key: JSON.stringify(["firstmate.scope-conversation/1", snapshot.homeId, "new", "main"]), title: "new", messages: [{ id: captured.id, delivery: "sent", reply: null }] } }));
  await press("Start conversation and send");
  expect(rpc.send).toHaveBeenCalledTimes(1);
  expect(rpc.send.mock.calls[0]![0]).toMatchObject({ text: "Changed question", route: { target: reviewed } });
});
it.each(["remote", "maintenance"])("keeps %s read-only with its native/original-host link", async id => {
  const snapshot = fixture(), navigation = { openAgent: vi.fn(), openWorkspace: vi.fn() }; client = new QueryClient();
  await mount(snapshot, id, navigation);
  await act(async () => input().props.onChangeText("Keep my draft"));
  expect(tree.root.findAll(n => n.type === Pressable && n.props.accessibilityLabel === "Send")[0]!.props.disabled).toBe(true);
  await press(id === "remote" ? "Open remote mate on original host" : "Open full conversation with maintenance mate");
  expect(navigation.openAgent).toHaveBeenCalledWith({ agentId: `${id}-owner`, ...(id === "remote" ? { serverId: "original-host" } : {}) });
  expect(input().props.value).toBe("Keep my draft"); expect(rpc.send).not.toHaveBeenCalled();
});
