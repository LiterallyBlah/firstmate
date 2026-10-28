import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { MIGRATION_COMPATIBILITY } from '../shared/supervision-migration';
import { readFirstmateConfig, resolveHome, updateFirstmateConfig } from './config';
import { cutoverGate, type CutoverGate } from './supervision-gate';
import { deliverToMate } from './watch-service';
import { WatchRunner, type WatchRunnerOptions } from './watches';
import type { PaseoApi } from './host-types';

const proofs = process.env.PASEO_HOME!;
async function stage(gate: CutoverGate, plan: string, value: 'freeze' | 'committed' | 'aborted') {
  if (value !== 'freeze') {
    const { hash: _hash, ...body } = (await gate.sidecar(plan, 'freeze'))!;
    return gate.run(() => gate.publishSidecar({ ...body, stage: value }));
  }
  await gate.arm([]);
  return gate.run(() => gate.publishSidecar({ format: 'firstmate.cutover-sidecar/1', compatibility: MIGRATION_COMPATIBILITY,
    stage: value, homeId: 'fixture', planId: plan, migrationId: randomUUID(), scopeId: randomUUID(), at: new Date().toISOString(),
    sourceHash: '1'.repeat(64), inventoryHash: '2'.repeat(64), transaction: null,
    tokens: { plan, nodes: [], actions: [], agents: [], tasks: [] } }));
}
async function fixture(loseAck = false) {
  const root = join(process.env.PASEO_HOME!, randomUUID()), home = join(root, 'home');
  await mkdir(home, { recursive: true });
  await updateFirstmateConfig({ home, mateAgentId: '', migration: null, mateLaunch: null });
  await updateFirstmateConfig({ mateAgentId: 'general' });
  const gate = cutoverGate(home), messages: { id: string; text: string }[] = [], attempts: string[] = [];
  let busy = false, turnAfterSend = false;
  const api = { agents: { ref: (id: string) => ({
    refresh: async () => ({ agent: { id, status: busy ? 'running' : 'idle', archivedAt: null, pendingPermissions: [] } }),
    send: async (text: string, options: { messageId: string }) => {
      attempts.push(options.messageId);
      // Native message IDs deduplicate: different IDs create different actual messages.
      if (!messages.some(m => m.id === options.messageId)) messages.push({ id: options.messageId, text });
      if (turnAfterSend) busy = true;
      if (loseAck) { loseAck = false; throw new Error('accepted native message, acknowledgement lost'); }
    },
  }) } } as unknown as PaseoApi;
  const create = (options: Partial<WatchRunnerOptions> = {}) => new WatchRunner({ home: async () => home, disabled: async () => [],
    gate: async () => ({ gate, recipient: (await readFirstmateConfig()).mateAgentId }),
    stateFile: join(root, 'watches.json'), scriptStateRoot: join(root, 'script-state'),
    deliver: (text, expected) => deliverToMate(api, {} as never, text, readFirstmateConfig, expected), ...options });
  await stage(gate, 'harbor', 'freeze'); await stage(gate, 'harbor', 'committed');
  await stage(gate, 'scheduler', 'freeze');
  const prepare = async (runner: WatchRunner, held = true, associated = true) => {
    if (held) await expect(runner.enqueuePrompt('retained', 'scheduler harbor REPLAY_SENSITIVE_INSTRUCTION', new Date('2026-10-28T10:00:00Z'))).rejects.toThrow(/retained durably/);
    await stage(gate, 'scheduler', 'aborted');
    if (!held) await runner.enqueuePrompt('retained', `${associated ? 'harbor ' : ''}REPLAY_SENSITIVE_INSTRUCTION`, new Date('2026-10-28T10:00:00Z'));
  };
  return { gate, messages, attempts, root, create, prepare, set busy(value: boolean) { busy = value; }, set turnAfterSend(value: boolean) { turnAfterSend = value; } };
}

