import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { attentionSnapshot } from "../test/attention-deck-fixture";
import { NEEDS_YOU_QUERY_KEY, useNeedsYou } from "./needs-you-query";

const rpc = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => rpc.read }));
const trees: ReactTestRenderer[] = [], clients: QueryClient[] = [];
afterEach(async () => {
  await act(async () => { trees.forEach(tree => tree.unmount()); });
  clients.forEach(client => client.clear()); trees.length = 0; clients.length = 0;
  vi.useRealTimers(); vi.clearAllMocks();
});

it("keeps the outstanding source wait across observers/remounts and coalesces retries", async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000000);
  let settle!: (snapshot: ReturnType<typeof attentionSnapshot>) => void;
  rpc.read.mockImplementation(() => new Promise(resolve => { settle = resolve; }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  const seen: ReturnType<typeof useNeedsYou>[] = [];
  function Probe() { seen.push(useNeedsYou()); return null; }
  const mount = async (cache = client) => {
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(createElement(QueryClientProvider, { client: cache }, createElement(Probe))); });
    trees.push(tree); return tree;
  };
  const first = await mount(); const started = seen.at(-1)!.pendingSince;
  expect(started).toBe(1000000);
  await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
  const drawer = await mount(); expect(seen.at(-1)!.pendingSince).toBe(started);
  await act(async () => { first.unmount(); drawer.unmount(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(22000); });
  await mount(); expect(seen.at(-1)!.pendingSince).toBe(started);
  void seen.at(-1)!.refetch({ cancelRefetch: false }); void seen.at(-1)!.refetch({ cancelRefetch: false });
  expect(rpc.read).toHaveBeenCalledTimes(1);
  await act(async () => { settle(attentionSnapshot([])); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(seen.at(-1)!.pendingSince).toBeUndefined();
  expect(seen.at(-1)!.data).toBeDefined();
  // A different host/query client and an evicted source start their own waits.
  const other = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(other);
  await mount(other); expect(seen.at(-1)!.pendingSince).toBe(1031001);
  await act(async () => { client.removeQueries({ queryKey: NEEDS_YOU_QUERY_KEY }); });
  await mount(client); expect(seen.at(-1)!.pendingSince).toBe(1031001);
});
