import { act, createElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { attentionCard, attentionTheme } from "../test/attention-deck-fixture";
import { visibleText } from "../test/visible-text";
import { drafts } from "./draft";
import { pendingAttachments } from "./attachments";

const state = vi.hoisted(() => ({ current: "mate-before", config: vi.fn(), refresh: vi.fn(), restart: vi.fn(),
  fleet: vi.fn(), timeline: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), ask: vi.fn(), open: vi.fn() }));
vi.mock("@getpaseo/plugin/client", () => {
  const paseo = { agents: { ref: (id: string) => ({ refresh: () => state.refresh(id), timeline: {
    refetch: () => state.timeline(id), subscribe: () => { state.subscribe(id); return () => state.unsubscribe(id); },
  } }) } };
  return { usePaseo: () => paseo, useRpc: (contract: { name: string }) => {
    switch (contract.name) {
      case "firstmate.config.read": return state.config;
      case "firstmate.mate.restart": return state.restart;
      case "firstmate.mate.ask": return state.ask;
      case "firstmate.chat.queue": return async () => ({ enabled: true, items: [] });
      case "firstmate.chat.submit": return async (input: { id: string; payload: { agentId: string; message: unknown } }) => {
        expect(input.payload.agentId).toBe(state.current);
        await state.ask(input.payload.message);
        return { ...input, state: "sent" };
      };
      default: return async () => { throw new Error(`Unexpected RPC: ${contract.name}`); };
    }
  } };
});
vi.mock("react-native", () => ({ Platform: { OS: "web" }, ...Object.fromEntries(
  ["View", "Text", "Pressable", "ScrollView", "SafeAreaView", "Image"].map(name => [name, name])) }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: () => null, TextInput: "TextInput",
  Modal: Object.assign(({ open, children }: { open: boolean; children: ReactNode }) => open ? children : null,
    { Content: ({ children }: { children: ReactNode }) => children }),
  useToast: () => ({ show() {}, error() {} }),
}));
vi.mock("./files", () => ({ FilesView: () => null }));
vi.mock("./context-meter", () => ({ ContextMeter: () => null }));
vi.mock("./needs-you-query", () => ({ useNeedsYou: () => ({ data: undefined, error: null }) }));
vi.mock("./permission-card", () => ({ usePendingRequests: () => ({ pending: [], respond() {} }), PermissionCard: () => null }));
vi.mock("./follow-end", () => ({ useFollowEnd: () => ({ scrollProps: {}, away: false, pin() {} }) }));
vi.mock("./keyboard", () => ({ useKeyboardOverlap: () => 0 }));
vi.mock("./workspace-file-link", () => ({ useWorkspaceFileLink: () => ({ dialog: null }) }));
vi.mock("./markdown", () => ({ Markdown: ({ source }: { source: string }) => createElement("Text", null, source) }));
vi.mock("./message-copy", () => ({ MessageCopy: () => null }));
vi.mock("./web", () => ({ cacheSentImages() {}, canAttachFiles: false, receiveFiles: () => () => {}, focusWebElement() {} }));
vi.mock("./ui", () => ({ MONOSPACE: "monospace", Spinner: () => null, JumpToEnd: () => null,
  errorText: (error: Error) => error.message,
  IconButton: (props: object) => createElement("IconButton", props),
}));
import { FleetLoadRecovery } from "./fleet-load-recovery";
import { MateChat } from "./chat";

let tree: ReactTestRenderer | undefined, client: QueryClient;
const config = () => ({ config: { mateAgentId: state.current, mateSince: "tenure" }, resolvedHome: "/synthetic-home" });
const agent = (id: string) => ({ ...attentionCard(id, "idle").agent!, id, pendingPermissions: [], archivedAt: id === state.current ? null : "archived" });
const page = (id: string) => ({ agent: agent(id), error: null, hasOlder: false, entries: [{ provider: "codex",
  item: { type: "assistant_message", text: `Transcript for ${id}` }, timestamp: "2026-10-22T12:00:00Z",
  seqStart: 1, seqEnd: 1, sourceSeqRanges: [], collapsed: [],
}] });
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
const chats = () => tree!.root.findAllByType(MateChat);
const button = (label: string) => tree!.root.findByProps({ label });
const press = (label: string) => act(async () => button(label).props.onPress());
function Host() {
  useQuery({ queryKey: ["firstmate", "fleet"], queryFn: state.fleet });
  return createElement(FleetLoadRecovery, { theme: attentionTheme, compact: false,
    navigation: { openAgent: state.open } as never,
    onChanged: () => { void client.invalidateQueries({ queryKey: ["firstmate", "fleet"] }); },
  });
}
async function mount() {
  vi.clearAllMocks();
  state.current = "mate-before";
  state.config.mockImplementation(async () => config());
  state.refresh.mockImplementation(async (id: string) => ({ agent: agent(id) }));
  state.timeline.mockImplementation(async (id: string) => page(id));
  state.fleet.mockRejectedValue(new Error("Independent fleet failure persists"));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  await act(async () => { tree = create(createElement(QueryClientProvider, { client }, createElement(Host))); });
  await settle(); await settle();
  expect(chats()[0]!.props.mate.id).toBe("mate-before");
  expect(visibleText(tree!.toJSON())).toContain("Transcript for mate-before");
}
async function restart() { await press("Session actions"); await press("Restart"); await press("Restart"); }
afterEach(async () => {
  await act(async () => tree?.unmount()); tree = undefined; client?.clear();
  for (const id of ["mate-before", "mate-after"]) { drafts.set(id, ""); pendingAttachments.set(id, []); }
});

