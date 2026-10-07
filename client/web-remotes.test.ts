import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
import { configureIndependentDaemon, savedDaemonRegistry } from "./web";
afterEach(() => vi.unstubAllGlobals());
function storage() {
  const values = new Map<string, string>();
  const store = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  vi.stubGlobal("localStorage", store);
  return store;
}
describe("Paseo desktop adapters", () => {
  it("reads the saved registry without opening a panel or native storage", () => {
    const store = storage();
    expect(savedDaemonRegistry()).toBeNull();
    store.setItem("@paseo:daemon-registry", "[]");
    expect(savedDaemonRegistry()).toBe("[]");
  });
  it("enables background operation once and respects a later manual change", async () => {
    storage();
    const invoke = vi.fn(async (command: string) => command === "desktop_daemon_status" ? { serverId: "Atlas" } : { daemon: { keepRunningAfterQuit: true } });
    vi.stubGlobal("paseoDesktop", { invoke });
    await configureIndependentDaemon("Atlas");
    expect(invoke).toHaveBeenCalledWith("patch_desktop_settings", { daemon: { keepRunningAfterQuit: true } });
    const calls = invoke.mock.calls.length;
    await configureIndependentDaemon("Atlas");
    expect(invoke.mock.calls).toHaveLength(calls);
  });
  it("does not alter a desktop's unrelated daemon when viewing a remote mate", async () => {
    storage();
    const invoke = vi.fn(async () => ({ serverId: "local-desktop" }));
    vi.stubGlobal("paseoDesktop", { invoke });
    await configureIndependentDaemon("Atlas");
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
