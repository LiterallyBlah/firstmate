import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { attentionCard, attentionTheme } from "../test/attention-deck-fixture";
const rpc = vi.hoisted(() => ({ config: vi.fn(), refresh: vi.fn() }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => rpc.config,
  usePaseo: () => ({ agents: { ref: (id: string) => ({ refresh: () => rpc.refresh(id) }) } }),
}));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Modal: Object.assign(() => null, { Content: () => null }) }));
vi.mock("react-native", () => ({ View: "View" }));
vi.mock("./chat", () => ({ MateChat: (props: object) => createElement("MateChat", props) }));
vi.mock("./files", () => ({ FilesView: () => null }));
import { FleetLoadRecovery } from "./fleet-load-recovery";

it("recovers only the configured live mate, sharing config/SDK reads across surfaces", async () => {
  rpc.config.mockReset(); rpc.refresh.mockReset();
  rpc.config.mockResolvedValue({ config: { mateAgentId: "known-mate", mateSince: "tenure" }, resolvedHome: "/synthetic-home" });
  let finish!: (value: object) => void;
  rpc.refresh.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  let tree: ReactTestRenderer;
  const recovery = () => createElement(FleetLoadRecovery, { theme: attentionTheme, compact: true, onChanged() {} });
  await act(async () => { tree = create(createElement(QueryClientProvider, { client }, recovery(), recovery())); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(rpc.config).toHaveBeenCalledTimes(1);
  expect(rpc.refresh).toHaveBeenCalledExactlyOnceWith("known-mate");
  expect(tree!.root.findAllByType("MateChat" as never)).toHaveLength(0);
  await act(async () => finish({ agent: { ...attentionCard("known-mate", "idle").agent, id: "known-mate", pendingPermissions: [], archivedAt: null } }));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  const chats = tree!.root.findAllByType("MateChat" as never);
  expect(chats).toHaveLength(2);
  expect(chats[0]!.props.mate.id).toBe("known-mate");
  expect(chats[0]!.props.imageContext.home).toBe("/synthetic-home");
  await act(async () => tree!.unmount()); client.clear();
});

it.each(["unconfigured", "archived"])("does not invent a usable mate when %s", async state => {
  rpc.config.mockReset(); rpc.refresh.mockReset();
  rpc.config.mockResolvedValue({ config: { mateAgentId: state === "unconfigured" ? "" : "former-mate", mateSince: "tenure" }, resolvedHome: "/synthetic-home" });
  rpc.refresh.mockResolvedValue({ agent: { ...attentionCard("former-mate", "idle").agent, pendingPermissions: [], archivedAt: "archived" } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree: ReactTestRenderer;
  await act(async () => { tree = create(createElement(QueryClientProvider, { client }, createElement(FleetLoadRecovery, {
    theme: attentionTheme, compact: false, onChanged() {},
  }))); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(tree!.root.findAllByType("MateChat" as never)).toHaveLength(0);
  if (state === "unconfigured") expect(rpc.refresh).not.toHaveBeenCalled();
  else expect(rpc.refresh).toHaveBeenCalledExactlyOnceWith("former-mate");
  await act(async () => tree!.unmount()); client.clear();
});