it.each(['no-fault', 'ack-lost', 'state-write-failed'])('RR8 retained native delivery must not repeat after reload (%s)', async mode => {
  const f = await fixture(mode === 'ack-lost'); let runner = f.create();
  let spy: ReturnType<typeof vi.spyOn> | undefined;
  try {
    await f.prepare(runner);
    const stableId = (await runner.queued())[0]!.ownership!.id;
    if (mode === 'state-write-failed') {
      const target = runner as unknown as { persist: (strict?: boolean) => Promise<void> };
      const persist = target.persist.bind(target); let injected = false;
      spy = vi.spyOn(target, 'persist').mockImplementation(async strict => {
        if (strict && f.messages.length > 0 && !injected) { injected = true; throw new Error('injected queue publication failure after accepted send'); }
        return persist(strict);
      });
      await expect(runner.flush()).rejects.toThrow(/publication failure/);
    } else await runner.flush();
    const firstClaims = await f.gate.claims();
    expect(f.messages).toHaveLength(1);
    spy?.mockRestore(); spy = undefined; runner.stop(); runner = f.create();
    for (let i = 0; i < 4; i++) await runner.flush();
    await writeFile(join(proofs, `${mode}-replay-evidence.json`), JSON.stringify({ messages: f.messages,
      firstClaims, finalClaims: await f.gate.claims(), held: await runner.held(), queued: await runner.queued() }, null, 2));
    expect(f.messages, 'retained native delivery already accepted once must not replay automatically with a new message ID').toHaveLength(1);
    expect(f.attempts).toEqual([stableId]); // Native dedupe must not conceal an automatic retry.
    expect(await runner.queued()).toHaveLength(mode === 'ack-lost' ? 1 : 0);
    if (mode === 'ack-lost') expect((await runner.queued())[0]!.delivery?.state).toBe('uncertain');
  } finally { spy?.mockRestore(); runner.stop(); }
});

it.each(['no-fault', 'ack-lost', 'state-write-failed'])('RR8 ordinary output uses the same at-most-once queue lifecycle (%s)', async mode => {
  const f = await fixture(mode === 'ack-lost'); let runner = f.create();
  let spy: ReturnType<typeof vi.spyOn> | undefined;
  try {
    await f.prepare(runner, false, false); // Pure traffic must also keep its receipt until queue publication.
    const stableId = (await runner.queued())[0]!.ownership!.id;
    const target = runner as unknown as { persist: (strict?: boolean) => Promise<void> };
    if (mode === 'state-write-failed') {
      const persist = target.persist.bind(target); let injected = false;
      spy = vi.spyOn(target, 'persist').mockImplementation(async strict => {
        if (strict && f.messages.length && !injected) { injected = true; throw new Error('post-send publication failed'); }
        return persist(strict);
      });
      await expect(runner.flush()).rejects.toThrow(/publication/);
    } else await runner.flush();
    spy?.mockRestore(); spy = undefined; runner.stop(); runner = f.create();
    for (let i = 0; i < 4; i++) await runner.flush();
    expect(f.attempts).toEqual([stableId]); expect(f.messages).toHaveLength(1);
    expect(await runner.queued()).toHaveLength(mode === 'ack-lost' ? 1 : 0);
  } finally { spy?.mockRestore(); runner.stop(); }
});

it('RR8 busy waits preserve the native occurrence ID through reload', async () => {
  const f = await fixture(); let runner = f.create();
  try {
    await f.prepare(runner); const stableId = (await runner.queued())[0]!.ownership!.id;
    f.busy = true; await runner.flush(); runner.stop(); runner = f.create(); await runner.flush();
    expect(f.attempts).toEqual([]); expect((await runner.queued())[0]!.ownership!.id).toBe(stableId);
    f.busy = false; await runner.flush(); expect(f.attempts).toEqual([stableId]);
  } finally { runner.stop(); }
});

