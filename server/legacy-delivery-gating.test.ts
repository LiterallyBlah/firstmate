/** S12 F1–F3: real legacy adapters, temporary homes and controlled native calls. */
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CREW_LABELS } from "../shared/fleet";
import { itemTagKey } from "../shared/item-tags";
import { MIGRATION_COMPATIBILITY } from "../shared/supervision-migration";
import type { RemoteHost } from "../shared/remotes";
import { stopAgent } from "./cli";
import { updateFirstmateConfig, readFirstmateConfig } from "./config";
import { CaptainSteers, steerCrew, interruptCrew, exitCrew, relaunchCrew } from "./crew";
import { buildCards } from "./fleet";
import { parseBacklog } from "./backlog";
import type { PaseoApi } from "./host-types";
import { readThread, sendThread } from "./item-threads";
import { extendBurstNote } from "./mate";
import { steerRemoteCrew, interruptRemoteCrew, exitRemoteCrew, type RemoteGateway } from "./remote-crew";
import { cutoverGate, type CutoverGate } from "./supervision-gate";
import { WatchRunner } from "./watches";

vi.mock("./cli", () => ({ stopAgent: vi.fn(async () => undefined) }));
let home: string, gate: CutoverGate;
let probe: () => Promise<void>;
let sent: string[];
const homeRoot = process.env.PASEO_HOME!;
beforeEach(async () => {
  vi.clearAllMocks();
  home = join(homeRoot, randomUUID(), "home"); await mkdir(home, { recursive: true });
  await updateFirstmateConfig({ home, mateAgentId: "", migration: null, mateLaunch: null });
  await updateFirstmateConfig({ mateAgentId: "general" });
  gate = cutoverGate(home); sent = []; probe = async () => undefined;
  vi.mocked(stopAgent).mockImplementation(async () => { await probe(); sent.push("interrupt"); });
});
afterEach(() => vi.restoreAllMocks());
async function freeze(stage: "freeze" | "committed" = "freeze") {
  await gate.run(() => gate.publishSidecar({ format: "firstmate.cutover-sidecar/1", compatibility: MIGRATION_COMPATIBILITY,
    stage, homeId: "fixture", planId: "scheduler", migrationId: randomUUID(), scopeId: randomUUID(), at: new Date().toISOString(),
    sourceHash: "1".repeat(64), inventoryHash: "2".repeat(64), transaction: null,
    tokens: { plan: "scheduler", nodes: ["build"], actions: [], agents: ["worker"], tasks: [{ task: "build", host: "local" }] } }));
}
async function pendingClaim(recipient: string) {
  const rows = await gate.claims(); expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ claim: { recipient }, result: null });
  // Network calls must run outside the non-reentrant gate lock.
  await gate.run(async () => undefined);
}
async function acceptedClaim(recipient: string) {
  expect(await gate.claims()).toEqual([expect.objectContaining({ claim: expect.objectContaining({ recipient }), result: expect.objectContaining({ outcome: "accepted" }) })]);
}
async function refused() { expect(await readdir(join(gate.directory, "refusals"))).toHaveLength(1); }
function api() {
  return { agents: { ref: (id: string) => ({
    refresh: async () => ({ agent: { id, title: id, status: "idle", archivedAt: null, pendingPermissions: [],
      labels: { [CREW_LABELS.role]: id === "worker" ? CREW_LABELS.crewRole : CREW_LABELS.mateRole } } }),
    send: async () => { await probe(); sent.push(id); }, archive: async () => { await probe(); sent.push("end"); },
  }) } } as unknown as PaseoApi;
}
const localActions = {
  steer: () => steerCrew(api(), new CaptainSteers(), "worker", "change"),
  interrupt: () => interruptCrew(api(), "worker"),
  end: () => exitCrew(api(), "worker"),
  relaunch: () => relaunchCrew(api(), "worker", "again"),
};
it.each(Object.keys(localActions) as (keyof typeof localActions)[])("F2 local %s claims before native delivery and settles", async action => {
  await gate.arm([]); const recipient = action === "relaunch" ? "general" : "worker";
  probe = () => pendingClaim(recipient);
  await localActions[action](); expect(sent).toHaveLength(1); await acceptedClaim(recipient);
});
it.each(Object.keys(localActions) as (keyof typeof localActions)[])("F2 local %s refuses a frozen worker and records it", async action => {
  await gate.arm([]); await freeze();
  await expect(localActions[action]()).rejects.toThrow(/cutover/);
  expect(sent).toEqual([]); await refused(); expect(await gate.claims()).toEqual([]);
});
it.each(Object.keys(localActions) as (keyof typeof localActions)[])("F2 local %s records a lost native acknowledgement as uncertain", async action => {
  await gate.arm([]); probe = async () => { throw new Error("acknowledgement lost"); };
  await expect(localActions[action]()).rejects.toThrow("acknowledgement lost");
  expect(await gate.claims()).toEqual([expect.objectContaining({ result: expect.objectContaining({ outcome: "uncertain" }) })]);
});
it.each(Object.keys(localActions) as (keyof typeof localActions)[])("F2 local %s rechecks a freeze after its preliminary verdict", async action => {
  await gate.arm([]); const verdict = gate.verdict.bind(gate); let calls = 0;
  vi.spyOn(gate, "verdict").mockImplementation(async (...args) => {
    const result = await verdict(...args); if (++calls === 1) await freeze(); return result;
  });
  await expect(localActions[action]()).rejects.toThrow(/cutover/);
  expect(sent).toEqual([]); await refused();
});
it("a claim persistence failure prevents a native operation", async () => {
  await gate.arm([]);
  vi.spyOn(gate, "claimHeld").mockRejectedValue(new Error("claim disk unavailable"));
  await expect(localActions.steer()).rejects.toThrow("claim disk unavailable"); expect(sent).toEqual([]);
});

