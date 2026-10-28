import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { MIGRATION_COMPATIBILITY } from '../shared/supervision-migration';
import { cutoverGate, type CutoverGate } from './supervision-gate';
import { MAX_QUEUED, WatchRunner, watchItem } from './watches';
import { workflowFixture } from '../test/workflow-fixture';
import { updateFirstmateConfig } from './config';
import { pluginDir } from './data-dir';
import { workflowStore } from './workflow-service';
import { SupervisionStore } from './supervision-store';
import { SupervisionMigrator, legacyAdapters } from './supervision-migrate';
import { NeedsYouService, readConfiguredDecisionHome } from './needs-you-service';

async function stage(gate: CutoverGate, plan: string, value: 'freeze' | 'aborted') {
  if (value === 'aborted') {
    const { hash: _hash, ...body } = (await gate.sidecar(plan, 'freeze'))!;
    return gate.run(() => gate.publishSidecar({ ...body, stage: value }));
  }
  await gate.arm([]);
  return gate.run(() => gate.publishSidecar({ format: 'firstmate.cutover-sidecar/1', compatibility: MIGRATION_COMPATIBILITY,
    stage: value, homeId: 'fixture', planId: plan, migrationId: randomUUID(), scopeId: randomUUID(), at: new Date().toISOString(),
    sourceHash: '1'.repeat(64), inventoryHash: '2'.repeat(64), transaction: null,
    tokens: { plan, nodes: [], actions: [], agents: [], tasks: [] } }));
}
async function fixture(run?: ConstructorParameters<typeof WatchRunner>[0]['run']) {
  const root = join(process.env.PASEO_HOME!, randomUUID()), home = join(root, 'home'); await mkdir(home, { recursive: true });
  const gate = cutoverGate(home), sent: string[] = [];
  const runner = new WatchRunner({ home: async () => home, disabled: async () => [],
    gate: async () => ({ gate, recipient: 'general' }), stateFile: join(root, 'watches.json'), scriptStateRoot: join(root, 'watch-state'),
    deliver: async text => { sent.push(text); return 'sent'; }, ...(run ? { run } : {}) });
  return { root, home, gate, sent, runner };
}

it.each(['annotated-first', 'no-flush'])('RR10 frozen observations survive queue pressure before new output (%s)', async mode => {
  let produced = 0;
  const f = await fixture(async (_path, options) => {
    await writeFile(join(options.env.FIRSTMATE_WATCH_STATE!, 'baseline.json'), '{"observed":true}');
    return { code: 0, timedOut: false, stdout: `harbor PRE_FREEZE_source-${produced++}`, stderr: '', truncated: false, spawnError: null };
  });
  try {
    for (let i = 0; i < MAX_QUEUED; i++) await f.runner.runOne(f.home, { name: 'stateful-source', path: 'unused' } as never,
      new Date(Date.parse('2026-10-28T10:00:00Z') + i * 60000));
    await stage(f.gate, 'harbor', 'freeze');
    if (mode === 'annotated-first') await f.runner.flush();
    const original = (await f.runner.queued())[0]!;
    const authoritativeVerdict = await f.gate.verdict(watchItem(original), 'send');
    expect(authoritativeVerdict.admit).toBe(false);
    await expect(f.runner.enqueuePrompt('new-scope', 'UNRELATED_NEW_OUTPUT', new Date('2026-10-28T10:21:00Z'))).rejects.toThrow(/capacity/);
    expect(await f.runner.queued()).toHaveLength(MAX_QUEUED);
    const queueFileAfterPressure = JSON.parse(await readFile(join(f.root, 'watches.json'), 'utf8'));
    expect(JSON.stringify(queueFileAfterPressure)).toContain('PRE_FREEZE_source-0');
    expect(queueFileAfterPressure.watches['stateful-source'].lastOutput).toBe(`harbor PRE_FREEZE_source-${MAX_QUEUED - 1}`);
    expect(await readFile(join(f.root, 'watch-state/stateful-source/baseline.json'), 'utf8')).toBe('{"observed":true}');
    const refusals = await Promise.all((await readdir(join(f.gate.directory, 'refusals'))).map(async name => JSON.parse(await readFile(join(f.gate.directory, 'refusals', name), 'utf8'))));
    expect(refusals).toContainEqual(expect.objectContaining({ item: expect.objectContaining({ id: 'retention-capacity:new-scope' }) }));
    await stage(f.gate, 'harbor', 'aborted');
    for (let i = 0; i < MAX_QUEUED + 1; i++) await f.runner.flush();
    const observed = [...f.sent.join('\n').matchAll(/PRE_FREEZE_source-(\d+)/g)].map(m => Number(m[1]));
    expect(observed.sort((a, b) => a - b), 'a frozen scope must not lose a previously produced observation before explicit disposition').toEqual(Array.from({ length: MAX_QUEUED }, (_, i) => i));
  } finally { f.runner.stop(); }
});

