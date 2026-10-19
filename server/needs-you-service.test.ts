import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { NeedsYouSnapshot } from "../shared/needs-you";
import { FirstmateConfigSchema, FleetSchema } from "../shared/fleet";
import {
  NeedsYouService,
  readDecisionBacklog,
  readConfiguredDecisionHome,
} from "./needs-you-service";
import { dataPath } from "./data-dir";
import {
  canonicalDecisionHome,
  NeedsYouStore,
  writeDecisionLedger,
} from "./needs-you-store";
import { registerNeedsYouRpc } from "./needs-you-rpc";
import { loadFleet, ReportCache } from "./fleet";
import type { PaseoApi } from "./host-types";

const document = (fields = "(hold: Decide?)", section = "Queued") =>
  `# Backlog\n## In flight\n${section === "In flight" ? `- [ ] task - Task ${fields}` : ""}\n## Queued\n${section === "Queued" ? `- [ ] task - Task ${fields}` : ""}\n## Done\n${section === "Done" ? `- [x] task - Task ${fields}` : ""}\n`;
let scratch: string;
let home: string;
let root: string;
let now: number;
const services: NeedsYouService[] = [];
beforeEach(async () => {
  scratch = await mkdtemp(join(process.env.PASEO_HOME!, "decisions-"));
  home = join(scratch, "home");
  root = join(scratch, "plugin-ledgers");
  now = 1000;
  await mkdir(join(home, "data"), { recursive: true });
  await writeFile(join(home, "data", "backlog.md"), document());
  await writeFile(
    join(home, "data", "suggestions.md"),
    "- Option :: The captain's words\n",
  );
});
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stop()));
  vi.useRealTimers();
});

function service(
  overrides: Partial<ConstructorParameters<typeof NeedsYouService>[0]> = {},
) {
  const instance = new NeedsYouService({
    root,
    home: async () => home,
    catalog: async () => null,
    enabled: () => true,
    now: () => now,
    ...overrides,
  });
  services.push(instance);
  return instance;
}
async function settle(instance: NeedsYouService) {
  await instance.read();
  now += 2000;
  return instance.read();
}
function target(snapshot: NeedsYouSnapshot) {
  const request = snapshot.requests.at(-1)!;
  return {
    homeId: snapshot.homeId!,
    id: request.id,
    revision: request.revision,
  };
}
async function ledgerPath() {
  return join(root, (await readdir(root))[0]!, "ledger.json");
}

