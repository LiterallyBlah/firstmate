import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { attentionTheme as theme } from "../test/attention-deck-fixture";
const mock = vi.hoisted(() => ({ read: vi.fn(), dismiss: vi.fn() }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: (r: { name: string }) => r.name.endsWith(".read") ? mock.read : mock.dismiss }));
vi.mock("react-native", () => ({ Text: "Text", View: "View", Pressable: "Pressable" }));
import { ProjectMateIntroduction, introductionEligible, type ProjectIntroductionReadiness } from "./project-introduction";
const ready: ProjectIntroductionReadiness = { firstmateExists: true, conversationExists: true, fleetReady: true, projectsReady: true, policyReady: true, projectsNeedSetup: true };
let renderer: ReactTestRenderer | undefined, cache: QueryClient;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.resetAllMocks(); cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mock.read.mockImplementation(async ({ homeId }) => ({ homeId, version: 1, state: "available" }));
  mock.dismiss.mockImplementation(async ({ homeId }) => ({ homeId, version: 1, state: "dismissed" })); });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; cache.clear(); });
const button = (label: string) => renderer!.root.find(n => n.type === "Pressable" as never && n.props.accessibilityLabel === label);
async function mount(extra: Partial<Parameters<typeof ProjectMateIntroduction>[0]> = {}) {
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(ProjectMateIntroduction,
    { theme, homeId: "fixture-home", hostId: "local", readiness: ready, onSetup: vi.fn(), ...extra }))); });
  await act(async () => { await new Promise(done => setTimeout(done, 10)); });
}
it("requires an existing conversation, ready sources, unconfigured projects and a usable setup path", () => {
  expect(introductionEligible(ready, true)).toBe(true); expect(introductionEligible(ready, false)).toBe(false);
  for (const key of Object.keys(ready)) expect(introductionEligible({ ...ready, [key]: false }, true)).toBe(false);
});
it("stays dark without the preceding setup path; no preference reads or effects", async () => {
  await mount({ onSetup: undefined }); expect(renderer!.toJSON()).toBeNull(); expect(mock.read).not.toHaveBeenCalled(); expect(mock.dismiss).not.toHaveBeenCalled();
});
it("setup is explicit and dismissal survives a new client/cache via the home/version receipt", async () => {
  const setup = vi.fn(); await mount({ onSetup: setup }); expect(mock.dismiss).not.toHaveBeenCalled();
  await act(async () => button("Set up project mates").props.onPress()); expect(setup).toHaveBeenCalledOnce();
  await act(async () => { const press = button("Not now").props.onPress; press(); press(); }); expect(mock.dismiss).toHaveBeenCalledExactlyOnceWith({ homeId: "fixture-home", version: 1 }); expect(renderer!.toJSON()).toBeNull();
  await act(async () => renderer!.unmount()); cache.clear();
  mock.read.mockResolvedValue({ homeId: "fixture-home", version: 1, state: "dismissed" }); await mount(); expect(renderer!.toJSON()).toBeNull();
});
it.each(["pending", "offline", "held", "wrong-home"])("%s preference never becomes an introduction or a failure banner", async state => {
  if (state === "pending") mock.read.mockReturnValue(new Promise(() => {}));
  else if (state === "offline") mock.read.mockRejectedValue(new Error("offline"));
  else mock.read.mockResolvedValue({ homeId: state === "wrong-home" ? "other" : "fixture-home", version: 1, state: state === "held" ? "held" : "available" });
  await mount(); expect(renderer!.toJSON()).toBeNull(); expect(mock.dismiss).not.toHaveBeenCalled();
});
