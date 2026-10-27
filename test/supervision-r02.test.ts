import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inboxFixture, observation, ids, second, now, api, timelinePage } from './supervision-inbox-fixture';
import { expected } from './supervision-fixture';
import { SupervisionStore, type SupervisionMutation } from '../server/supervision-store';
import { supervisionInboxStatus } from '../server/supervision-status';
import type { PluginLifecycleEvents } from '@getpaseo/plugin/server';
import { SupervisionEvents, sourceId } from '../server/supervision-events';
import { SupervisionInboxStatusSchema } from '../shared/supervision-rpc';

const evidence = fileURLToPath(new URL('../.local/s02-r02/probes/', import.meta.url));
async function save(name: string, value: unknown) {
  await mkdir(evidence, { recursive: true });
  await writeFile(`${evidence}/${name}.json`, JSON.stringify({ originalProbeHead: 'e8e4646604b040693e4a80587653b7bfdeff4057', value }, null, 2));
}

describe('R02 independent exact-head checks', () => {
  it('scope paging must not skip earlier ordinals after a late triage resolution', async () => {
    const f = await inboxFixture();
    const triage = await f.events.admit(observation({agentId:'future-worker',sourceKey:'future:1'}));
    const b1 = await f.events.admit(observation({agentId:'worker-b',sourceKey:'b:1',turnId:'b:1'}));
    const b2 = await f.events.admit(observation({agentId:'worker-b',sourceKey:'b:2',turnId:'b:2'}));
    const s = await f.store.read();
    const task = s.tasks.find(t=>t.id===second.task)!;
    const attempt = s.attempts.find(a=>a.id===second.attempt)!;
    const effect = s.effects.find(e=>e.id===second.effect)!;
    const attemptId = randomUUID(), effectId = randomUUID();
    const batch: SupervisionMutation[] = [
      {kind:'attempt',value:{...attempt,id:attemptId,ordinal:2,launchEffectId:effectId,worker:{hostId:'local',agentId:'future-worker',workspaceId:'future-workspace'}}},
      {kind:'effect',value:{...effect,id:effectId,attemptId,logicalKey:'r02-future-launch'}},
      {kind:'task',value:{...task,currentAttempt:attemptId,version:2}},
    ];
    await f.store.transact(batch.map(m=>({...expected([m])[0]!,version:m.kind==='task'?1:0})),randomUUID(),batch);
    await f.events.resolve(triage.resultIds[0]!);
    const fresh = await new SupervisionStore(f.dataRoot,f.home).read();
    const pages = [], seen = [];
    let after = 0;
    for(let i=0;i<4;i++) {
      const page=supervisionInboxStatus(fresh,{scopeId:second.scope,after,limit:1},now);
      pages.push(page);seen.push(...page.entries.map(e=>e.event.id));
      if(!page.hasMore||page.nextAfter===null)break;
      after=page.nextAfter;
    }
    await save('paging-reproduction',{fresh,pages,seen,expected:[b1.resultIds[0],b2.resultIds[0],triage.resultIds[0]]});
    expect(fresh.freshness).toBe('current');
    expect(seen).toEqual([b1.resultIds[0],b2.resultIds[0],triage.resultIds[0]]);
  });

  it('changed content for the same hook outcome remains visibly quarantined after a duplicate', async () => {
    const f=await inboxFixture();
    const hook = (text: string) => ({agent:{id:'worker-a'},turnId:'turn-1',outcome:{kind:'completed'},timeline:[{type:'assistant_message',text}]}) as unknown as PluginLifecycleEvents['agent.turn_ended'];
    const noFetch=api(async()=>{throw Error('Nonempty hook must not fetch');});
    await f.events.ended(hook('original evidence'),noFetch);
    await f.events.ended(hook('conflicting evidence'),noFetch);
    const conflict=await f.store.read();
    await f.events.ended(hook('original evidence'),noFetch);
    const fresh=await new SupervisionStore(f.dataRoot,f.home).read();
    const global=supervisionInboxStatus(fresh,{},now);
    const source=supervisionInboxStatus(fresh,{scopeId:ids.scope,pageKind:'sources'},now);
    await save('conflict-reproduction',{conflict,fresh,global,source});
    expect(fresh.inbox.events).toHaveLength(2);
    expect(global.counts.quarantined>0||source.sources.some(s=>s.gaps.includes('malformed'))).toBe(true);
  });

  it('partial handling then higher-epoch reoffer retains handled facts and closes the watermark',async()=>{
    const f=await inboxFixture();
    await f.events.admit(observation());
    await f.events.admit(observation({turnId:'second',sourceKey:'second'}));
    const prepared=await f.inbox.prepare(ids.scope,1,true);
    const offer=(await f.store.read()).inbox.offers.find(o=>o.id===prepared.resultIds[0])!;
    await f.inbox.beginSend(ids.scope,1,offer.id,true);
    await f.inbox.acknowledge(ids.scope,1,offer.id,offer.eventIds);
    const result={kind:'no-action' as const,reason:'Independent fixture inspected this evidence; no effect required.',evidenceIds:[(await f.store.read()).inbox.events[0]!.envelope.payloadRef.slice(5)]};
    await f.inbox.handle(ids.scope,1,offer.id,[{eventId:offer.eventIds[0]!,result}]);
    const old=(await f.store.read()).bindings.find(b=>b.scopeId===ids.scope)!;
    for(const binding of [{...old,state:'suspect' as const},{...old,state:'prepared' as const,epoch:2},{...old,state:'active' as const,epoch:2}]){
      const status=await f.store.read();await f.store.transact([status.versions.find(v=>v.kind==='binding'&&v.id===ids.scope)!],randomUUID(),[{kind:'binding',value:binding}]);
    }
    await f.inbox.reoffer(ids.scope,2);
    const replacement=await f.inbox.prepare(ids.scope,2,true);
    const next=(await f.store.read()).inbox.offers.find(o=>o.id===replacement.resultIds[0])!;
    await f.inbox.beginSend(ids.scope,2,next.id,true);
    await f.inbox.acknowledge(ids.scope,2,next.id,next.eventIds);
    await f.inbox.handle(ids.scope,2,next.id,[{eventId:next.eventIds[0]!,result}]);
    const fresh=await new SupervisionStore(f.dataRoot,f.home).read();
    await save('partial-reoffer-control',{fresh});
    expect(next.eventIds).toEqual([offer.eventIds[1]]);
    expect(fresh.inbox.mailboxes.find(b=>b.id===ids.scope)?.watermark).toBe(2);
    expect(fresh.inbox.assignments.map(a=>a.state)).toEqual(['handled','handled']);
  });

  it('public typed pages cannot silently associate a different agent with this scope',async()=>{
    const f=await inboxFixture();
    await f.events.timeline(api(async()=>timelinePage({agentId:'worker-b'})),'worker-a');
    const fresh=await new SupervisionStore(f.dataRoot,f.home).read();
    await save('foreign-page-reproduction',{fresh});
    expect(fresh.inbox.sources[0]?.coverage).toBe('gap');
  });
});

