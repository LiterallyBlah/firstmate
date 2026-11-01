import { planSubjectHash } from './workflow-plans';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { captain, s04Fixture } from '../test/supervision-s04-fixture';
import { SupervisorControls } from './supervisor-controls';
import { SupervisorSessions, activationEffects, supervisorSpend } from './supervisor-sessions';
import { digest } from './submissions';
import { join } from 'node:path';
import { SupervisionActivation } from './supervision-activation';
import { SupervisionRuntime } from './supervision-runtime';
import { FirstmateConfigSchema } from '../shared/fleet';
import { PlanRuleRecordSchema } from '../shared/plan-rules';
import { policyRef } from './supervision-policy';
import { SupervisionGateway, expectedFor, stableId } from './supervision-effects';
import { SupervisionCommands } from './supervision-commands';
import { SupervisionStore } from './supervision-store';
import { supervisorWorkspace } from './supervisor-workspace';
import type { PaseoApi } from './host-types';
const profile = { provider: 'codex/gpt-6.1-sol', modeId: 'full-access', thinkingOptionId: 'high' };
const catalog = [{ provider: profile.provider, label: 'Sol', modes: [{ id: 'full-access', label: 'Full' }], thinking: [{ id: 'high', label: 'High' }, { id: 'xhigh', label: 'Extra high' }] }];
async function fixture(nodes = ['build']) {
  const fx = await s04Fixture(), scope = await fx.addScope(1, 'trial', nodes, false);
  const sessions = new SupervisorSessions(fx.store, fx.gateway, fx.receiver, { enabled: true, unverifiedUiAttach: true, limits: { supervisorSessions: 3, supervisorTurns: 10 }, globalMateId: async () => 'general' });
  await sessions.prepare({ requestId: randomUUID(), scopeId: scope.id, scopeVersion: 1, profile, opening: 'Original checkpoint' }, captain);
  const e = activationEffects(await fx.store.read(), scope.id, 1);
  await fx.gateway.dispatch(e.workspace!.id); await fx.gateway.dispatch(e.create!.id); await sessions.verify(scope.id, 1); await fx.gateway.dispatch(e.send!.id);
  const original = (await fx.store.read()).bindings[0]!; fx.receiver.agents.get(original.agentId)!.status = 'idle';
  const controls = new SupervisorControls(fx.store, sessions, fx.gateway, fx.receiver, { enabled: true, catalog: async () => catalog, validate: async () => {}, policyDigest: async () => 'a'.repeat(64), limits: () => ({ supervisorSessions: 3, supervisorTurns: 10 }) });
  async function base() { const s = await fx.store.read(); const b = s.bindings.find(b => b.scopeId === scope.id)!; return { requestId: randomUUID(), homeId: s.homeId, scopeId: scope.id, expectedEpoch: b.epoch, bindingDigest: digest(b), planHash: s.plans.find(p => p.scopeId === scope.id)?.plan.hash ?? null }; }
  async function stage() { const i = { ...await base(), profile: { ...profile, thinkingOptionId: 'xhigh' }, limits: { supervisorSessions: 3, supervisorTurns: 10 }, policyDigest: 'a'.repeat(64) }; await controls.stageFromUnverifiedUi(i); return i; }
  async function replacement() { fx.receiver.agents.get(original.agentId)!.status = 'closed'; return { ...await base(), expectedControlId: controls.read(await fx.store.read(), scope.id).controlId!, opening: 'Continue verified work with retained accounting.' }; }
  return { ...fx, sessions, scope, original, controls, base, stage, replacement };
}
it('R1: replacement with reserved old owner work leaves a usable new owner or refuses before creating it', async () => {
  const fx = await fixture();
  const oldTurn = await fx.sessions.reserveTurn({ requestId: randomUUID(), scopeId: fx.scope.id, epoch: 1, causation: 'queued-before-change', text: 'Previously admitted input' }, captain);
  await fx.stage(); const replacement = await fx.replacement();
  const before = supervisorSpend(await fx.store.read(), fx.scope.id);
  await expect(fx.controls.replaceFromUnverifiedUi(replacement)).rejects.toMatchObject({ code: 'HELD' });
  expect(supervisorSpend(await fx.store.read(), fx.scope.id)).toEqual(before);
  const effect = (await fx.store.read()).effects.find(e => e.id === oldTurn)!;
  const cancel = { ...await fx.base(), expectedControlId: replacement.expectedControlId, effectId: effect.id, effectVersion: effect.version };
  await fx.controls.withdrawInputFromUnverifiedUi(cancel);
  await fx.controls.withdrawInputFromUnverifiedUi(cancel);
  const restarted = await new (await import('./supervision-store')).SupervisionStore(join(fx.home, 'store'), fx.home).read();
  expect(restarted.effects.find(e => e.id === oldTurn)).toMatchObject({ state: 'cancelled', payloadDigest: effect.payloadDigest });
  expect(supervisorSpend(restarted, fx.scope.id)).toEqual(before);
  await fx.controls.replaceFromUnverifiedUi(replacement);
  const s = await fx.store.read(); fx.receiver.agents.get(s.bindings[0]!.agentId)!.status = 'idle';
  console.log('R1 receipt', JSON.stringify({ binding: s.bindings[0]!.state, epoch: s.bindings[0]!.epoch, oldTurn: s.effects.find(e => e.id === oldTurn)?.state, spend: supervisorSpend(s, fx.scope.id), view: fx.controls.read(s, fx.scope.id).state }));
  await expect(fx.sessions.reserveTurn({ requestId: randomUUID(), scopeId: fx.scope.id, epoch: 2, causation: 'next-needed-event', text: 'Next bounded work' }, captain)).resolves.toEqual(expect.any(String));
});
it('R2: current work can finish after stage, then the captain can refresh the pending review', async () => {
  const fx = await fixture(); await fx.draft(fx.scope, [{ id: 'build' }]); await fx.launch(fx.scope, 'build');
  const first = await fx.stage(); await fx.record(fx.scope, 'build', 'done');
  const input = await fx.replacement();
  await expect(fx.controls.replaceFromUnverifiedUi(input)).rejects.toMatchObject({ code: 'STALE' });
  const s = await fx.store.read(); console.log('R2 receipt', JSON.stringify({ pendingPlanHash: first.planHash, currentPlanHash: input.planHash, state: fx.controls.read(s, fx.scope.id).state, nativeCalls: fx.receiver.calls.length }));
  await expect(fx.stage()).rejects.toMatchObject({ code: 'HELD' });
  const withdrawal = { ...await fx.base(), expectedControlId: first.requestId, configurationDigest: digest(fx.controls.read(s, fx.scope.id).pending) };
  await fx.controls.withdrawProposalFromUnverifiedUi(withdrawal);
  await fx.controls.withdrawProposalFromUnverifiedUi(withdrawal);
  await expect(fx.stage()).resolves.toBeDefined();
  await expect(fx.controls.withdrawProposalFromUnverifiedUi({ ...withdrawal, ...await fx.base() })).rejects.toMatchObject({ code: 'STALE' });
});
it('R3: repeat pause/resume does not mutate generation and native drift still refuses dispatch', async () => {
  const fx = await fixture(), original = await fx.store.read();
  const pause = await fx.base(); await fx.controls.pauseFromUnverifiedUi(pause); await fx.controls.pauseFromUnverifiedUi(pause);
  const resume = { ...await fx.base(), expectedControlId: pause.requestId }; await fx.controls.resumeFromUnverifiedUi(resume); await fx.controls.resumeFromUnverifiedUi(resume);
  expect((await fx.store.read()).bindings).toEqual(original.bindings);
  const turn = await fx.sessions.reserveTurn({ requestId: randomUUID(), scopeId: fx.scope.id, epoch: 1, causation: 'drift-check', text: 'Bounded turn' }, captain);
  fx.receiver.agents.get(fx.original.agentId)!.thinkingOptionId = 'xhigh'; const before = fx.receiver.sends.length;
  await expect(fx.gateway.dispatch(turn)).rejects.toMatchObject({ code: 'HELD' }); expect(fx.receiver.sends).toHaveLength(before);
  expect((await fx.store.read()).effects.find(e => e.id === turn)?.state).toBe('reserved');
});
it('R4: plan change during stopped-predecessor lookup refuses replacement before spending or native effects', async () => {
  const fx = await fixture(); await fx.draft(fx.scope, [{ id: 'build' }]); await fx.launch(fx.scope, 'build');
  const proposal = await fx.stage(), input = await fx.replacement();
  const lookup = fx.receiver.findAgent.bind(fx.receiver); let inject = true;
  vi.spyOn(fx.receiver, 'findAgent').mockImplementation(async id => {
    if (inject && id === fx.original.agentId) { inject = false; await fx.record(fx.scope, 'build', 'done'); }
    return lookup(id);
  });
  const result = await fx.controls.replaceFromUnverifiedUi(input).then(() => ({ status: 'fulfilled' }), e => ({ status: 'rejected', code: e.code, message: e.message }));
  const s = await fx.store.read(); console.log('R4 receipt', JSON.stringify({ result, reviewedHash: proposal.planHash, currentHash: s.plans[0]!.plan.hash, epoch: s.bindings[0]!.epoch, spend: supervisorSpend(s, fx.scope.id) }));
  expect(result).toMatchObject({ status: 'rejected', code: 'STALE' });
  expect(s.bindings[0]!.epoch).toBe(1);
});
it.each(['race', 'cwd-refusal', 'cwd-positive', 'cwd-drift', 'cwd-receipt-mismatch'])('R5/F4: production app replacement %s uses only the qualified next cwd', async scenario => {
  const fx = await fixture(); await fx.draft(fx.scope, [{ id: 'build' }]); await fx.launch(fx.scope, 'build');
  let s = await fx.store.read(); const plan = s.plans[0]!.plan, na = { applies: false, reason: 'Synthetic review fixture.' };
  const record = PlanRuleRecordSchema.parse({ format: 'firstmate.plan-rules/1', id: stableId('plan-rules', s.homeId, fx.scope.planId, plan.revision), version: 1, homeId: s.homeId, scopeId: fx.scope.id, planId: fx.scope.planId, revision: plan.revision, sources: [policyRef('policy-source', s.policySources[0]!)], supervisorLimits: { sessions: 3, turns: 10 }, nodes: [{ nodeId: 'build', checks: [{ id: 'unit', command: 'node check.mjs', passCriterion: 'exit zero' }], design: na, performance: na, longRun: na, heavyTests: na }] });
  const mutations = [{ kind: 'plan-rules' as const, value: record }]; await fx.store.transact(expectedFor(s, mutations), randomUUID(), mutations);
  fx.receiver.supervisorRoot = join(fx.home, 'store');
  const root = join(fx.home, 'store'), runtime = new SupervisionRuntime(root, () => fx.store); await runtime.mutate(fx.home, async () => {});
  const activation = new SupervisionActivation(root, { enabled: true, runtime, receiver: () => fx.receiver, config: async () => FirstmateConfigSchema.parse({ home: fx.home, mateAgentId: 'general' }), adapters: () => { throw Error('No migration in review probe'); } });
  const catalogCalls: { cwd: string; agentCreates: number }[] = [], predecessorCwd = fx.receiver.agents.get(fx.original.agentId)!.cwd;
  let changedCatalog = false; const nextCwd = supervisorWorkspace(root, fx.scope.id, 2).directory;
  const api = { providers: { listAvailable: async () => ({ providers: [{ provider: 'codex', available: true }] }), listModels: async (_: string, opts: { cwd: string }) => { catalogCalls.push({ cwd: opts.cwd, agentCreates: fx.receiver.calls.filter(c => c.op === 'createAgent').length }); return { models: !changedCatalog && (scenario === 'cwd-refusal' ? opts.cwd === predecessorCwd : opts.cwd === nextCwd) ? [{ id: 'gpt-6.1-sol', label: 'Sol', thinkingOptions: catalog[0]!.thinking }] : [] }; }, listModes: async () => ({ modes: catalog[0]!.modes }) } } as unknown as PaseoApi;
  try {
    const review = await activation.readControls({ homeId: s.homeId, scopeId: fx.scope.id }, api);
    const stageInput = { ...await fx.base(), op: 'stage' as const, profile: { ...profile, thinkingOptionId: 'xhigh' }, limits: review.limits!, policyDigest: review.policyDigest };
    if (scenario === 'cwd-refusal') {
      expect(review.catalog).toEqual([]); await expect(activation.control(stageInput, api)).rejects.toMatchObject({ code: 'UNSUPPORTED' });
      expect((await fx.store.read()).bindings[0]?.epoch).toBe(1); expect(fx.receiver.calls.filter(c => c.op === 'createAgent')).toHaveLength(2); return;
    }
    await activation.control(stageInput, api); changedCatalog = scenario === 'cwd-drift';
    if (scenario === 'cwd-receipt-mismatch') {
      const open = fx.receiver.openWorkspace.bind(fx.receiver);
      vi.spyOn(fx.receiver, 'openWorkspace').mockImplementation(async intent => ({ ...await open(intent), directory: predecessorCwd }));
    }
    const input = { ...await fx.replacement(), op: 'replace' as const };
    const lookup = fx.receiver.findAgent.bind(fx.receiver); let seen = 0;
    vi.spyOn(fx.receiver, 'findAgent').mockImplementation(async id => { if (scenario === 'race' && id === fx.original.agentId && ++seen === 1) await fx.record(fx.scope, 'build', 'done'); return lookup(id); });
    const result = await activation.control(input, api).then(() => ({ status: 'fulfilled' }), e => ({ status: 'rejected', code: e.code, message: e.message }));
    s = await fx.store.read(); const b = s.bindings[0]!, replacementCwd = fx.receiver.agents.get(b.agentId)?.cwd;
    console.log('R5 receipt', JSON.stringify({ result, epoch: b.epoch, reviewedHash: input.planHash, currentHash: s.plans[0]!.plan.hash, catalogCalls, predecessorCwd, replacementCwd, spend: supervisorSpend(s, fx.scope.id) }));
    expect(result).toMatchObject(scenario === 'cwd-positive' ? { status: 'fulfilled' } : { status: 'rejected', code: scenario === 'cwd-drift' ? 'UNSUPPORTED' : 'STALE' });
    expect(catalogCalls.filter(c => c.agentCreates === 2).every(c => c.cwd === nextCwd)).toBe(true);
    expect(b.epoch).toBe(['cwd-positive', 'cwd-receipt-mismatch'].includes(scenario) ? 2 : 1);
    if (scenario === 'cwd-receipt-mismatch') expect(fx.receiver.calls.filter(c => c.op === 'createAgent')).toHaveLength(2);
    if (scenario === 'cwd-positive') expect(replacementCwd).toBe(nextCwd);
  } finally { await activation.stop(); await runtime.stop(); }
});