it.each([MAX_QUEUED - 1, MAX_QUEUED])('RR11 prompt admission respects %s slots already reserved by armed script producers', async reserveCount => {
  let release!: () => void, allStarted!: () => void;
  const blocked = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { allStarted = r; });
  let nativeStarts = 0;
  const f = await fixture(async () => {
    if (++nativeStarts === reserveCount) allStarted(); await blocked;
    return { code: 0, timedOut: false, stdout: 'scheduler SCRIPT_BASELINE_ALREADY_ADVANCED', stderr: '', truncated: false, spawnError: null };
  });
  let work: Promise<unknown> | undefined;
  try {
    await stage(f.gate, 'scheduler', 'freeze');
    work = Promise.allSettled(Array.from({ length: reserveCount }, (_, i) => f.runner.runOne(f.home, { name: `producer-${i}`, path: 'unused' } as never)));
    await started;
    const errors: string[] = [];
    for (let i = 0; i < (reserveCount === MAX_QUEUED ? MAX_QUEUED : 1); i++) {
      try { await f.runner.enqueuePrompt(`prompt-${i}`, 'scheduler PROMPT_WITHOUT_RESERVED_CAPACITY', new Date('2026-10-28T10:00:00Z')); }
      catch (error) { errors.push(String(error)); }
    }
    const queuedBeforeRelease = (await f.runner.queued()).length;
    release(); await work;
    const finalQueue = await f.runner.queued();
    expect(errors).toHaveLength(reserveCount === MAX_QUEUED ? MAX_QUEUED : 1);
    expect(errors.every(error => error.includes(reserveCount === MAX_QUEUED ? 'capacity' : 'retained durably'))).toBe(true);
    expect(queuedBeforeRelease, 'prompt admission cannot spend a slot reserved before it, while the gate was already armed').toBe(MAX_QUEUED - reserveCount);
    expect(finalQueue).toHaveLength(MAX_QUEUED);
    expect(finalQueue.filter(row => row.name.startsWith('producer-'))).toHaveLength(reserveCount);
  } finally { release(); await work; f.runner.stop(); }
});

