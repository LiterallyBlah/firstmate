import { describe, expect, it } from "vitest";

import type { RemoteHost, RemoteSnapshot } from "../shared/remotes";
import { exitRemoteCrew, interruptRemoteCrew, remoteCrewLogs, remoteSteerText, steerRemoteCrew, type RemoteGateway } from "./remote-crew";
import { commandArguments } from "./remotes";

const light: RemoteHost = {
  serverId: "srv_light",
  label: "Light",
  online: true,
  checkedAt: null,
  error: null,
  projects: [],
  workspaces: [],
  providers: [],
  workers: [
    { id: "w1", name: "Fix login", status: "running", updatedAt: "", permissions: 0, output: "" },
    { id: "mine", name: "Captain's session", status: "idle", updatedAt: "", permissions: 0, output: "", followed: true },
  ],
};

function gateway(answer: (args: string[]) => unknown = () => ({})) {
  const calls: Array<{ selector: string; args: string[] }> = [];
  const remotes: RemoteGateway = {
    read: async (): Promise<RemoteSnapshot> => ({ version: 1, localServerId: "srv_here", syncedAt: null, syncError: null, hosts: [light] }),
    request: async (selector, args) => {
      calls.push({ selector, args });
      return answer(args);
    },
  };
  return { remotes, calls };
}

describe("remote crew actions", () => {
  it("route steer, interrupt, end and watch to the host by serverId, as allowed commands", async () => {
    const { remotes, calls } = gateway((args) => (args[0] === "logs" ? "[User] go\n\ndone: PR" : {}));
    await steerRemoteCrew(remotes, "srv_light", "w1", "  Rebase first.  ");
    await interruptRemoteCrew(remotes, "srv_light", "w1");
    await exitRemoteCrew(remotes, "srv_light", "w1");
    expect(await remoteCrewLogs(remotes, "srv_light", "w1")).toMatchObject({ text: "[User] go\n\ndone: PR" });
    expect(calls).toEqual([
      { selector: "srv_light", args: ["send", "w1", "--", "Rebase first."] },
      { selector: "srv_light", args: ["stop", "w1"] },
      { selector: "srv_light", args: ["archive", "w1"] },
      { selector: "srv_light", args: ["logs", "w1", "--tail", "40", "--filter", "text"] },
    ]);
    // Each passes the request path's own guard; a send never waits there.
    for (const call of calls) expect(() => commandArguments(call.args, "owner")).not.toThrow();
    expect(commandArguments(calls[0]!.args, "owner")).toEqual(["send", "w1", "--no-wait", "--json", "--", "Rebase first."]);
  });

  it("refuses a host or worker the last poll did not find, before sending anything", async () => {
    const { remotes, calls } = gateway();
    await expect(steerRemoteCrew(remotes, "Light", "w1", "hi")).rejects.toThrow("not one of the remote hosts");
    await expect(interruptRemoteCrew(remotes, "srv_light", "someone-else")).rejects.toThrow("no worker someone-else");
    await expect(exitRemoteCrew(remotes, "srv_dark", "w1")).rejects.toThrow("not one of the remote hosts");
    expect(calls).toEqual([]);
  });

  it("never ends a followed session, which is the captain's own, but can still steer it", async () => {
    const { remotes, calls } = gateway();
    await expect(exitRemoteCrew(remotes, "srv_light", "mine")).rejects.toThrow("not crew");
    await steerRemoteCrew(remotes, "srv_light", "mine", "Check the logs.");
    expect(calls).toEqual([{ selector: "srv_light", args: ["send", "mine", "--", "Check the logs."] }]);
  });

  it("sends words that start with a dash as text, after --, past the request path's option checks", async () => {
    const { remotes, calls } = gateway();
    await steerRemoteCrew(remotes, "srv_light", "w1", "- first, rebase");
    await steerRemoteCrew(remotes, "srv_light", "w1", "--host=elsewhere is just words here");
    expect(calls.map((call) => call.args)).toEqual([
      ["send", "w1", "--", "- first, rebase"],
      ["send", "w1", "--", "--host=elsewhere is just words here"],
    ]);
    expect(commandArguments(calls[1]!.args, "owner")).toEqual(["send", "w1", "--no-wait", "--json", "--", "--host=elsewhere is just words here"]);
    await expect(steerRemoteCrew(remotes, "srv_light", "w1", "   ")).rejects.toThrow("Nothing to send");
  });

  it("never passes on an error that could carry a credential or a pairing link", async () => {
    const failing: RemoteGateway = {
      ...gateway().remotes,
      request: async () => {
        throw new Error("could not reach https://app.paseo.sh/#offer=abc");
      },
    };
    await expect(interruptRemoteCrew(failing, "srv_light", "w1")).rejects.toThrow(/^Remote command failed$/);
    const plain: RemoteGateway = {
      ...gateway().remotes,
      request: async () => {
        throw new Error("Host unreachable or authentication failed; reconnect it in Paseo");
      },
    };
    await expect(interruptRemoteCrew(plain, "srv_light", "w1")).rejects.toThrow("Host unreachable");
  });

  it("tells the first mate what was said, and where", async () => {
    const text = await remoteSteerText(light, light.workers[0]!, "Rebase first.");
    expect(text).toContain("remote worker w1 (Fix login) on host Light (srv_light)");
    expect(text).toContain("<captain-message>\nRebase first.\n</captain-message>");
    expect(text).not.toContain("{{");
    expect(text).not.toContain("<!--");
  });
});

describe("S08 scoped remote mutation", () => {
  it("a guard refusal stops steer, interrupt and end before any remote request; logs stay readable", async () => {
    const { remotes, calls } = gateway(() => "log");
    const guard = async () => { throw new Error("remote mutation stays disabled"); };
    await expect(steerRemoteCrew(remotes, "srv_light", "w1", "go", guard)).rejects.toThrow("stays disabled");
    await expect(interruptRemoteCrew(remotes, "srv_light", "w1", guard)).rejects.toThrow("stays disabled");
    await expect(exitRemoteCrew(remotes, "srv_light", "w1", guard)).rejects.toThrow("stays disabled");
    expect(calls).toEqual([]);
    await remoteCrewLogs(remotes, "srv_light", "w1");
    expect(calls).toHaveLength(1);
  });
});
