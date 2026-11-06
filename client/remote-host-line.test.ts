import { expect, it } from "vitest";
import { remoteWorkerHostLine } from "./remote-host-line";

it("names the worker host, the local Supervisor, and the unreachable pause; local plans get no line", () => {
  const label = (id: string) => ({ srv_remote: "ariadne-dev" } as Record<string, string>)[id] ?? id;
  expect(remoteWorkerHostLine([], label)).toBeNull();
  expect(remoteWorkerHostLine(["srv_remote"], label)).toBe(
    "Workers run on ariadne-dev; this Supervisor runs locally; if the host is unreachable the loop pauses and nothing is resent");
  expect(remoteWorkerHostLine(["srv_remote", "srv_other"], label)).toContain("ariadne-dev, srv_other");
});