it('RR10 queue pressure cannot discard an occurrence already inventoried as an S07 hold', async () => {
  let sequence = 0;
  const f = await fixture(async () => ({ code: 0, timedOut: false,
    stdout: `scheduler INVENTORIED_${sequence++}`, stderr: '', truncated: false, spawnError: null }));
  let service: NeedsYouService | undefined;
  try {
    for (const id of ['trial', 'build']) {
      await mkdir(join(f.home, `data/${id}`), { recursive: true });
      await writeFile(join(f.home, `data/${id}/brief.md`), 'Instructions.');
    }
    await writeFile(join(f.home, 'data/backlog.md'), '# Backlog\n## In flight\n- [ ] build - Build the scheduler (hold: Which storage?) (agent: worker-build)\n## Queued\n## Done\n');
    await writeFile(join(f.home, 'data/orders.md'), 'Pilot implementation and isolated tests only.\n');
    await updateFirstmateConfig({ home: f.home, mateAgentId: '', migration: null, mateLaunch: null });
    await updateFirstmateConfig({ mateAgentId: 'general' });
    const legacy = workflowStore(f.home);
    await legacy.execute({ op: 'draft', definition: workflowFixture() }, randomUUID(), 'general');
    const store = new SupervisionStore(pluginDir(), f.home, { writable: true, processIdentity: async () => ({ state: 'alive', start: 'probe' }) });
    await store.initialize(); await store.acquireCoordinator();
    let clock = 1000;
    service = new NeedsYouService({ root: join(f.root, 'ledger'), home: readConfiguredDecisionHome,
      catalog: async () => null, enabled: () => true, now: () => clock });
    await service.read(); clock += 2000; expect((await service.read()).freshness.status).toBe('fresh');
    for (let i = 0; i < MAX_QUEUED; i++) await f.runner.runOne(f.home, { name: 'stateful-source', path: 'unused' } as never,
      new Date(Date.parse('2026-10-28T10:00:00Z') + i * 60000));
    const first = (await f.runner.queued())[0]!, item = watchItem(first);
    const migrator = new SupervisionMigrator({ home: f.home, store, legacy, enabled: true, adapters: legacyAdapters(f.runner, () => service!.read()) });
    await migrator.arm();
    const input = { plan: 'scheduler', scopeId: randomUUID(), projectId: randomUUID(), migrationId: randomUUID(),
      prerequisites: { inventory: 'review fixture', rollbackBuild: 'review compatible build', policy: 'review fixture' } };
    await migrator.prepare(input);
    const before = (await store.read()).dispositions!.find(d => d.source === 'watch-queue' && d.payloadHash === item.payloadHash)!;
    expect(before).toMatchObject({ route: 'hold', removal: { state: 'pending' } });
    await expect(f.runner.enqueuePrompt('new-scope', 'UNRELATED_NEW_OUTPUT', new Date('2026-10-28T10:21:00Z'))).rejects.toThrow(/capacity/);
    const remaining = await f.runner.queued();
    expect(remaining.some(n => watchItem(n).payloadHash === item.payloadHash), 'a pending S07 hold cannot be removed by unrelated enqueue pressure').toBe(true);
    expect((await store.read()).dispositions!.find(d => d.id === before.id)).toEqual(before);
    // A release permits delivery, but cannot authorize capacity eviction of inventoried evidence.
    await migrator.abort(input.migrationId, 'Release this fixture.', { kind: 'captain-ui', id: 'captain', source: 'fixture' });
    expect((await f.gate.verdict(item, 'send')).admit).toBe(true);
    await expect(f.runner.enqueuePrompt('new-scope', 'AFTER_RELEASE_PRESSURE', new Date('2026-10-28T10:21:00Z'))).rejects.toThrow(/capacity/);
    expect(await f.runner.queued()).toHaveLength(MAX_QUEUED);
  } finally { await service?.stop(); f.runner.stop(); }
});

it.each(['prompt', 'restore', 'script'] as const)('RR11 %s admission in another runner respects shared producer reservations', async path => {
  let release!: () => void, started!: () => void, nativeStarts = 0;
  const blocked = new Promise<void>(r => { release = r; }), allStarted = new Promise<void>(r => { started = r; });
  const run = async () => {
    if (++nativeStarts === MAX_QUEUED) started(); await blocked;
    return { code: 0, timedOut: false, stdout: 'scheduler RESERVED', stderr: '', truncated: false, spawnError: null };
  };
  const f = await fixture(run);
  const other = new WatchRunner({ home: async () => f.home, disabled: async () => [], run,
    gate: async () => ({ gate: f.gate, recipient: 'general' }), stateFile: join(f.root, 'watches.json'),
    scriptStateRoot: join(f.root, 'watch-state'), deliver: async () => 'sent' });
  await stage(f.gate, 'scheduler', 'freeze');
  const work = Promise.allSettled(Array.from({ length: MAX_QUEUED }, (_, i) => f.runner.runOne(f.home, { name: `producer-${i}`, path: 'unused' } as never)));
  try {
    await allStarted;
    const admit = path === 'prompt' ? () => other.enqueuePrompt('prompt', 'scheduler PROMPT', new Date()) :
      path === 'restore' ? () => f.gate.run(() => other.restoreQueued({ name: 'archived', ran: '2026-10-28T10:00:00Z', kind: 'output', text: 'scheduler ARCHIVED' }, f.gate)) :
      () => other.runOne(f.home, { name: 'extra-producer', path: 'unused' } as never);
    await expect(admit()).rejects.toThrow(/capacity/);
    expect(await other.queued()).toEqual([]); expect(nativeStarts).toBe(MAX_QUEUED);
    release(); await work;
    expect(await other.queued()).toHaveLength(MAX_QUEUED);
  } finally { release(); await work; other.stop(); f.runner.stop(); }
});
