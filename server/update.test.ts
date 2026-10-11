import { describe, expect, it, vi } from "vitest";
import { UPDATE_REFRESH_MS } from "../shared/update";
import { UpdateService } from "./update";
import type { InstalledSource } from "./update-source";

const old = "a".repeat(40),
  newer = "b".repeat(40);
function fixture() {
  let source: InstalledSource = {
    path: "/installed/fork",
    identity: "fork:release",
    revision: old,
    description: "configured fork, release",
  };
  let revision = newer,
    time = 0;
  const read = vi.fn(async () => ({ ...source }));
  const latest = vi.fn(
    async (): Promise<{
      revision: string;
      immutable: string;
      installedNewer?: boolean;
    }> => ({
      revision,
      immutable: JSON.stringify({ kind: "git", commit: revision }),
    }),
  );
  const send = vi.fn(async (_text: string, beforeSend: () => Promise<void>) => {
    await beforeSend();
    return "mate";
  });
  const service = new UpdateService(read, latest, () => time);
  return {
    service,
    read,
    latest,
    send,
    source: (patch: Partial<InstalledSource>) => {
      source = { ...source, ...patch };
    },
    revision: (next: string) => {
      revision = next;
    },
    tick: () => {
      time += UPDATE_REFRESH_MS;
    },
  };
}

describe("FirstMate update verification and delivery", () => {
  it("checks only its configured source and sends an explicit immutable request once", async () => {
    const f = fixture();
    const status = await f.service.check();
    expect(status).toMatchObject({
      state: "available",
      latest: "bbbbbbbb",
      requested: false,
    });
    expect(f.latest).toHaveBeenCalledWith(
      expect.objectContaining({ identity: "fork:release", revision: old }),
    );
    const result = await f.service.request(status.token!, f.send);
    expect(result.status.requested).toBe(true);
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.send.mock.calls[0]?.[0]).toContain(`"commit":"${newer}"`);
    expect(f.send.mock.calls[0]?.[0]).toContain("I authorize you to install");
    expect(f.send.mock.calls[0]?.[0]).toContain("configured fork, release");
    await f.service.request(status.token!, f.send);
    expect(f.send).toHaveBeenCalledOnce();
  });
  it("never sends for current, offline or unknown startup identity", async () => {
    const f = fixture();
    f.revision(old);
    expect((await f.service.check()).state).toBe("current");
    await f.service.request("stale", f.send);
    f.latest.mockRejectedValue(new Error("offline with secret credentials"));
    f.tick();
    expect(await f.service.check()).toMatchObject({ state: "unavailable" });
    await f.service.request("stale", f.send);
    expect(f.send).not.toHaveBeenCalled();
    const unknown = new UpdateService(async () => {
      throw new Error("unknown");
    }, f.latest);
    expect((await unknown.check()).state).toBe("unavailable");
  });
  it("keeps a verified newer installed npm version without requesting a downgrade", async () => {
    const f = fixture();
    f.latest.mockResolvedValue({
      revision: "1.0.0",
      immutable: "npm artifact",
      installedNewer: true,
    });
    expect(await f.service.check()).toMatchObject({
      state: "current",
      explanation: expect.stringContaining("newer"),
    });
    await f.service.request("obsolete", f.send);
    expect(f.send).not.toHaveBeenCalled();
  });
  it("shares bounded refreshes, retries failures and revalidates every click", async () => {
    const f = fixture();
    const [a, b] = await Promise.all([f.service.check(), f.service.check()]);
    expect(a).toEqual(b);
    await f.service.check();
    expect(f.latest).toHaveBeenCalledOnce();
    f.latest.mockRejectedValueOnce(new Error("offline"));
    f.tick();
    expect((await f.service.check()).state).toBe("unavailable");
    f.tick();
    expect((await f.service.check()).state).toBe("available");
    f.revision(old);
    expect((await f.service.request(a.token!, f.send)).status.state).toBe(
      "current",
    );
    expect(f.send).not.toHaveBeenCalled();
  });
  it("refuses an obsolete target and source races without sending", async () => {
    const f = fixture();
    const status = await f.service.check();
    f.revision("c".repeat(40));
    expect((await f.service.request(status.token!, f.send)).agentId).toBeNull();
    expect(f.send).not.toHaveBeenCalled();
    f.latest.mockImplementationOnce(async () => {
      f.source({ identity: "different fork" });
      return { revision: newer, immutable: newer };
    });
    expect((await f.service.check(true)).state).toBe("unavailable");
  });
  it("prevents concurrent requests across clients while rechecking and sending", async () => {
    const f = fixture();
    const status = await f.service.check();
    let release!: (value: string) => void;
    f.send.mockImplementation(async (_text, beforeSend) => {
      await beforeSend();
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    });
    const first = f.service.request(status.token!, f.send);
    const second = await f.service.request(status.token!, f.send);
    expect(second.agentId).toBeNull();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release("mate");
    await first;
    expect(f.send).toHaveBeenCalledOnce();
  });
  it("does not claim installation before the running identity changes on reload", async () => {
    const f = fixture();
    const status = await f.service.check();
    await f.service.request(status.token!, f.send);
    expect((await f.service.check(true)).state).toBe("available");
    f.source({ revision: newer });
    expect(await f.service.check(true)).toMatchObject({
      state: "unavailable",
      explanation: expect.stringContaining("Reload"),
    });
    const reloaded = new UpdateService(f.read, f.latest);
    expect((await reloaded.check()).state).toBe("current");
  });
  it("passes delivery failures through and allows retry without claiming success", async () => {
    const f = fixture();
    const status = await f.service.check();
    f.send.mockRejectedValueOnce(
      new Error("A first-mate handover needs recovery"),
    );
    await expect(f.service.request(status.token!, f.send)).rejects.toThrow(
      "handover",
    );
    expect((await f.service.check()).requested).toBe(false);
    expect((await f.service.request(status.token!, f.send)).agentId).toBe(
      "mate",
    );
  });
  it("does not repeat an ambiguously accepted message after a lost send response", async () => {
    const f = fixture();
    const status = await f.service.check();
    f.send.mockImplementationOnce(async (_text, beforeSend) => {
      await beforeSend();
      throw new Error("connection lost after acceptance");
    });
    await expect(f.service.request(status.token!, f.send)).rejects.toThrow(
      "connection lost",
    );
    expect((await f.service.check()).requested).toBe(true);
    expect(await f.service.check(true)).toMatchObject({
      state: "available",
      requested: true,
      explanation: expect.stringContaining("could not be confirmed"),
    });
    await f.service.request(status.token!, f.send);
    expect(f.send).toHaveBeenCalledOnce();
  });
  it("rechecks a target that changed while waiting for the mate lifecycle lock", async () => {
    const f = fixture();
    const status = await f.service.check();
    let accepted = 0;
    await expect(
      f.service.request(status.token!, async (_text, beforeSend) => {
        f.revision("c".repeat(40));
        await beforeSend();
        accepted++;
        return "mate";
      }),
    ).rejects.toThrow("changed before delivery");
    expect(accepted).toBe(0);
    expect((await f.service.check()).token).not.toBe(status.token);
  });
});
