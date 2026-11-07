/** Opt-in, temporary-home CPU reproduction. No daemon, provider or live data. */
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { inboxFixture, api, timelinePage } from "../../test/supervision-inbox-fixture";
import type { PaseoAgent } from "../../server/host-types";
import { expected, scope } from "../../test/supervision-fixture";

it.skipIf(!process.env.FIRSTMATE_IDLE_CPU_EVIDENCE)("measures identical idle recovery/catalog beats in an isolated home", async () => {
  const f = await inboxFixture();
  // Enough history to make repeated replay visible without copying the owner's journal.
  for (let n = 0; n < 100; n++) {
    const value = { ...scope(f.store.homeId), id: randomUUID() }, mutations = [{ kind: "scope" as const, value }];
    await f.store.transact(expected(mutations), randomUUID(), mutations);
  }
  const agent = { id: "worker-a", status: "idle", updatedAt: "unchanged", pendingPermissions: [] } as unknown as PaseoAgent;
  const refetch = vi.fn(async () => timelinePage()), paseo = api(refetch);
  const scan = vi.spyOn(f.store as unknown as { scanFull: () => Promise<unknown> }, "scanFull");
  const beat = async () => {
    const pass = async () => { await f.events.boot(); await f.events.catalog([agent], paseo); };
    // The fallback is main's pre-fix heartbeat, for the same reproduction on both revisions.
    const recoveryPass = (f.store as unknown as { recoveryPass?: (trigger: "heartbeat", run: () => Promise<void>) => Promise<void> }).recoveryPass;
    if (recoveryPass) await recoveryPass.call(f.store, "heartbeat", pass);
    else { await f.store.audit(); await pass(); }
  };
  await beat(); await beat(); // Establish both the audit and observed-source baselines.
  scan.mockClear(); refetch.mockClear();
  const before = (await f.store.read()).sequence, cpu = process.cpuUsage(), start = performance.now();
  let beats = 0;
  // The minute recovery lane is accelerated to one beat/second, equally on both revisions.
  while (performance.now() - start < 30_000) { await beat(); beats++; await new Promise(r => setTimeout(r, 1000)); }
  const used = process.cpuUsage(cpu), wallMs = performance.now() - start;
  const result = { fixture: "100 scope transactions plus two registered workers", wallMs, cpuMs: (used.user + used.system) / 1000,
    cores: (used.user + used.system) / (wallMs * 1000), beats, fullScans: scan.mock.calls.length,
    nativeTimelineReads: refetch.mock.calls.length, journalAppends: (await f.store.read()).sequence - before };
  const out = process.env.FIRSTMATE_IDLE_CPU_EVIDENCE!; await mkdir(join(out, ".."), { recursive: true });
  await writeFile(out, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  expect(result.beats).toBeGreaterThan(0);
}, 120_000);