function remote() {
  const host = { serverId: "remote-host", label: "Remote", workers: [{ id: "worker", name: "Build" }] } as RemoteHost;
  return { read: async () => ({ hosts: [host] }), request: async () => { await probe(); sent.push("remote"); } } as unknown as RemoteGateway;
}
const remoteActions = {
  steer: () => steerRemoteCrew(remote(), "remote-host", "worker", "change"),
  interrupt: () => interruptRemoteCrew(remote(), "remote-host", "worker"),
  end: () => exitRemoteCrew(remote(), "remote-host", "worker"),
};
it.each(Object.keys(remoteActions) as (keyof typeof remoteActions)[])("F1 remote %s claims before request and settles", async action => {
  await gate.arm([]); probe = () => pendingClaim("remote:remote-host:worker");
  await remoteActions[action](); expect(sent).toEqual(["remote"]); await acceptedClaim("remote:remote-host:worker");
});
it.each(Object.keys(remoteActions) as (keyof typeof remoteActions)[])("F1 remote %s refuses a committed worker before request", async action => {
  await gate.arm([]); await freeze("committed");
  await expect(remoteActions[action]()).rejects.toThrow(/scoped supervisor/);
  expect(sent).toEqual([]); await refused();
});
it.each(Object.keys(remoteActions) as (keyof typeof remoteActions)[])("F1 remote %s records an uncertain request without retry", async action => {
  await gate.arm([]); let requests = 0;
  probe = async () => { requests++; throw new Error("acknowledgement lost"); };
  await expect(remoteActions[action]()).rejects.toThrow("acknowledgement lost"); expect(requests).toBe(1);
  expect(await gate.claims()).toEqual([expect.objectContaining({ result: expect.objectContaining({ outcome: "uncertain" }) })]);
});
it("F1 remote admission catches a freeze after the S08 guard", async () => {
  await gate.arm([]);
  await expect(steerRemoteCrew(remote(), "remote-host", "worker", "change", async () => { await freeze(); })).rejects.toThrow(/cutover/);
  expect(sent).toEqual([]); await refused();
});

const item = () => buildCards(parseBacklog("## Queued\n- [ ] build - Build (project: web)"), [])[0]!;
const discussion = () => ({ key: itemTagKey(item()), id: "message", kind: "discuss" as const, text: "options?" });
it("F2 discussion claims its captured recipient before delivery and settles before sent", async () => {
  await gate.arm([]);
  await sendThread(home, item(), discussion(), async (_text, _id, before) => {
    await before("general"); await pendingClaim("general");
    expect((await readThread(home, discussion().key)).messages[0]!.delivery).toBe("uncertain"); sent.push("discussion");
  });
  await acceptedClaim("general"); expect((await readThread(home, discussion().key)).messages[0]!.delivery).toBe("sent");
});
it("F2 discussion rechecks under the gate after lifecycle checks and refuses before reservation", async () => {
  await gate.arm([]);
  await expect(sendThread(home, item(), discussion(), async (_text, _id, before) => {
    await freeze(); await before("general"); sent.push("discussion");
  })).rejects.toThrow(/cutover/);
  expect(sent).toEqual([]); expect((await readThread(home, discussion().key)).messages).toEqual([]); await refused();
});
it("F2 discussion retains an uncertain claim and never redelivers the same message", async () => {
  await gate.arm([]); let sends = 0;
  const deliver = async (_text: string, _id: string, before: (id: string) => Promise<void>) => {
    await before("general"); sends++; throw new Error("acknowledgement lost");
  };
  await sendThread(home, item(), discussion(), deliver); await freeze();
  await sendThread(home, item(), discussion(), deliver);
  expect(sends).toBe(1); expect((await readThread(home, discussion().key)).messages[0]!.delivery).toBe("uncertain");
  expect(await gate.claims()).toEqual([expect.objectContaining({ result: expect.objectContaining({ outcome: "uncertain" }) })]);
});

