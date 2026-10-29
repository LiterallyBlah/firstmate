import { act, createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Pressable } from "react-native";
import { afterEach, expect, it, vi } from "vitest";
import { attentionTheme } from "../test/attention-deck-fixture";
import type { ScopeSnapshot } from "../shared/supervision-rpc";
import { drafts } from "./draft";
import { scopeDraftKey } from "../shared/scope-discussion";
import { discussionSender, discussionSendKey, type DiscussionInput } from "./scope-send";
import { ScopeDiscussion } from "./scope-discussion";
const rpc = vi.hoisted(() => ({ read: vi.fn(), send: vi.fn() }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView" }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: (contract: { name: string }) => contract.name.endsWith(".conversation") ? rpc.read : rpc.send }));
vi.mock("./growing-chat-input", () => ({ GrowingChatInput: (props: object) => createElement("Input", props) }));
vi.mock("./option-picker", () => ({ OptionPicker: () => null }));
vi.mock("./workflow-plans", () => ({ workflowRequestId: () => "unused" }));
let tree: ReactTestRenderer; let client: QueryClient;
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
