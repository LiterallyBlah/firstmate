/** In-memory typed-record controls only; directClosed is simulated, never a runtime qualification. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createCase, createWitness, sha } from './protocol.mjs';

const root = resolve('.local/witness-corrections/controls');
mkdirSync(root, { recursive: true });
function fixture(states = [], rejected = false) {
  const capsule = { name: 'witness-admission-unit', slotId: randomUUID(), sourceHead: 'faec14da66dd79ac2fb404a46ec5ab91f0a826d2',
    sourceHash: sha('synthetic'), bodyHash: sha('synthetic'), observerHashes: { unit: sha('synthetic') } };
  const frames = [], resources = [], home = join(root, randomUUID());
  const bridge = createCase({ capsule, home, send: frame => frames.push(structuredClone(frame)) });
  const original = rejected ? Error('original thrown identity') : { original: 'value identity' };
  const callback = () => {
    for (const state of states) {
      const resource = new EventEmitter(); resources.push(resource);
      if (state.kind === 'child') { resource.pid = 123456 + resources.length; bridge.registerChild(resource); }
      else bridge.registerLifecycle(resource, 'synthetic-page');
      if (state.closed) resource.emit('close', 0, null);
    }
    if (rejected) throw original;
    return original;
  };
  try {
    if (rejected) assert.throws(() => bridge.run(callback), error => error === original);
    else assert.equal(bridge.run(callback), original);
  } finally { bridge.finalize(); }
  return { capsule, frames, resources, bridge };
}
function admit(f, mutate = () => {}, runtime = 'fixed-synthetic-node', directClosed = true) {
  const received = structuredClone(f.frames); mutate(received);
  const witness = createWitness({ capsule: f.capsule, homeRoot: root, expectedPid: () => process.pid });
  for (const frame of received) witness.receive(frame);
  const receipt = witness.seal({ runtime, directClosed });
  writeFileSync(join(root, randomUUID() + '.json'), JSON.stringify({ original: f.frames, received, receipt }, null, 2) + '\n');
  return receipt;
}
const final = frames => frames.find(frame => frame.kind === 'case-final');
const inventory = frames => final(frames).data.observer.resources;
const reseq = frames => frames.forEach((frame, index) => { frame.seq = index + 1; });
const refused = receipt => { assert.equal(receipt.captureAdmissible, false); assert.equal(receipt.safeForReuse, false); assert.ok(receipt.problems.length > 0); };
const resourceRefused = receipt => { refused(receipt); assert.equal(receipt.knownResourcesClosed, false); };

test('producer identities and original fulfilled/rejected values remain admissible with an empty inventory', () => {
  for (const rejected of [false, true]) {
    const f = fixture([], rejected), receipt = admit(f);
    assert.equal(receipt.safeForReuse, true); assert.equal(receipt.knownResourcesClosed, true);
    assert.equal(receipt.sessionWorkerId, f.bridge.session.identity.workerId);
    assert.deepEqual(receipt.worker, f.bridge.actualWorker);
    assert.equal(receipt.outcome.state, rejected ? 'rejected' : 'fulfilled');
  }
});

test('W1 exact counterexample: PID alone and absent session identity cannot qualify', () => {
  refused(admit(fixture(), frames => { for (const frame of frames) { frame.actualWorker = { pid: frame.actualWorker.pid }; delete frame.sessionWorkerId; } }));
});
test('W1 exact counterexample: changing only the final session identity cannot qualify', () => {
  refused(admit(fixture(), frames => { final(frames).sessionWorkerId = 'different-session-worker'; }));
});
test('a different well-formed session UUID at the same PID cannot replace the bound session', () => {
  const receipt = admit(fixture(), frames => { final(frames).sessionWorkerId = `${process.pid}:${randomUUID()}`; });
  refused(receipt); assert.ok(receipt.problems.includes('worker-case-or-home-changed'));
});

const invalidIdentities = [
  ['missing instance', frame => { delete frame.actualWorker.instance; }],
  ['malformed instance UUID', frame => { frame.actualWorker.instance = 'not-a-uuid'; }],
  ['missing thread', frame => { delete frame.actualWorker.threadId; }],
  ['fractional thread', frame => { frame.actualWorker.threadId = 0.5; }],
  ['negative thread', frame => { frame.actualWorker.threadId = -1; }],
  ['missing main-thread flag', frame => { delete frame.actualWorker.isMainThread; }],
  ['string main-thread flag', frame => { frame.actualWorker.isMainThread = 'true'; }],
  ['inconsistent main-thread identity', frame => { frame.actualWorker.threadId = 1; frame.actualWorker.isMainThread = true; }],
  ['inconsistent worker-thread identity', frame => { frame.actualWorker.threadId = 0; frame.actualWorker.isMainThread = false; }],
  ['missing version', frame => { delete frame.actualWorker.node; }],
  ['malformed version', frame => { frame.actualWorker.node = 'unknown'; }],
  ['absent session', frame => { delete frame.sessionWorkerId; }],
  ['malformed session', frame => { frame.sessionWorkerId = `${process.pid}:invalid`; }],
  ['session PID mismatch', frame => { frame.sessionWorkerId = `${process.pid + 1}:${randomUUID()}`; }],
];
for (const [name, mutate] of invalidIdentities) test(`identity refusal: ${name}`, () => {
  refused(admit(fixture(), frames => frames.forEach(mutate)));
});
for (const [name, mutate] of [
  ['instance', frame => { frame.actualWorker.instance = randomUUID(); }],
  ['thread', frame => { frame.actualWorker.threadId = 1; frame.actualWorker.isMainThread = false; }],
  ['version', frame => { frame.actualWorker.node = 'v24.0.0'; }],
]) test(`a well-formed changed worker ${name} is refused`, () => {
  const receipt = admit(fixture(), frames => mutate(final(frames))); refused(receipt);
  assert.ok(receipt.problems.includes('worker-case-or-home-changed'));
});
test('identity failures retain bounded refusal evidence', () => {
  const receipt = admit(fixture(), frames => {
    const malformed = structuredClone(frames[0]); delete malformed.sessionWorkerId;
    frames.push(...Array.from({ length: 100 }, () => structuredClone(malformed)));
  });
  refused(receipt); assert.equal(receipt.problems.length, 32); assert.ok(receipt.problemRecordsDropped > 0);
});

const open = () => fixture([{ kind: 'child', closed: false }]);
const closed = () => fixture([{ kind: 'child', closed: true }]);
test('producer-generated open resource is visible and closed child/lifecycle resources qualify independent of inventory order', () => {
  const pending = admit(open()); assert.equal(pending.captureAdmissible, true); assert.equal(pending.knownResourcesClosed, false); assert.equal(pending.safeForReuse, false);
  const receipt = admit(fixture([{ kind: 'child', closed: true }, { kind: 'lifecycle', closed: true }]), frames => inventory(frames).reverse());
  assert.equal(receipt.captureAdmissible, true); assert.equal(receipt.knownResourcesClosed, true); assert.equal(receipt.safeForReuse, true);
  assert.ok(receipt.events.filter(frame => frame.kind === 'resource-entry').every(frame => frame.data.closed === false), 'Closure tracking must not rewrite retained entry evidence');
});
test('W2 exact counterexample: final inventory cannot omit a known open resource', () => {
  resourceRefused(admit(open(), frames => { final(frames).data.observer.resources = []; }));
});
for (const [name, make, mutate] of [
  ['omitted closed resource', closed, frames => { final(frames).data.observer.resources = []; }],
  ['duplicate final identity', closed, frames => { inventory(frames).push(structuredClone(inventory(frames)[0])); }],
  ['unexplained final identity', closed, frames => { inventory(frames).push({ ...inventory(frames)[0], id: randomUUID() }); }],
  ['malformed final identity', closed, frames => { inventory(frames)[0].id = 'invalid'; }],
  ['changed final kind', closed, frames => { inventory(frames)[0].kind = 'other'; }],
  ['changed final PID', closed, frames => { inventory(frames)[0].pid++; }],
  ['omitted final PID', closed, frames => { delete inventory(frames)[0].pid; }],
  ['false final close without close event', open, frames => { inventory(frames)[0].closed = true; }],
  ['false final open after close event', closed, frames => { inventory(frames)[0].closed = false; }],
  ['close without entry', closed, frames => { frames.splice(frames.findIndex(frame => frame.kind === 'resource-entry'), 1); reseq(frames); }],
  ['duplicate entry', closed, frames => { const at = frames.findIndex(frame => frame.kind === 'resource-entry'); frames.splice(at, 0, structuredClone(frames[at])); reseq(frames); }],
  ['duplicate close', closed, frames => { const at = frames.findIndex(frame => frame.kind === 'resource-close'); frames.splice(at, 0, structuredClone(frames[at])); reseq(frames); }],
  ['changed close identity', closed, frames => { frames.find(frame => frame.kind === 'resource-close').data.id = randomUUID(); }],
  ['changed close kind', closed, frames => { frames.find(frame => frame.kind === 'resource-close').data.kind = 'other'; }],
  ['changed close PID', closed, frames => { frames.find(frame => frame.kind === 'resource-close').data.pid++; }],
  ['entry already closed', closed, frames => { frames.find(frame => frame.kind === 'resource-entry').data.closed = true; }],
  ['malformed entry', closed, frames => { frames.find(frame => frame.kind === 'resource-entry').data = null; }],
  ['malformed close', closed, frames => { frames.find(frame => frame.kind === 'resource-close').data.closed = 'true'; }],
]) test(`resource refusal: ${name}`, () => resourceRefused(admit(make(), mutate)));

test('late resource close cannot retroactively complete a final open inventory', () => {
  const f = open(); f.resources[0].emit('close', 0, null);
  const receipt = admit(f); resourceRefused(receipt);
});
test('resource limit violations are bounded and cannot certify closure', () => {
  resourceRefused(admit(fixture(), frames => {
    const entry = frames[0];
    frames.splice(1, 0, ...Array.from({ length: 33 }, () => ({ ...structuredClone(entry), kind: 'resource-entry', data: { id: randomUUID(), kind: 'synthetic-page', closed: false } })));
    reseq(frames);
  }));
});
test('known resource closure never substitutes for runtime or direct-child closure', () => {
  for (const runtime of ['vitest-forks', 'powershell-exec', 'chromium']) {
    const receipt = admit(closed(), () => {}, runtime);
    assert.equal(receipt.knownResourcesClosed, true); assert.equal(receipt.supported, false);
    assert.equal(receipt.runtimeClosed, false); assert.equal(receipt.safeForReuse, false);
  }
  const receipt = admit(closed(), () => {}, 'fixed-synthetic-node', false);
  assert.equal(receipt.knownResourcesClosed, true); assert.equal(receipt.runtimeClosed, false); assert.equal(receipt.safeForReuse, false);
});