it("rebinds visible, streamed, opened and sent-to chat after Restart while fleet reads keep failing", async () => {
  drafts.set("mate-before", "Keep the former mate's draft"); drafts.set("mate-after", "Replacement draft");
  const file = { id: "f", kind: "file" as const, fileName: "notes.txt", mimeType: "text/plain", size: 5, data: "aGVsbG8=" };
  pendingAttachments.set("mate-before", [file]);
  await mount();
  let resolveConfig!: (value: ReturnType<typeof config>) => void;
  let resolveTimeline!: (value: ReturnType<typeof page>) => void;
  state.restart.mockImplementationOnce(async () => {
    state.current = "mate-after";
    state.config.mockImplementationOnce(() => new Promise(resolve => { resolveConfig = resolve; }));
    state.timeline.mockImplementation((id: string) => id === "mate-after"
      ? new Promise(resolve => { resolveTimeline = resolve; }) : Promise.resolve(page(id)));
    return { agentId: state.current, workspaceId: "home-workspace" };
  });
  await restart(); await settle();
  expect(chats()).toHaveLength(0); // retired composer is unavailable while identity is rechecked
  await act(async () => resolveConfig(config())); await settle(); await settle();
  expect(chats()[0]!.props.mate.id).toBe("mate-after");
  expect(state.refresh).toHaveBeenCalledWith("mate-after");
  expect(state.unsubscribe).toHaveBeenCalledWith("mate-before");
  expect(state.subscribe).toHaveBeenLastCalledWith("mate-after");
  expect(visibleText(tree!.toJSON())).not.toContain("Transcript for mate-before");
  await act(async () => resolveTimeline(page("mate-after")));
  expect(visibleText(tree!.toJSON())).toContain("Transcript for mate-after");
  await press("Session actions"); await press("Full conversation");
  expect(state.open).toHaveBeenLastCalledWith({ agentId: "mate-after" });
  expect(tree!.root.findByType("TextInput" as never).props.value).toBe("Replacement draft");
  expect(drafts.get("mate-before")).toBe("Keep the former mate's draft");
  expect(pendingAttachments.get("mate-before")).toEqual([file]);
  const targets: string[] = [];
  let finishSend!: () => void;
  state.ask.mockImplementationOnce(() => { targets.push(state.current); return new Promise<void>(resolve => { finishSend = resolve; }); });
  await act(async () => { const send = button("Send").props.onPress; send(); send(); });
  expect(state.ask).toHaveBeenCalledTimes(1); expect(targets).toEqual(["mate-after"]);
  await act(async () => drafts.set("mate-after", "Unsent follow-up"));
  await act(async () => tree!.update(createElement(QueryClientProvider, { client }, createElement(Host, { key: "remount" }))));
  await settle();
  expect(button("Send").props.disabled).toBe(true); // shared gate survives the recovery remount
  expect(tree!.root.findByType("TextInput" as never).props.value).toBe("Unsent follow-up");
  await act(async () => finishSend());
  expect(button("Send").props.disabled).toBe(false);
  expect(state.fleet.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(client.getQueryState(["firstmate", "fleet"])?.status).toBe("error");
});

it.each(["unconfigured", "archived", "missing"])("removes the retired chat if the post-Restart mate is %s", async outcome => {
  drafts.set("mate-before", "Keep my draft");
  await mount();
  state.restart.mockImplementationOnce(async () => {
    if (outcome === "unconfigured") state.current = "";
    else if (outcome === "archived") state.refresh.mockResolvedValue({ agent: { ...agent("mate-before"), archivedAt: "archived" } });
    else { state.current = "mate-after"; state.refresh.mockResolvedValue(null); }
    return { agentId: "mate-after", workspaceId: "home-workspace" };
  });
  await restart(); await settle(); await settle();
  expect(state.config).toHaveBeenCalledTimes(2);
  expect(chats()).toHaveLength(0);
  expect(state.unsubscribe).toHaveBeenCalledWith("mate-before");
  expect(state.ask).not.toHaveBeenCalled(); expect(state.open).not.toHaveBeenCalled();
  expect(drafts.get("mate-before")).toBe("Keep my draft");
  expect(client.getQueryState(["firstmate", "fleet"])?.status).toBe("error");
});