function runner(stdout = "scheduler needs attention", deliver: (text: string) => Promise<"sent" | "wait"> = async () => "sent") {
  return new WatchRunner({ home: async () => home, disabled: async () => [], deliver,
    gate: async () => ({ gate, recipient: "general" }), stateFile: join(home, "watches.json"), scriptStateRoot: join(home, "watch-state"),
    run: async () => ({ code: 0, timedOut: false, stdout, stderr: "", truncated: false, spawnError: null }) });
}
it.each(["prompt", "script"])("F3 watch %s enqueue admits unrelated output under the gate", async kind => {
  await gate.arm([]); await freeze(); const r = runner("healthy");
  try {
    if (kind === "prompt") await r.enqueuePrompt("probe", "healthy", new Date());
    else await r.runOne(home, { name: "probe", path: join(home, "probe") } as never);
    expect(await r.queued()).toHaveLength(1);
  } finally { r.stop(); }
});
it.each(["prompt", "script"])("F3 watch %s enqueue holds frozen output in the queue before delivery", async kind => {
  await gate.arm([]); await freeze(); const r = runner();
  try {
    await expect(kind === "prompt" ? r.enqueuePrompt("probe", "scheduler needs attention", new Date())
      : r.runOne(home, { name: "probe", path: join(home, "probe") } as never)).rejects.toThrow(/cutover/);
    expect(await r.queued()).toEqual([expect.objectContaining({ text: "scheduler needs attention", hold: expect.objectContaining({ plan: "scheduler" }) })]); await refused();
    expect((await r.held()).map(record => record.note.text)).toEqual(["scheduler needs attention"]);
  } finally { r.stop(); }
});
it("R1 stateful watch output survives refusal, reload and abort after its baseline advances", async () => {
  await gate.arm([]); await freeze(); const sent: string[] = [];
  const output = "scheduler: UNIQUE_LOST_WATCH_EVIDENCE_161; unrelated project also failed";
  const stateFile = join(home, "watches.json"), scriptStateRoot = join(home, "watch-state");
  const create = () => new WatchRunner({ home: async () => home, disabled: async () => [],
    gate: async () => ({ gate, recipient: "general" }), stateFile, scriptStateRoot,
    deliver: async text => { sent.push(text); return "sent"; },
    run: async (_path, options) => {
      const baseline = join(options.env.FIRSTMATE_WATCH_STATE!, "baseline.json");
      let observed = false;
      try { observed = JSON.parse(await readFile(baseline, "utf8")).observed; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      await writeFile(baseline, JSON.stringify({ observed: true }));
      return { code: 0, timedOut: false, stdout: observed ? "" : output, stderr: "", truncated: false, spawnError: null };
    } });
  let r = create(); const watch = { name: "probe", path: join(home, "probe") } as never;
  try {
    await expect(r.runOne(home, watch)).rejects.toThrow(/cutover/);
    expect(await r.queued()).toHaveLength(1); await r.flush(); expect(sent).toEqual([]);
    r.stop(); r = create(); // The producer baseline has advanced; only durable retention can recover this output.
    const { hash: _hash, ...frozen } = (await gate.sidecar("scheduler", "freeze"))!;
    await gate.run(() => gate.publishSidecar({ ...frozen, stage: "aborted" }));
    await r.runOne(home, watch, new Date(Date.now() + 60_000)); await r.flush();
    expect(sent).toHaveLength(1); expect(sent[0]).toContain(output);
    r.stop(); r = create(); await r.flush(); expect(sent).toHaveLength(1);
  } finally { r.stop(); }
});
it("R1 held payloads survive queue pressure and message fitting until each is sent", async () => {
  await gate.arm([]); const sent: string[] = [];
  const r = runner("scheduler needs attention", async text => { sent.push(text); return "sent"; });
  // Ordinary overflow can drop ordinary rows, but a queued hold must survive every later admission.
  try {
    for (let i = 0; i < 20; i++) await r.enqueuePrompt(`ordinary-${i}`, "healthy", new Date());
    await freeze();
    for (let i = 0; i < 3; i++) await expect(r.enqueuePrompt(`held-${i}`, `scheduler HELD_${i} ${"x".repeat(15980)}`, new Date())).rejects.toThrow(/retained durably/);
    expect(await r.held()).toHaveLength(3); expect(await r.queued()).toHaveLength(20);
    const { hash: _hash, ...frozen } = (await gate.sidecar("scheduler", "freeze"))!;
    await gate.run(() => gate.publishSidecar({ ...frozen, stage: "aborted" }));
    for (let i = 0; i < 20; i++) await r.flush(); // Every admitted occurrence gets an ordered turn.
    expect(await r.held()).toEqual([]);
    for (let i = 0; i < 3; i++) expect(sent.join("\n")).toContain(`HELD_${i}`);
  } finally { r.stop(); }
});
it("R1 commit alone cannot release retained watch output", async () => {
  await gate.arm([]); await freeze(); const r = runner();
  try {
    await expect(r.enqueuePrompt("probe", "scheduler needs attention", new Date())).rejects.toThrow(/retained durably/);
    const { hash: _hash, ...frozen } = (await gate.sidecar("scheduler", "freeze"))!;
    await gate.run(() => gate.publishSidecar({ ...frozen, stage: "committed" }));
    await r.flush(); expect(await r.queued()).toHaveLength(1); expect(await r.held()).toHaveLength(1);
    expect(await r.pendingDelivery("probe")).toBe(true);
  } finally { r.stop(); }
});
it("R1 another home's same-named abort cannot release a held payload", async () => {
  await gate.arm([]); await freeze(); const original = gate; const sent: string[] = [];
  const r = runner("", async text => { sent.push(text); return "sent"; });
  const abort = async () => {
    const { hash: _hash, ...frozen } = (await gate.sidecar("scheduler", "freeze"))!;
    await gate.run(() => gate.publishSidecar({ ...frozen, stage: "aborted" }));
  };
  try {
    await expect(r.enqueuePrompt("probe", "scheduler original output", new Date())).rejects.toThrow(/retained durably/);
    gate = cutoverGate(join(home, "other-home")); await gate.arm([]); await freeze(); await abort();
    await r.flush(); expect(sent).toEqual([]); expect(await r.held()).toHaveLength(1);
    gate = original; await abort(); await r.flush();
    expect(sent).toHaveLength(1); expect(await r.held()).toEqual([]);
  } finally { gate = original; r.stop(); }
});
async function burst(key = "worker") {
  const now = Date.now();
  await updateFirstmateConfig({ mateNotes: [{ id: "burst-note", text: "answer", burst: { key, parts: ["answer"], relates: [],
    startedAt: new Date(now).toISOString(), holdUntil: new Date(now + 20_000).toISOString() } }] });
  return now;
}
it("F3 burst extension admits an unrelated worker", async () => {
  await gate.arm([]); await freeze(); const now = await burst("unrelated-worker"); const before = (await readFirstmateConfig()).mateNotes[0]!.burst!.holdUntil;
  await extendBurstNote("unrelated-worker", () => now + 10_000);
  expect((await readFirstmateConfig()).mateNotes[0]!.burst!.holdUntil).not.toBe(before);
});
it("F3 burst extension records a refusal without changing the captured payload", async () => {
  await gate.arm([]); const now = await burst(); const before = (await readFirstmateConfig()).mateNotes;
  await freeze(); await extendBurstNote("worker", () => now + 10_000);
  expect((await readFirstmateConfig()).mateNotes).toEqual(before); await refused();
});
it("all local and remote controls remain write-free to supervision while unarmed", async () => {
  for (const action of Object.values(localActions)) await action();
  for (const action of Object.values(remoteActions)) await action();
  await sendThread(home, item(), discussion(), async (_text, _id, before) => { await before("general"); });
  const r = runner(); await r.enqueuePrompt("probe", "scheduler needs attention", new Date()); r.stop();
  const now = await burst(); await extendBurstNote("worker", () => now + 10_000);
  expect(sent).toHaveLength(7);
  await expect(readdir(gate.directory)).rejects.toMatchObject({ code: "ENOENT" });
});
