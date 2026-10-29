import { act, createElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { attentionTheme as theme } from "../test/attention-deck-fixture";
import { visibleText } from "../test/visible-text";
import type { MaintenanceRuntimeSnapshot } from "../shared/maintenance-runtime";
const calls = vi.hoisted(() => ({ read: vi.fn(), admit: vi.fn(), enable: vi.fn() }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: (rpc: { name: string }) => rpc.name === "firstmate.maintenance.read" ? calls.read : calls.admit }));
vi.mock("react-native", () => ({ Text: "Text", View: "View", Pressable: "Pressable" }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Modal: Object.assign(({ open, children }: { open: boolean; children: ReactNode }) => open ? children : null, { Content: "Content" }) }));
vi.mock("./maintenance-ownership", () => ({ MaintenanceAdmissionConfirmation: "MaintenanceAdmissionConfirmation" }));
import { RoutineCheckSetup } from "./routine-check-setup";

let tree: ReactTestRenderer | undefined, cache: QueryClient, finish: (snapshot: MaintenanceRuntimeSnapshot) => void, fail: (error: Error) => void;
const text = () => visibleText(tree!.toJSON());
const buttons = (label: string) => tree!.root.findAll(n => n.type === "Pressable" as never && n.props.accessibilityLabel === label);
async function mount(homeId = "fixture-home", hostId = "local") {
  await act(async () => { tree = create(createElement(QueryClientProvider, { client: cache }, createElement(RoutineCheckSetup,
    { theme, compact: true, homeId, hostId, online: true, canEnable: true, onEnable: calls.enable, onClose() {} }))); });
}
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function close() { await act(async () => tree!.unmount()); tree = undefined; }
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); vi.setSystemTime(1000000); vi.resetAllMocks();
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  calls.read.mockImplementation(() => new Promise<MaintenanceRuntimeSnapshot>((resolve, reject) => { finish = resolve; fail = reject; }));
});
afterEach(async () => { if (tree) await close(); cache.clear(); vi.useRealTimers(); });

it("D8: explains the pending routine read at 8s and offers a coalesced status-only retry/details at 30s", async () => {
  await mount(); await advance(1000);
  expect(text()).toContain("Loading routine checks…"); expect(text()).not.toContain("Can't connect");
  expect(buttons("Try again")).toHaveLength(0);
  await advance(7000); expect(text()).toContain("taking a little longer"); expect(buttons("Connection details")).toHaveLength(1);
  await advance(22000); expect(buttons("Try again")).toHaveLength(1); expect(buttons("Try again")[0]!.props.disabled).toBe(false);
  expect(text()).not.toContain("Can't connect"); expect(buttons("Review checks profile")).toHaveLength(0);
  await act(async () => { buttons("Try again")[0]!.props.onPress(); buttons("Try again")[0]!.props.onPress(); buttons("Connection details")[0]!.props.onPress(); });
  expect(text()).toContain("only reads status"); expect(calls.read).toHaveBeenCalledTimes(1);
  expect(calls.admit).not.toHaveBeenCalled(); expect(calls.enable).not.toHaveBeenCalled();
  const source = cache.getQueryCache().find({ queryKey: ["firstmate", "routine-check-setup", "local", "fixture-home"], exact: true });
  expect(source!.state.status).toBe("pending"); expect(source!.state.fetchStatus).toBe("fetching");
});
it("keeps the original pending deadline across closing/reopening, isolated by home and host", async () => {
  await mount(); await advance(9000); await close(); await advance(22000); await mount();
  expect(text()).toContain("taking a little longer"); expect(buttons("Try again")).toHaveLength(1); expect(calls.read).toHaveBeenCalledTimes(1);
  await close(); await mount("other-home"); expect(text()).toContain("Loading routine checks…"); expect(buttons("Try again")).toHaveLength(0);
  await close(); await mount("fixture-home", "other-host"); expect(text()).toContain("Loading routine checks…"); expect(buttons("Try again")).toHaveLength(0);
  expect(calls.admit).not.toHaveBeenCalled(); expect(calls.enable).not.toHaveBeenCalled();
});
it("shows failure only after the read rejects and retries only that status read", async () => {
  await mount(); await advance(31000); expect(text()).not.toContain("Can't connect");
  await act(async () => fail(new Error("Host unavailable"))); await advance(1);
  expect(text()).toContain("Can't connect to FirstMate right now");
  await act(async () => buttons("Try again")[0]!.props.onPress()); expect(calls.read).toHaveBeenCalledTimes(2);
  expect(calls.admit).not.toHaveBeenCalled(); expect(calls.enable).not.toHaveBeenCalled();
});
it("a successful read retires the delayed state and permits the existing profile review", async () => {
  await mount(); await advance(31000);
  await act(async () => finish({ enabled: true, homeId: "fixture-home", sequence: 0, freshness: "uninitialized", lowerBound: false,
    problems: [], cleanup: { state: "held", reason: "G8", conditions: [] }, jobs: [], occurrences: [], hosts: [], incidents: [], reservations: [], owners: [], deliveries: [], captainDecisions: [], decisions: [], outbox: [] }));
  await advance(1); expect(buttons("Try again")).toHaveLength(0); expect(text()).not.toContain("taking a little longer");
  expect(buttons("Review checks profile")[0]!.props.disabled).toBe(false); expect(calls.admit).not.toHaveBeenCalled();
});