it.each(['ack-lost', 'state-write-failed'])('RR8 a previously cached runner sees another writer reservation (%s)', async mode => {
  const f = await fixture(mode === 'ack-lost'), first = f.create(), cached = f.create();
  let spy: ReturnType<typeof vi.spyOn> | undefined;
  try {
    await f.prepare(first); await cached.queued();
    if (mode === 'state-write-failed') {
      const target = first as unknown as { persist: (strict?: boolean) => Promise<void> }, persist = target.persist.bind(target);
      spy = vi.spyOn(target, 'persist').mockImplementation(async strict => {
        if (strict && f.attempts.length) throw new Error('publication failed');
        return persist(strict);
      });
      await expect(first.flush()).rejects.toThrow(/publication/);
    } else await first.flush();
    spy?.mockRestore(); spy = undefined;
    await cached.flush(); await first.flush();
    expect(f.attempts).toHaveLength(1); expect(f.messages).toHaveLength(1);
    expect(await cached.queued()).toHaveLength(mode === 'ack-lost' ? 1 : 0);
  } finally { spy?.mockRestore(); first.stop(); cached.stop(); }
});

it('RR8 a reservation write failure calls no native send and preserves its occurrence ID', async () => {
  const f = await fixture(), runner = f.create();
  try {
    await f.prepare(runner); const id = (await runner.queued())[0]!.ownership!.id;
    const target = runner as unknown as { persist: (strict?: boolean) => Promise<void> };
    const spy = vi.spyOn(target, 'persist').mockRejectedValueOnce(new Error('reservation write failed'));
    await expect(runner.flush()).rejects.toThrow(/reservation write/); spy.mockRestore();
    expect(f.attempts).toEqual([]); await runner.flush(); expect(f.attempts).toEqual([id]);
  } finally { vi.restoreAllMocks(); runner.stop(); }
});

it('RR8 an old-writer copy inherits the unresolved occurrence instead of retrying it', async () => {
  const f = await fixture(true), runner = f.create();
  try {
    await f.prepare(runner); await runner.flush();
    const original = (await runner.queued())[0]!;
    const bypass = runner as unknown as { gated: (work: () => Promise<void>) => Promise<void>; load: () => Promise<{ queue: unknown[] }>; persist: () => Promise<void> };
    await bypass.gated(async () => {
      (await bypass.load()).queue.push({ name: original.name, ran: original.ran, kind: original.kind, text: original.text });
      await bypass.persist();
    });
    await runner.flush(); await runner.flush();
    expect(f.attempts).toHaveLength(1);
    expect(await runner.queued()).toEqual([expect.objectContaining({ delivery: original.delivery, ownership: original.ownership }), expect.objectContaining({ delivery: original.delivery, ownership: original.ownership })]);
  } finally { runner.stop(); }
});

it('RR8 a failed wait-state publication recovers the definite non-send before retrying', async () => {
  const f = await fixture(); let runner = f.create();
  try {
    await f.prepare(runner); f.busy = true;
    const target = runner as unknown as { persist: (strict?: boolean) => Promise<void> }, persist = target.persist.bind(target);
    const spy = vi.spyOn(target, 'persist').mockImplementation(async strict => {
      if ((await f.gate.claims()).some(row => row.result?.outcome === 'failed')) throw new Error('wait cleanup publication failed');
      return persist(strict);
    });
    await expect(runner.flush()).rejects.toThrow(/wait cleanup/); spy.mockRestore(); expect(f.attempts).toEqual([]);
    runner.stop(); runner = f.create(); f.busy = false; await runner.flush();
    expect(f.attempts).toHaveLength(1); expect(await runner.queued()).toEqual([]);
  } finally { vi.restoreAllMocks(); runner.stop(); }
});

