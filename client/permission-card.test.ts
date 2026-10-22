import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { attentionTheme } from "../test/attention-deck-fixture";
import { visibleText } from "../test/visible-text";

const host = vi.hoisted(() => ({ respond: vi.fn().mockResolvedValue(undefined), ref: vi.fn() }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable" }));
vi.mock("@getpaseo/plugin/client", () => ({ usePaseo: () => ({ agents: { ref: host.ref } }) }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: "Icon", TextInput: "TextInput", useToast: () => ({ error: vi.fn() }) }));
vi.mock("./markdown", () => ({ Markdown: () => null }));
vi.mock("./ui", () => ({ IconButton: "IconButton", MONOSPACE: "monospace", errorText: String }));
import { PermissionCard, usePendingRequests, type PermissionRequest } from "./permission-card";

let renderer: ReactTestRenderer | undefined;
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.clearAllMocks(); });

it.each(["tool", "plan"] as const)("attributes a worker %s request while retaining its request and response identities", async kind => {
  host.ref.mockReturnValue({ respondToPermission: host.respond });
  const request = { id: "worker-permission-7", provider: "codex", kind, name: "Bash", title: "Review this request", input: {},
    actions: [{ id: "approve-once", label: "Approve once", behavior: "allow" }, { id: "reject", label: "Reject", behavior: "deny" }] } as PermissionRequest;
  function Worker() {
    const { pending, respond } = usePendingRequests("worker-42", [request], () => {});
    return pending.map(r => createElement(PermissionCard, { key: r.id, request: r, asker: "This worker", theme: attentionTheme, compact: true,
      onRespond: response => respond(r.id, response), onOpenLink() {} }));
  }
  await act(async () => { renderer = create(createElement(Worker)); });
  expect(visibleText(renderer!.toJSON())).toContain(kind === "plan" ? "This worker has a plan for you to approve" : "This worker is asking permission");
  expect(host.respond).not.toHaveBeenCalled();
  await act(async () => renderer!.root.findAllByType("IconButton" as any).find(n => n.props.label === "Approve once")!.props.onPress());
  expect(host.ref).toHaveBeenLastCalledWith("worker-42");
  expect(host.respond).toHaveBeenCalledExactlyOnceWith({ requestId: "worker-permission-7", response: { behavior: "allow", selectedActionId: "approve-once" } });
  expect(visibleText(renderer!.toJSON())).not.toContain("Review this request");
});

it.each(["Allow", "Deny"])("keeps the first mate's default %s response on the first mate's agent", async label => {
  host.ref.mockReturnValue({ respondToPermission: host.respond });
  const request = { id: "mate-permission-3", provider: "codex", kind: "tool", name: "Bash", input: {} } as PermissionRequest;
  function Mate() {
    const { pending, respond } = usePendingRequests("mate-9", [request], () => {});
    return pending.map(r => createElement(PermissionCard, { key: r.id, request: r, asker: "The first mate", theme: attentionTheme, compact: false,
      onRespond: response => respond(r.id, response), onOpenLink() {} }));
  }
  await act(async () => { renderer = create(createElement(Mate)); });
  expect(visibleText(renderer!.toJSON())).toContain("The first mate is asking permission");
  expect(host.respond).not.toHaveBeenCalled();
  await act(async () => renderer!.root.findAllByType("IconButton" as any).find(n => n.props.label === label)!.props.onPress());
  expect(host.ref).toHaveBeenLastCalledWith("mate-9");
  expect(host.respond).toHaveBeenCalledExactlyOnceWith({ requestId: "mate-permission-3", response: label === "Allow"
    ? { behavior: "allow" } : { behavior: "deny", message: "Denied by the captain from the FirstMate panel." } });
});