it('F1: a target changed after reservation refuses the first effect across a fresh coordinator and exact replay', async () => {
  const fx = await fixture(['build', 'dependent']); await fx.draft(fx.scope, [{ id: 'build' }, { id: 'choice', decision: 'captain' }, { id: 'dependent', after: [{ node: 'choice', on: 'answered' }] }]); await fx.launch(fx.scope, 'build');
  await fx.stage(); const input = await fx.replacement(), before = fx.receiver.calls.length;
  const prepare = fx.sessions.prepareReplacementFromUnverifiedUi.bind(fx.sessions);
  vi.spyOn(fx.sessions, 'prepareReplacementFromUnverifiedUi').mockImplementation(async i => {
    const result = await prepare(i), plan = (await fx.store.read()).plans[0]!.plan;
    await fx.run(fx.scope, { op: 'captain', plan: fx.scope.planId, revision: plan.revision, subjectHash: planSubjectHash(plan), action: 'answer', node: 'choice', option: 'yes', text: 'Synthetic exact pending decision answer.' }, captain);
    return result;
  });
  await expect(fx.controls.replaceFromUnverifiedUi(input)).rejects.toMatchObject({ code: 'STALE' });
  expect(fx.receiver.calls).toHaveLength(before);
  const admitted = await fx.store.read(), effects = activationEffects(admitted, fx.scope.id, 2);
  expect(effects.workspace?.state).toBe('reserved'); expect(admitted.bindings[0]?.state).toBe('prepared');
  await fx.store.releaseCoordinator();
  const store = new SupervisionStore(join(fx.home, 'store'), fx.home, { writable: true, processIdentity: async () => ({ state: 'alive', start: 'fixture-process' }) });
  await store.acquireCoordinator();
  try {
    const gateway = new SupervisionGateway(store, new SupervisionCommands(store, fx.home, { enabled: true }), fx.home, fx.receiver, { enabled: true });
    const sessions = new SupervisorSessions(store, gateway, fx.receiver, { enabled: true, unverifiedUiAttach: true, limits: { supervisorSessions: 3, supervisorTurns: 10 }, globalMateId: async () => 'general' });
    const controls = new SupervisorControls(store, sessions, gateway, fx.receiver, { enabled: true, catalog: async () => { throw Error('Accepted replay must not rediscover'); }, validate: async () => {} });
    await expect(controls.replaceFromUnverifiedUi(input)).rejects.toMatchObject({ code: 'STALE' });
    expect(fx.receiver.calls).toHaveLength(before); expect(supervisorSpend(await store.read(), fx.scope.id)).toEqual(supervisorSpend(admitted, fx.scope.id));
    await expect(controls.replaceFromUnverifiedUi({ ...input, opening: 'Changed bytes' })).rejects.toMatchObject({ code: 'CONFLICT' });
  } finally { await store.releaseCoordinator(); }
});
it.each(['catalog', 'policy'])('F3: %s drift permits exact withdrawal, concurrent disposition has one winner, history stays immutable', async drift => {
  const fx = await fixture(), state = { catalog, policy: 'a'.repeat(64) };
  const controls = new SupervisorControls(fx.store, fx.sessions, fx.gateway, fx.receiver, { enabled: true, catalog: async () => state.catalog, policyDigest: async () => state.policy, validate: async () => {} });
  const first = { ...await fx.base(), profile, limits: { supervisorSessions: 3, supervisorTurns: 10 }, policyDigest: state.policy };
  await controls.stageFromUnverifiedUi(first); const pending = controls.read(await fx.store.read(), fx.scope.id).pending!;
  if (drift === 'catalog') state.catalog = [{ ...catalog[0]!, label: 'Changed catalog' }]; else state.policy = 'b'.repeat(64);
  await expect(controls.replaceFromUnverifiedUi(await fx.replacement())).rejects.toMatchObject({ code: 'STALE' });
  const target = { ...await fx.base(), expectedControlId: first.requestId, configurationDigest: digest(pending) };
  await expect(controls.withdrawProposalFromUnverifiedUi({ ...target, configurationDigest: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'STALE' });
  const results = await Promise.allSettled([controls.withdrawProposalFromUnverifiedUi(target), controls.withdrawProposalFromUnverifiedUi({ ...target, requestId: randomUUID() })]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  await controls.stageFromUnverifiedUi({ ...first, ...await fx.base(), policyDigest: state.policy });
  const after = await fx.store.read(), view = controls.read(after, fx.scope.id);
  expect(view.configurations[0]).toEqual(pending); expect(view.configurations[1]?.generation).toBe(2);
  await expect(controls.resumeFromUnverifiedUi({ ...await fx.base(), expectedControlId: view.controlId! })).rejects.toMatchObject({ code: 'HELD' });
});
it('F2: worker reservations cannot use the owner-input disposition or allow replacement', async () => {
  const fx = await fixture(); await fx.draft(fx.scope, [{ id: 'build' }]);
  await fx.start(fx.scope, 'build');
  const worker = (await fx.store.read()).effects.find(e => e.attemptId !== null && e.state === 'reserved')!;
  await fx.stage(); const input = await fx.replacement(), before = supervisorSpend(await fx.store.read(), fx.scope.id);
  await expect(fx.controls.withdrawInputFromUnverifiedUi({ ...await fx.base(), expectedControlId: input.expectedControlId, effectId: worker.id, effectVersion: worker.version })).rejects.toMatchObject({ code: 'HELD' });
  await expect(fx.controls.replaceFromUnverifiedUi(input)).rejects.toMatchObject({ code: 'HELD' });
  expect(supervisorSpend(await fx.store.read(), fx.scope.id)).toEqual(before);
  expect((await fx.store.read()).effects.find(e => e.id === worker.id)).toEqual(worker);
});

it('F2: a fresh coordinator retains the exact old input, explicit withdrawal, replacement and next bounded turn', async () => {
  const fx = await fixture(); const old = await fx.sessions.reserveTurn({ requestId: randomUUID(), scopeId: fx.scope.id, epoch: 1, causation: 'before-restart', text: 'Retain this exact undelivered owner input' }, captain);
  await fx.stage(); const replacement = await fx.replacement(); await fx.store.releaseCoordinator();
  const store = new SupervisionStore(join(fx.home, 'store'), fx.home, { writable: true, processIdentity: async () => ({ state: 'alive', start: 'fixture-process' }) });
  await store.acquireCoordinator();
  try {
    const gateway = new SupervisionGateway(store, new SupervisionCommands(store, fx.home, { enabled: true }), fx.home, fx.receiver, { enabled: true });
    const sessions = new SupervisorSessions(store, gateway, fx.receiver, { enabled: true, unverifiedUiAttach: true, limits: { supervisorSessions: 3, supervisorTurns: 10 }, globalMateId: async () => 'general' });
    const controls = new SupervisorControls(store, sessions, gateway, fx.receiver, { enabled: true, catalog: async () => catalog, policyDigest: async () => 'a'.repeat(64), validate: async () => {} });
    await expect(controls.replaceFromUnverifiedUi(replacement)).rejects.toMatchObject({ code: 'HELD' });
    const effect = (await store.read()).effects.find(e => e.id === old)!;
    const cancel = { ...await fx.base(), expectedControlId: replacement.expectedControlId, effectId: old, effectVersion: effect.version };
    await expect(controls.withdrawInputFromUnverifiedUi({ ...cancel, effectVersion: effect.version + 1 })).rejects.toMatchObject({ code: 'STALE' });
    await controls.withdrawInputFromUnverifiedUi(cancel); await controls.replaceFromUnverifiedUi(replacement);
    const next = await sessions.reserveTurn({ requestId: randomUUID(), scopeId: fx.scope.id, epoch: 2, causation: 'after-restart', text: 'Separate next bounded input' }, captain);
    const status = await store.read(); expect(status.effects.find(e => e.id === old)).toMatchObject({ state: 'cancelled', payloadDigest: effect.payloadDigest });
    expect(status.effects.find(e => e.id === next)?.epoch).toBe(2); expect(supervisorSpend(status, fx.scope.id)).toEqual({ sessions: 2, turns: 4, uncertain: 0 });
    expect(Buffer.from(await store.readBlob(effect.payloadDigest!)).toString('utf8')).toBe('Retain this exact undelivered owner input');
  } finally { await store.releaseCoordinator(); }
});

it('F1/F3: a changed target at the owned reservation boundary can withdraw only its own unreserved transfer proposal', async () => {
  const fx = await fixture(['build', 'dependent']);
  await fx.draft(fx.scope, [{ id: 'build' }, { id: 'choice', decision: 'captain' }, { id: 'dependent', after: [{ node: 'choice', on: 'answered' }] }]);
  await fx.stage(); const input = await fx.replacement(), prepare = fx.sessions.prepareReplacementFromUnverifiedUi.bind(fx.sessions);
  vi.spyOn(fx.sessions, 'prepareReplacementFromUnverifiedUi').mockImplementationOnce(async i => {
    const plan = (await fx.store.read()).plans[0]!.plan;
    await fx.run(fx.scope, { op: 'captain', plan: fx.scope.planId, revision: plan.revision, subjectHash: planSubjectHash(plan), action: 'answer', node: 'choice', option: 'yes', text: 'Synthetic exact decision during reservation wait.' }, captain);
    return prepare(i);
  });
  await expect(fx.controls.replaceFromUnverifiedUi(input)).rejects.toMatchObject({ code: 'STALE' });
  const held = await fx.store.read(), pending = fx.controls.read(held, fx.scope.id).pending!;
  expect(held.bindings[0]).toMatchObject({ epoch: 1, state: 'suspect' });
  await fx.controls.withdrawProposalFromUnverifiedUi({ ...await fx.base(), expectedControlId: input.expectedControlId, configurationDigest: digest(pending) });
  const after = await fx.store.read(); expect(after.bindings[0]).toMatchObject({ epoch: 1, state: 'active' });
  expect(supervisorSpend(after, fx.scope.id)).toEqual({ sessions: 1, turns: 1, uncertain: 0 });
  expect(after.operationHolds).toEqual(held.operationHolds); expect(fx.controls.read(after, fx.scope.id).replacementResume).toBeNull();
  await fx.stage(); expect(fx.controls.read(await fx.store.read(), fx.scope.id).configurations).toHaveLength(2);
});