describe("service persistence and observation", () => {
  it("requires stable reads, silently baselines, and leaves every authored byte unchanged", async () => {
    const instance = service();
    expect(await instance.read()).toMatchObject({
      actionCount: null,
      freshness: { status: "unknown" },
    });
    now += 1999;
    expect((await instance.read()).actionCount).toBeNull();
    now++;
    const baseline = await instance.read();
    expect(baseline).toMatchObject({
      actionCount: 1,
      newCount: 0,
      freshness: { status: "fresh" },
    });
    await instance.mutate(target(baseline), { kind: "seen" });
    expect(await readFile(join(home, "data", "backlog.md"), "utf8")).toBe(
      document(),
    );
    expect(await readFile(join(home, "data", "suggestions.md"), "utf8")).toBe(
      "- Option :: The captain's words\n",
    );
    expect(await readdir(join(home, "data"))).toEqual([
      "backlog.md",
      "suggestions.md",
    ]);
  });

  it("defaults off with no disk writes or source reads, retaining existing state for re-enable", async () => {
    const readSource = vi.fn(readDecisionBacklog);
    const disabled = service({
      enabled: () => process.env.FIRSTMATE_NEEDS_YOU === "1",
      readSource,
    });
    expect(await disabled.read()).toMatchObject({
      actionCount: null,
      delivery: "off",
      freshness: { status: "disabled" },
    });
    expect(readSource).not.toHaveBeenCalled();
    await expect(readdir(root)).rejects.toMatchObject({ code: "ENOENT" });
    let enabled = true;
    const instance = service({ enabled: () => enabled });
    const before = await settle(instance);
    enabled = false;
    expect((await instance.read()).freshness.status).toBe("disabled");
    enabled = true;
    expect((await instance.read()).requests).toEqual(before.requests);
  });

  it("reconciles on its timer with no UI or agent handle, starts once, and stops cleanly", async () => {
    vi.useFakeTimers({
      toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"],
    });
    const readSource = vi.fn(readDecisionBacklog);
    const instance = service({ readSource });
    instance.start();
    instance.start();
    await instance.read();
    now += 5000;
    await vi.advanceTimersByTimeAsync(5000);
    await instance.read();
    const saved = JSON.parse(await readFile(await ledgerPath(), "utf8"));
    expect(saved.requests).toHaveLength(1);
    expect(readSource).toHaveBeenCalledTimes(2);
    await instance.stop();
    now += 30000;
    await vi.advanceTimersByTimeAsync(30000);
    expect(readSource).toHaveBeenCalledTimes(2);
  });

  it("detects new gates on periodic reads after an atomic file replacement", async () => {
    const instance = service();
    await writeFile(join(home, "data", "backlog.md"), document(""));
    await settle(instance);
    await writeFile(join(home, "data", "backlog.tmp"), document());
    await rename(
      join(home, "data", "backlog.tmp"),
      join(home, "data", "backlog.md"),
    );
    const changed = await settle(instance);
    expect(changed).toMatchObject({ actionCount: 1, newCount: 1 });
    expect(
      JSON.parse(await readFile(await ledgerPath(), "utf8")).outbox,
    ).toHaveLength(1);
  });

  it("restarts with Seen, snooze and uncertain answer state; expired snooze wakes just once", async () => {
    const instance = service();
    const before = await settle(instance);
    const seen = await instance.mutate(target(before), { kind: "seen" });
    const snoozed = await instance.mutate(target(seen), {
      kind: "snooze",
      until: now + 3000,
    });
    await instance.stop();
    const restarted = service();
    expect((await restarted.read()).requests).toEqual(snoozed.requests);
    now += 3000;
    const awake = await restarted.read();
    expect(awake).toMatchObject({
      actionCount: 1,
      newCount: 1,
      snoozedCount: 0,
    });
    const pending = await restarted.mutate(target(awake), {
      kind: "answer",
      submissionId: "answer-1",
      outcome: "uncertain",
    });
    await restarted.stop();
    const third = service();
    const persisted = await settle(third);
    expect(persisted.requests).toEqual(pending.requests);
    expect(persisted).toMatchObject({ actionCount: 0, pendingAnswerCount: 1 });
    const events = JSON.parse(
      await readFile(await ledgerPath(), "utf8"),
    ).outbox;
    expect(
      events.filter((event: { kind: string }) => event.kind === "snooze-due"),
    ).toHaveLength(1);
  });

  it("keeps the last good state on missing, empty, malformed, ambiguous and unreadable input", async () => {
    const instance = service();
    const before = await settle(instance);
    const path = join(home, "data", "backlog.md");
    for (const content of [
      null,
      "",
      document("", "absent"),
      document("(hold: incomplete"),
      document() + "## Queued\n- [ ] task - Task (hold: Duplicate)",
    ]) {
      if (content === null) await rm(path);
      else await writeFile(path, content);
      const stale = await settle(instance);
      expect(stale).toMatchObject({
        actionCount: 1,
        version: before.version,
        freshness: { status: "stale" },
      });
      expect(stale.requests).toEqual(before.requests);
      await expect(
        instance.mutate(target(before), { kind: "seen" }),
      ).rejects.toThrow("stale");
    }
    await rm(path);
    await mkdir(path);
    expect((await settle(instance)).actionCount).toBe(1);
    await rmdir(path);
    await writeFile(path, document());
    expect((await settle(instance)).requests).toEqual(before.requests);
  });

  it("does not reset baseline when the source is initially missing", async () => {
    await rm(join(home, "data", "backlog.md"));
    const instance = service();
    expect((await settle(instance)).actionCount).toBeNull();
    await writeFile(join(home, "data", "backlog.md"), document());
    expect(await settle(instance)).toMatchObject({
      actionCount: 1,
      newCount: 0,
    });
  });

  it("holds state through a half-written removal, then resolves only a stable present task", async () => {
    const instance = service();
    const before = await settle(instance);
    await writeFile(join(home, "data", "backlog.md"), document(""));
    const changing = await instance.read();
    expect(changing.actionCount).toBe(1);
    await expect(
      instance.mutate(target(before), {
        kind: "answer",
        submissionId: "stale",
        outcome: "accepted",
      }),
    ).rejects.toThrow("stale");
    now += 2000;
    const resolved = await instance.read();
    expect(resolved.actionCount).toBe(0);
    expect(resolved.requests[0]?.resolution?.reason).toBe("answered");
  });

  it("retains namespace through canonical path aliases; a new home has its own baseline", async () => {
    let configured = home;
    const instance = service({ home: async () => configured });
    const before = await settle(instance);
    const alias = join(scratch, "alias");
    await symlink(
      home,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    configured = alias;
    expect((await instance.read()).homeId).toBe(before.homeId);
    configured = join(scratch, "other-home");
    await mkdir(join(configured, "data"), { recursive: true });
    await writeFile(join(configured, "data", "backlog.md"), document());
    const other = await settle(instance);
    expect(other.homeId).not.toBe(before.homeId);
    expect(other.newCount).toBe(0);
    await expect(
      instance.mutate(target(before), { kind: "seen" }),
    ).rejects.toThrow("home changed");
    configured = home;
    expect((await instance.read()).requests).toEqual(before.requests);
  });

  it("keeps state when the home disappears across a process restart", async () => {
    const instance = service();
    const before = await settle(instance);
    await instance.stop();
    await rename(home, join(scratch, "moved-home"));
    const restarted = service();
    expect(await restarted.read()).toMatchObject({
      homeId: before.homeId,
      actionCount: 1,
      freshness: { status: "stale" },
    });
  });

  it("does not write unchanged polls, and two clients cannot lose each other's acknowledgements", async () => {
    const writer = vi.fn(writeDecisionLedger);
    const instance = service({
      store: (root, home) => new NeedsYouStore(root, home, writer),
    });
    const before = await settle(instance);
    const writes = writer.mock.calls.length;
    now += 5000;
    expect((await instance.read()).version).toBe(before.version);
    expect(writer).toHaveBeenCalledTimes(writes);
    const responses = await Promise.all([
      instance.mutate(target(before), { kind: "seen" }),
      instance.mutate(target(before), { kind: "seen" }),
    ]);
    expect(responses[0]?.version).toBe(responses[1]?.version);
    expect(writer).toHaveBeenCalledTimes(writes + 1);
  });

  it("serializes multiple service/store callers for the same home", async () => {
    const first = service();
    const second = service();
    await Promise.all([first.read(), second.read()]);
    now += 2000;
    const [a, b] = await Promise.all([first.read(), second.read()]);
    expect(a.homeId).toBe(b.homeId);
    const [seen, snoozed] = await Promise.all([
      first.mutate(target(a), { kind: "seen" }),
      second.mutate(target(b), { kind: "snooze", until: 10000 }),
    ]);
    const persisted = await first.read();
    expect(persisted.requests[0]).toMatchObject({
      state: "snoozed",
      seenAt: now,
    });
    expect(snoozed.version).toBeGreaterThan(seen.version);
  });

  it("fails closed on corrupt or lost ledger files, including after restart", async () => {
    const instance = service();
    const before = await settle(instance);
    const path = await ledgerPath();
    for (const corrupt of ["{broken", JSON.stringify({ schema: 999 }), null]) {
      if (corrupt === null) await rm(path);
      else await writeFile(path, corrupt);
      expect(await instance.read()).toMatchObject({
        actionCount: 1,
        freshness: { status: "stale" },
      });
      const restarted = service();
      expect(await settle(restarted)).toMatchObject({
        actionCount: null,
        freshness: { status: "unknown" },
      });
      if (corrupt === null)
        await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
      else expect(await readFile(path, "utf8")).toBe(corrupt);
    }
    expect(before.requests).toHaveLength(1);
  });

  it("never acknowledges an uncommitted write, and recovers a lost response after a committed write", async () => {
    let fail: "before" | "after" | null = null;
    const writer = async (
      path: string,
      ledger: Parameters<typeof writeDecisionLedger>[1],
    ) => {
      if (fail === "before")
        throw new Error("simulated disk failure before rename");
      await writeDecisionLedger(path, ledger);
      if (fail === "after")
        throw new Error("simulated process death after rename");
    };
    const instance = service({
      store: (root, home) => new NeedsYouStore(root, home, writer),
    });
    const before = await settle(instance);
    const path = await ledgerPath();
    const bytes = await readFile(path, "utf8");
    fail = "before";
    await expect(
      instance.mutate(target(before), { kind: "seen" }),
    ).rejects.toThrow("disk failure");
    expect(await readFile(path, "utf8")).toBe(bytes);
    fail = "after";
    await expect(
      instance.mutate(target(before), {
        kind: "answer",
        submissionId: "lost-response",
        outcome: "uncertain",
      }),
    ).rejects.toThrow("process death");
    fail = null;
    const restarted = service();
    const pending = await settle(restarted);
    const replay = await restarted.mutate(target(pending), {
      kind: "answer",
      submissionId: "lost-response",
      outcome: "uncertain",
    });
    expect(replay.version).toBe(pending.version);
    expect(replay).toMatchObject({ actionCount: 0, pendingAnswerCount: 1 });
    expect(replay.requests[0]?.submissions).toHaveLength(1);
  });

  it("ignores a crash-left staging file and preserves an initialized ledger", async () => {
    const instance = service();
    const before = await settle(instance);
    await writeFile(`${await ledgerPath()}.crash.tmp`, "partial replacement");
    expect((await settle(service())).requests).toEqual(before.requests);
  });

  it("reports write failure during reconciliation with last durable counts", async () => {
    let fail = false;
    const instance = service({
      store: (root, home) =>
        new NeedsYouStore(root, home, async (path, ledger) => {
          if (fail) throw new Error("disk full");
          await writeDecisionLedger(path, ledger);
        }),
    });
    const before = await settle(instance);
    await writeFile(join(home, "data", "backlog.md"), document("", "Done"));
    fail = true;
    expect(await settle(instance)).toMatchObject({
      version: before.version,
      actionCount: 1,
      freshness: { status: "stale" },
    });
    fail = false;
    expect((await instance.read()).actionCount).toBe(0);
  });

  it("retains a known remote identity while its worker/catalog is unavailable", async () => {
    const catalog = {
      localServerId: "local-id",
      hosts: [
        {
          serverId: "remote",
          label: "Light",
          online: false,
          checkedAt: null,
          error: "offline",
          projects: [],
          workspaces: [],
          providers: [],
          workers: [],
        },
      ],
    };
    let offline = false;
    const instance = service({
      catalog: async () => {
        if (offline) throw new Error("offline");
        return catalog;
      },
    });
    await writeFile(
      join(home, "data", "backlog.md"),
      document("(host: Light) (hold: Decide?)"),
    );
    const before = await settle(instance);
    offline = true;
    expect((await instance.read()).requests).toEqual(before.requests);
    expect((await instance.read()).actionCount).toBe(1);
  });
});

describe("contracts and fleet integration", () => {
  it("malformed or deleted configuration cannot baseline the default home", async () => {
    const config = dataPath("config.json");
    await mkdir(dirname(config), { recursive: true });
    await writeFile(config, JSON.stringify({ home }));
    const instance = service({ home: readConfiguredDecisionHome });
    const before = await settle(instance);
    for (const broken of ["not json", JSON.stringify({ home: 123 }), null]) {
      if (broken === null) await rm(config);
      else await writeFile(config, broken);
      expect(await instance.read()).toMatchObject({
        homeId: before.homeId,
        actionCount: 1,
        freshness: { status: "stale" },
      });
      expect(
        await instance.observe(home, await readDecisionBacklog(home), null),
      ).toMatchObject({
        homeId: before.homeId,
        actionCount: 1,
        freshness: { status: "stale" },
      });
      await expect(
        instance.mutate(target(before), { kind: "seen" }),
      ).rejects.toThrow();
    }
    expect(await readdir(root)).toHaveLength(1);
  });

  it("rejects a fleet read for a formerly configured home", async () => {
    let configured = home;
    const instance = service({ home: async () => configured });
    const before = await settle(instance);
    const oldSource = await readDecisionBacklog(home);
    configured = join(scratch, "new-home");
    await mkdir(join(configured, "data"), { recursive: true });
    await writeFile(join(configured, "data", "backlog.md"), document(""));
    const changed = await settle(instance);
    expect(changed.homeId).not.toBe(before.homeId);
    const delayed = await instance.observe(home, oldSource, null);
    expect(delayed).toMatchObject({
      homeId: changed.homeId,
      actionCount: 0,
      freshness: { status: "stale" },
    });
  });

  it("refuses structurally valid JSON with inconsistent ledger identities or events", async () => {
    const instance = service();
    const before = await settle(instance);
    await instance.mutate(target(before), { kind: "seen" });
    const path = await ledgerPath();
    const valid = JSON.parse(await readFile(path, "utf8"));
    for (const corrupt of [
      { ...valid, requests: [...valid.requests, ...valid.requests] },
      { ...valid, sequence: valid.sequence + 1 },
      {
        ...valid,
        requests: [
          { ...valid.requests[0], state: "resolved", resolution: null },
        ],
      },
      { ...valid, homeId: "foreign" },
    ]) {
      await writeFile(path, JSON.stringify(corrupt));
      expect((await instance.read()).freshness.status).toBe("stale");
      expect((await settle(service())).actionCount).toBeNull();
    }
  });

  it("registers read and every mutation RPC with schema validation and no send path", async () => {
    const instance = service();
    await settle(instance);
    const handlers = new Map<
      string,
      {
        input: { parse: (input: unknown) => unknown };
        output: { parse: (output: unknown) => unknown };
        handle: (input: unknown) => Promise<unknown>;
      }
    >();
    const server = {
      handle: (
        rpc: {
          name: string;
          input: { parse: (input: unknown) => unknown };
          output: { parse: (output: unknown) => unknown };
        },
        handle: (input: unknown) => Promise<unknown>,
      ) => handlers.set(rpc.name, { ...rpc, handle }),
    } as unknown as Pick<PluginServerContext, "handle">;
    registerNeedsYouRpc(server, instance);
    async function call(name: string, input: unknown = {}) {
      const handler = handlers.get(`firstmate.needs-you.${name}`)!;
      return handler.output.parse(
        await handler.handle(handler.input.parse(input)),
      ) as NeedsYouSnapshot;
    }
    expect(handlers.size).toBe(5);
    const before = await call("read");
    const seen = await call("seen", target(before));
    expect(seen.actionCount).toBe(1);
    const snoozed = await call("snooze", { ...target(seen), until: 10000 });
    expect(snoozed.snoozedCount).toBe(1);
    const awake = await call("unsnooze", target(snoozed));
    expect(awake.actionCount).toBe(1);
    const pending = await call("record-answer", {
      ...target(awake),
      submissionId: "one",
      outcome: "uncertain",
    });
    expect(pending.pendingAnswerCount).toBe(1);
    const failed = await call("record-answer", {
      ...target(pending),
      submissionId: "one",
      outcome: "failed",
    });
    expect(failed.actionCount).toBe(1);
    const accepted = await call("record-answer", {
      ...target(failed),
      submissionId: "two",
      outcome: "accepted",
    });
    expect(accepted.requests[0]?.state).toBe("answer-sent");
    await expect(
      call("seen", { ...target(accepted), revision: 999 }),
    ).rejects.toThrow("changed");
    await expect(
      call("snooze", { ...target(accepted), until: "tomorrow" }),
    ).rejects.toThrow();
  });

  it("publishes the ledger snapshot with the same backlog read as fleet cards", async () => {
    const readSource = vi.fn(readDecisionBacklog);
    const instance = service({ readSource });
    await settle(instance);
    const paseo = {
      agents: { list: async () => ({ entries: [], hasMore: false }) },
      config: { get: async () => ({ mcp: { injectIntoAgents: true } }) },
    } as unknown as PaseoApi;
    readSource.mockClear();
    const fleet = await loadFleet(
      paseo,
      FirstmateConfigSchema.parse({ home }),
      new ReportCache(),
      async () => [],
      async () => null,
      instance,
    );
    expect(readSource).toHaveBeenCalledTimes(1);
    expect(fleet.cards[0]?.backlog?.hold).toBe("Decide?");
    expect(fleet.needsYou).toEqual(await instance.read());
    expect(FleetSchema.parse(fleet).needsYou?.actionCount).toBe(1);
  });

  it("canonical home paths are stable across dot segments and platform case", async () => {
    expect(await canonicalDecisionHome(join(home, "."))).toBe(
      await canonicalDecisionHome(home),
    );
    if (process.platform === "win32")
      expect(await canonicalDecisionHome(home.toUpperCase())).toBe(
        await canonicalDecisionHome(home),
      );
  });

  it("a delayed or replayed fleet source cannot undo a newer observation", async () => {
    const instance = service();
    await settle(instance);
    const delayed = await readDecisionBacklog(home);
    await writeFile(
      join(home, "data", "backlog.md"),
      document("(hold: A new question?)"),
    );
    const revised = await settle(instance);
    expect(revised.requests[0]?.revision).toBe(2);
    for (let count = 0; count < 3; count++) {
      now += 5000;
      expect(await instance.observe(home, delayed, null)).toEqual(revised);
    }
    expect((await instance.read()).requests).toEqual(revised.requests);
  });
});