describe('R02 correction boundary regressions', () => {
  const hook = (text: string, turnId = 'turn-1') => ({ agent: { id: 'worker-a' }, turnId, outcome: { kind: 'completed' },
    timeline: [{ type: 'assistant_message', text }] }) as unknown as PluginLifecycleEvents['agent.turn_ended'];
  const noFetch = api(async () => { throw Error('Nonempty hook must not fetch'); });

  it('traverses every supported page size across late resolution and the response byte bound', async () => {
    const f = await inboxFixture();
    const triage = await f.events.admit(observation({ agentId: 'future-worker', sourceKey: 'future' }));
    const expectedIds: string[] = [];
    for (let i = 0; i < 35; i++) expectedIds.push((await f.events.admit(observation({ agentId: 'worker-b', turnId: `b:${i}`, sourceKey: `b:${i}` }))).resultIds[0]!);
    const s = await f.store.read(), task = s.tasks.find(t => t.id === second.task)!, attempt = s.attempts.find(a => a.id === second.attempt)!, effect = s.effects.find(e => e.id === second.effect)!;
    const attemptId = randomUUID(), effectId = randomUUID();
    const batch: SupervisionMutation[] = [
      { kind: 'attempt', value: { ...attempt, id: attemptId, ordinal: 2, launchEffectId: effectId, worker: { hostId: 'local', agentId: 'future-worker', workspaceId: 'future-workspace' } } },
      { kind: 'effect', value: { ...effect, id: effectId, attemptId, logicalKey: 'r02-page-bound-launch' } },
      { kind: 'task', value: { ...task, currentAttempt: attemptId, version: 2 } },
    ];
    await f.store.transact(batch.map(m => ({ ...expected([m])[0]!, version: m.kind === 'task' ? 1 : 0 })), randomUUID(), batch);
    await f.events.resolve(triage.resultIds[0]!);
    expectedIds.push(triage.resultIds[0]!);
    const fresh = await new SupervisionStore(f.dataRoot, f.home).read();
    for (let limit = 1; limit <= 32; limit++) {
      const seen: string[] = []; let after = 0;
      for (let n = 0; n <= expectedIds.length; n++) {
        const page = SupervisionInboxStatusSchema.parse(supervisionInboxStatus(fresh, { scopeId: second.scope, after, limit }, now));
        expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(24 * 1024);
        expect(page.entries.length).toBeLessThanOrEqual(limit);
        seen.push(...page.entries.map(e => e.event.id));
        if (!page.hasMore) break;
        expect(page.nextAfter).toBeGreaterThan(after);
        after = page.nextAfter!;
      }
      expect(seen, `page size ${limit}`).toEqual(expectedIds);
      expect(new Set(seen).size).toBe(expectedIds.length);
    }
    expect(fresh.inbox.assignments.map(a => a.ordinal).slice(0, 3)).toEqual([36, 1, 2]);
    // ~1.6 s locally; the byte, page-size and ordering assertions are the bound, not wall time. A loaded hosted
    // Windows runner (random ~10-14 s pauses, heavy store files on both workers) exceeded 20 s with no code slowdown.
  }, 60_000);

  it.each([false, true])('retains same-outcome quarantine and provenance after retries/restart (handled primary: %s)', async handled => {
    const f = await inboxFixture();
    await f.events.ended(hook('original evidence'), noFetch);
    const original = (await f.store.read()).inbox.assignments[0]!;
    if (handled) {
      const prepared = await f.inbox.prepare(ids.scope, 1, true);
      await f.inbox.beginSend(ids.scope, 1, prepared.resultIds[0]!, true);
      await f.inbox.acknowledge(ids.scope, 1, prepared.resultIds[0]!, [original.id]);
      await f.inbox.handle(ids.scope, 1, prepared.resultIds[0]!, [{ eventId: original.id, result: { kind: 'no-action', reason: 'Inspected fixture evidence.', evidenceIds: [(await f.store.read()).inbox.events[0]!.envelope.payloadRef.slice(5)] } }]);
    }
    const before = await f.store.read();
    await f.events.ended(hook('conflicting evidence'), noFetch);
    const conflict = (await f.store.read()).inbox.assignments[1]!;
    expect(conflict).toMatchObject({ primaryEventId: original.id, consequenceKey: original.consequenceKey, reason: 'malformed', state: 'quarantined', ordinal: null, result: null });
    await f.events.ended(hook('original evidence'), noFetch);
    await f.events.ended(hook('conflicting evidence'), noFetch);
    await f.events.recordGap('hook', 'worker-a', null, ['boot']);
    const restarted = new SupervisionEvents(f.store, { now: () => now });
    await restarted.boot();
    await restarted.ended(hook('original evidence'), noFetch);
    await restarted.ended(hook('healthy new turn', 'turn-2'), noFetch);
    await restarted.admit(observation({ agentId: 'worker-b', sourceKey: 'b:healthy' }));
    const fresh = await new SupervisionStore(f.dataRoot, f.home).read();
    expect(fresh.freshness).toBe('current');
    expect(fresh.inbox.assignments.find(a => a.id === original.id)).toEqual(before.inbox.assignments[0]);
    expect(fresh.inbox.assignments.find(a => a.id === conflict.id)).toEqual(conflict);
    expect(fresh.inbox.events.filter(e => e.consequenceKey === original.consequenceKey)).toHaveLength(3);
    expect(fresh.inbox.assignments.filter(a => a.consequenceKey === original.consequenceKey && a.id === a.primaryEventId)).toHaveLength(1);
    expect(fresh.inbox.sources.find(s => s.id === sourceId('hook', 'worker-a'))?.gaps).toContain('malformed');
    expect(fresh.inbox.sources.find(s => s.id === sourceId('hook', 'worker-b'))?.gaps).not.toContain('malformed');
    const status = SupervisionInboxStatusSchema.parse(supervisionInboxStatus(fresh, { scopeId: ids.scope }, new Date(now.getTime() + 1234)));
    expect(status.counts).toMatchObject({ quarantined: 1, pending: handled ? 2 : 3, triage: 0 });
    expect(status.oldestPendingAgeMs).toBe(1234);
    expect(status.problems.join(' ')).toContain(conflict.id);
    expect(supervisionInboxStatus(fresh, { scopeId: second.scope }, now).counts.quarantined).toBe(0);
    expect(fresh.inbox.mailboxes.find(b => b.id === ids.scope)?.watermark).toBe(handled ? 1 : 0);
    await expect(restarted.resolve(conflict.id)).rejects.toMatchObject({ code: 'HELD' });
    await expect(f.store.transact([fresh.versions.find(v => v.kind === 'inbox-assignment' && v.id === conflict.id)!], randomUUID(), [
      { kind: 'inbox-assignment', value: { ...conflict, state: 'superseded', reason: 'duplicate', version: conflict.version + 1 } },
    ])).rejects.toMatchObject({ code: 'HELD' });
    const offerId = (await f.inbox.prepare(ids.scope, 1, true)).resultIds[0]!;
    expect((await f.store.read()).inbox.offers.find(o => o.id === offerId)?.eventIds).not.toContain(conflict.id);
    expect((await f.inbox.prepare(second.scope, 1, true)).resultIds).toHaveLength(1);
  });

  it.each(['worker-b', 'WORKER-A', '', undefined])('rejects returned timeline identity %s without establishing any attributed baseline', async agentId => {
    const f = await inboxFixture();
    const page = timelinePage({ agentId: agentId as string });
    expect(await f.events.timeline(api(async () => page), 'worker-a')).toBeNull();
    const fresh = await new SupervisionStore(f.dataRoot, f.home).read();
    expect(fresh.freshness).toBe('current');
    expect(fresh.inbox.events).toEqual([]); expect(fresh.inbox.assignments).toEqual([]); expect(fresh.inbox.mailboxes).toEqual([]);
    expect(fresh.inbox.sources).toHaveLength(1);
    expect(fresh.inbox.sources[0]).toMatchObject({ agentId: 'worker-a', epoch: null, cursor: null, maxSeq: null, coverage: 'gap', gaps: ['malformed'] });
  });

  it('retains the checked baseline after a foreign page, then accepts a correctly identified page and independent scope', async () => {
    const f = await inboxFixture();
    await f.events.timeline(api(async () => timelinePage()), 'worker-a');
    const before = await f.store.read(), baseline = before.inbox.sources[0]!;
    const next = timelinePage({ startCursor: { epoch: 'timeline-1', seq: 2 }, endCursor: { epoch: 'timeline-1', seq: 2 },
      entries: [{ ...timelinePage().entries[0]!, seqStart: 2, seqEnd: 2, turnId: 'turn-2' }] });
    expect(await f.events.timeline(api(async () => ({ ...next, agentId: 'worker-b', epoch: 'foreign-epoch' })), 'worker-a')).toBeNull();
    const held = await new SupervisionStore(f.dataRoot, f.home).read();
    expect(held.inbox.events).toEqual(before.inbox.events); expect(held.inbox.assignments).toEqual(before.inbox.assignments); expect(held.inbox.mailboxes).toEqual(before.inbox.mailboxes);
    expect(held.inbox.sources[0]).toMatchObject({ epoch: baseline.epoch, cursor: baseline.cursor, maxSeq: baseline.maxSeq, coverage: 'gap', gaps: ['malformed'] });
    await f.events.timeline(api(async () => next), 'worker-a');
    await f.events.timeline(api(async () => timelinePage({ agentId: 'worker-b' })), 'worker-b');
    const fresh = await new SupervisionStore(f.dataRoot, f.home).read();
    expect(fresh.inbox.sources.find(s => s.agentId === 'worker-a')).toMatchObject({ cursor: { epoch: 'timeline-1', seq: 2 }, maxSeq: 2, coverage: 'bounded', gaps: [] });
    expect(fresh.inbox.sources.find(s => s.agentId === 'worker-b')).toMatchObject({ coverage: 'bounded', gaps: [] });
    expect(fresh.inbox.mailboxes.find(b => b.id === ids.scope)?.watermark).toBe(2);
    expect(fresh.inbox.mailboxes.find(b => b.id === second.scope)?.watermark).toBe(1);
  });

  it('a late mismatched page cannot overwrite a concurrently qualified source', async () => {
    const f = await inboxFixture();
    let release!: (page: ReturnType<typeof timelinePage>) => void, fetched!: () => void;
    const started = new Promise<void>(resolve => { fetched = resolve; });
    const slow = f.events.timeline(api(() => new Promise(resolve => { release = resolve; fetched(); })), 'worker-a');
    await started;
    await f.events.timeline(api(async () => timelinePage()), 'worker-a');
    const before = await f.store.read();
    release(timelinePage({ agentId: 'worker-b' }));
    expect(await slow).toBeNull();
    const fresh = await new SupervisionStore(f.dataRoot, f.home).read();
    expect(fresh.inbox.sources).toEqual(before.inbox.sources);
    expect(fresh.inbox.events).toEqual(before.inbox.events);
    expect(fresh.inbox.assignments).toEqual(before.inbox.assignments);
    expect(fresh.inbox.mailboxes).toEqual(before.inbox.mailboxes);
  });
});