it('RR8 a missing native result holds that occurrence while another scope progresses', async () => {
  const f = await fixture(); let runner = f.create();
  try {
    await f.prepare(runner);
    const target = f.gate as unknown as { write: (path: string, value: unknown) => Promise<void> }, write = target.write.bind(target);
    const spy = vi.spyOn(target, 'write').mockImplementation(async (path, value) => {
      if (path.endsWith('.result.json')) throw new Error('native result write failed');
      return write(path, value);
    });
    await expect(runner.flush()).rejects.toThrow(/native result write/); spy.mockRestore();
    runner.stop(); runner = f.create();
    await runner.enqueuePrompt('other', 'harbor OTHER_SCOPE_PROGRESS', new Date('2026-10-28T10:01:00Z'));
    await runner.flush(); await runner.flush();
    expect(f.attempts).toHaveLength(2);
    expect(f.messages.filter(message => message.text.includes('REPLAY_SENSITIVE_INSTRUCTION'))).toHaveLength(1);
    expect(f.messages[1]!.text).toContain('OTHER_SCOPE_PROGRESS'); expect(await runner.queued()).toHaveLength(1);
  } finally { vi.restoreAllMocks(); runner.stop(); }
});

it.each(['refusal-journal', 'admission-read'])('R1 a %s failure cannot discard already produced output', async fault => {
  const f = await fixture(); let produced = 0;
  let runner = f.create({ run: async () => {
    produced++;
    await writeFile(join(f.root, 'advanced-baseline.json'), '{"advanced":true}');
    return { code: 0, timedOut: false, stdout: 'scheduler harbor ADVANCED_BASELINE', stderr: '', truncated: false, spawnError: null };
  } });
  try {
    const spy = fault === 'refusal-journal'
      ? vi.spyOn(f.gate, 'refusal').mockRejectedValueOnce(new Error('injected admission failure'))
      : vi.spyOn(f.gate, 'verdict').mockRejectedValueOnce(new Error('injected admission failure'));
    await expect(runner.runOne(f.gate.home, { name: 'stateful', path: 'unused' } as never)).rejects.toThrow(/injected admission/);
    spy.mockRestore();
    expect(produced).toBe(1); expect(f.attempts).toEqual([]);
    expect(await runner.queued()).toEqual([expect.objectContaining({ text: 'scheduler harbor ADVANCED_BASELINE', hold: expect.any(Object) })]);
    runner.stop(); runner = f.create();
    await stage(f.gate, 'scheduler', 'aborted'); await runner.flush();
    expect(f.attempts).toHaveLength(fault === 'refusal-journal' ? 1 : 0);
    if (fault === 'admission-read') expect((await runner.queued())[0]!.hold?.stage).toBe('unreadable');
  } finally { vi.restoreAllMocks(); runner.stop(); }
});

it('RR9 a sustained ordinary stream must not indefinitely starve released retained evidence', async () => {
  const f = await fixture(); const runner = f.create();
  try {
    await f.prepare(runner); f.turnAfterSend = true;
    for (let i = 1; i <= 12; i++) {
      await runner.enqueuePrompt('routine-stream', `harbor ORDINARY_TURN_${i}`, new Date(Date.parse('2026-10-28T10:00:00Z') + i * 60000));
      f.busy = false; await runner.flush();
      // Regular retry ticks happen while General is doing the turn just admitted.
      for (let retry = 0; retry < 3; retry++) await runner.flush();
    }
    const markers = f.messages.map(m => m.text);
    const duringStream = { nativeMessages: f.messages.length,
      retainedDeliveries: markers.filter(t => t.includes('REPLAY_SENSITIVE_INSTRUCTION')).length,
      held: await runner.held(), queue: await runner.queued() };
    // Positive control: one idle window after the ordinary stream stops immediately recovers it.
    f.busy = false; await runner.flush();
    expect(f.messages.filter(m => m.text.includes('REPLAY_SENSITIVE_INSTRUCTION'))).toHaveLength(1);
    await writeFile(join(proofs, 'ordinary-stream-evidence.json'), JSON.stringify({ nativeMessages: f.messages.length,
      duringStream, afterStreamRetainedDeliveries: f.messages.filter(m => m.text.includes('REPLAY_SENSITIVE_INSTRUCTION')).length,
      held: await runner.held(), queue: await runner.queued() }, null, 2));
    expect(markers.join('\n'), 'a ready retained scope needs progress while unrelated routine traffic continues').toContain('REPLAY_SENSITIVE_INSTRUCTION');
  } finally { runner.stop(); }
});
