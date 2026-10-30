import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { useChatQueue, ChatQueueRows } from "./chat-queue";
import type { ChatQueuePayload } from "../shared/chat-queue";
import { attentionTheme } from "../test/attention-deck-fixture";
const rpc = vi.hoisted(() => ({ read: vi.fn(), submit: vi.fn(), change: vi.fn() }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView" }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: "Icon", useToast: () => ({ error() {} }) }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: (contract: { name: string }) => contract.name.endsWith("submit") ? rpc.submit : contract.name.endsWith("change") ? rpc.change : rpc.read }));
vi.mock("./workflow-plans", () => ({ workflowRequestId: () => crypto.randomUUID() }));
let queue: ReturnType<typeof useChatQueue>, tree: ReactTestRenderer, cache: QueryClient;
const onConfirmed = vi.fn(), onEdit = vi.fn();
function Host() { queue = useChatQueue({ kind: "mate", agentId: "mate" }, "lost-response-test"); return createElement(ChatQueueRows, { queue, theme: attentionTheme, onConfirmed, onEdit }); }
afterEach(async () => { await act(async () => tree?.unmount()); cache?.clear(); vi.clearAllMocks(); });
it("checks the original request after a lost response and never creates a second ID", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  rpc.read.mockResolvedValue({ enabled: true, items: [] });
  rpc.submit.mockRejectedValueOnce(new Error("Response lost")).mockImplementation(async input => ({ ...input, state: "sent" }));
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { tree = create(createElement(QueryClientProvider, { client: cache }, createElement(Host))); });
  const payload: ChatQueuePayload = { kind: "mate", agentId: "mate", message: { text: "Only once" } };
  await act(async () => { expect(await queue.send(payload)).toBe(false); });
  const id = rpc.submit.mock.calls[0]![0].id;
  await act(async () => { expect(await queue.send({ ...payload, message: { text: "Different message" } })).toBe(false); });
  expect(rpc.submit).toHaveBeenCalledTimes(1);
  await act(async () => tree.root.findByProps({ accessibilityLabel: "Check message" }).props.onPress());
  expect(rpc.submit.mock.calls[1]![0].id).toBe(id);
  expect(onConfirmed).toHaveBeenCalledWith(payload);
  expect(queue.unconfirmed).toBe(false);
});
it("numbers only queued rows and offers Remove after an uncertain delivery is held", async () => {
  const target = { kind: "mate" as const, agentId: "mate" };
  const rows = ["held", "queued", "editing", "queued"].map((state, index) => ({ id: String(index), state, text: `Message ${index}`, target, hash: "hash", problem: null, attachmentCount: 0 }));
  await act(async () => { tree = create(createElement(ChatQueueRows, { queue: { items: rows, sending: false } as ReturnType<typeof useChatQueue>, theme: attentionTheme, onEdit, onConfirmed })); });
  const text = JSON.stringify(tree.toJSON());
  expect(text).toContain("2 queued"); expect(text).toContain("1. "); expect(text).toContain("2. "); expect(text).not.toContain("3. ");
  expect(tree.root.findAllByProps({ accessibilityLabel: "Remove" })).toHaveLength(4);
  expect(tree.root.findAllByProps({ accessibilityLabel: "Edit" })).toHaveLength(3);
});

it("sends the selected queued item now through its existing action", async () => {
  const target = { kind: "mate" as const, agentId: "mate" };
  const items = ["first", "second"].map(id => ({ id, state: "queued", text: id, target, hash: "hash", problem: null, attachmentCount: 0 }));
  rpc.read.mockResolvedValue({ enabled: true, items });
  rpc.change.mockResolvedValue({ payload: null });
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { tree = create(createElement(QueryClientProvider, { client: cache }, createElement(Host))); });
  await act(async () => { await new Promise(done => setTimeout(done, 0)); });
  const buttons = tree.root.findAllByProps({ accessibilityLabel: "Send now" });
  expect(buttons).toHaveLength(2);
  await act(async () => buttons[1]!.props.onPress());
  expect(rpc.change).toHaveBeenCalledExactlyOnceWith({ target, id: "second", action: "now" });
  expect(rpc.submit).not.toHaveBeenCalled();
});
