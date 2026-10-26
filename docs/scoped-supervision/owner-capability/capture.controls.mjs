import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { recorder, beforeMemberGuard, membershipSnapshot, captureCleanup, boundedOutput, observeOutput, outputComplete, closureAssessment, standardWiringComplete } from './capture.mjs';
import { sealOwnerCapture } from './admission.mjs';

const members = pids => ({ phase: 'synthetic', queryOk: true, accountingOk: true, assigned: pids.length, listed: pids.length, active: pids.length, total: Math.max(2, pids.length), pids });
function native() {
  return { captureVersion: 2, root: { pid: 12, creationFileTime: '134058240000000000' }, child: { pid: 13, creationFileTime: '134058240000000001' },
    handleInventory: { root: { acquisition: 'acquired', disposition: 'closed' }, child: { acquisition: 'acquired', disposition: 'closed' } },
    observation: { dropped: 0, failures: 0 }, terminalEvidence: { members: members([]),
      root: { identity: { pid: 12, creationFileTime: '134058240000000000' }, wait: { ok: true, result: 0 }, exit: { ok: true, code: 0 } },
      child: { identity: { pid: 13, creationFileTime: '134058240000000001' }, wait: { ok: true, result: 0 }, exit: { ok: true, code: 0 } } } };
}
test('complete membership is retained before guard with prior complete and exact offending disappearance', () => {
  const state = {}, record = recorder(); beforeMemberGuard(members([12, 13]), state, 12, record);
  assert.throws(() => beforeMemberGuard(members([]), state, 12, record), /Unexpected live owned set/);
  assert.deepEqual(state.lastCompleteBeforeFailure.pids, [12, 13]); assert.deepEqual(state.offending.pids, []);
  assert.equal(record.snapshot().rows.at(-1).kind, 'offending-membership');
});
test('extra members are retained and still fail the unchanged unexpected-set guard', () => {
  const state = {}; assert.throws(() => beforeMemberGuard(members([12, 13, 14]), state, 12, recorder()), /Unexpected live owned set/);
  assert.deepEqual(state.offending.pids, [12, 13, 14]); assert.equal(state.offending.complete, true);
});
test('successful but partial membership retains valid fields without claiming completeness', () => {
  const raw = { ...members([12]), assigned: 2 }, state = {};
  assert.throws(() => beforeMemberGuard(raw, state, 12, recorder()), /Incomplete job membership/);
  assert.equal(state.offending.assigned, 2); assert.equal(state.offending.listed, 1); assert.deepEqual(state.offending.pids, [12]); assert.equal(state.offending.complete, false);
});
test('failed membership query ignores plausible buffer fields while preserving valid independent accounting', () => {
  const raw = { ...members([12, 13]), queryOk: false, queryError: 234, returnedBytes: 72 };
  const value = membershipSnapshot(raw); assert.equal(value.complete, false); assert.equal(value.queryError, 234);
  for (const field of ['assigned', 'listed', 'pids', 'returnedBytes']) assert.equal(Object.hasOwn(value, field), false);
  assert.equal(value.active, 2); assert.equal(value.total, 2);
  const state = {}; assert.throws(() => beforeMemberGuard(raw, state, 12, recorder()), /Incomplete/); assert.equal(state.offending.queryError, 234);
});
test('accounting failure cannot turn guessed zeroes into a terminal empty set', () => {
  const value = membershipSnapshot({ ...members([]), accountingOk: false, accountingError: 5, active: 0, total: 2 });
  assert.equal(value.complete, false); assert.equal(Object.hasOwn(value, 'active'), false); assert.equal(Object.hasOwn(value, 'total'), false);
});
test('malformed/incomplete returned IDs cannot qualify a complete list', () => {
  for (const mutate of [value => { value.pids = [12, 12]; }, value => { value.pids = [12]; }, value => { value.pids = [12, -1]; }, value => { value.listed = 9; }]) {
    const value = members([12, 13]); mutate(value); assert.equal(membershipSnapshot(value).complete, false);
  }
});
test('recorder overflow and sink failure never interrupt all cleanup steps or replace the original error', () => {
  const original = Error('original native fixture failure'), invoked = [], record = recorder({ limit: 1, sink() { throw Error('sink'); } });
  record.note('before', {});
  const result = captureCleanup(original, [
    ['termination', () => { invoked.push('termination'); return { returned: false, win32Error: 5 }; }],
    ['wait', () => { invoked.push('wait'); throw Error('wait failed'); }],
    ['dispose', () => { invoked.push('dispose'); return { disposition: 'close-failed' }; }],
    ['final', () => { invoked.push('final'); return 'still-called'; }],
  ], record);
  assert.equal(result.originalFailure, original); assert.deepEqual(invoked, ['termination', 'wait', 'dispose', 'final']); assert.equal(result.failures, 1);
  const observed = record.snapshot(); assert.equal(observed.rows.length, 1); assert.equal(observed.failures, 1); assert.ok(observed.dropped >= 4); assert.equal(observed.incomplete, true);
});
test('uncloneable recording data is bounded and never suppresses original work/cleanup', () => {
  const record = recorder(); record.note('bad', () => {}); let disposed = false;
  const result = captureCleanup('original-result', [['close', () => { disposed = true; return 0; }]], record);
  assert.equal(disposed, true); assert.equal(result.originalFailure, 'original-result'); assert.equal(record.snapshot().failures, 1);
});
test('complete in-memory terminal evidence confirms closure independently of original success', () => {
  const value = native(); value.error = 'original failure retained'; assert.deepEqual(closureAssessment(value), { confirmed: true, state: 'confirmed', reasons: [] });
});
for (const [name, mutate] of [
  ['never acquired child', value => { value.handleInventory.child = { acquisition: 'never-acquired', disposition: 'not-attempted' }; delete value.child; }],
  ['failed child acquisition', value => { value.handleInventory.child = { acquisition: 'failed', disposition: 'not-attempted' }; }],
  ['missing terminal child', value => { delete value.terminalEvidence.child; }],
  ['failed root wait', value => { value.terminalEvidence.root.wait = { ok: false, win32Error: 6 }; }],
  ['timed out child wait', value => { value.terminalEvidence.child.wait = { ok: true, result: 258 }; }],
  ['failed exit query', value => { value.terminalEvidence.child.exit = { ok: false, win32Error: 6 }; }],
  ['changed creation identity', value => { value.terminalEvidence.child.identity.creationFileTime = '134058240000000009'; }],
  ['terminal membership query failed', value => { value.terminalEvidence.members.queryOk = false; }],
  ['missing terminal inventory', value => { delete value.terminalEvidence.members; }],
  ['record loss', value => { value.observation.dropped = 1; }],
  ['record failure', value => { value.observation.failures = 1; }],
]) test(`terminal closure remains explicit unknown: ${name}`, () => {
  const value = native(); mutate(value); const result = closureAssessment(value); assert.equal(result.confirmed, false); assert.equal(result.state, 'unknown'); assert.ok(result.reasons.length);
  assert.equal(typeof JSON.parse(JSON.stringify(result)).confirmed, 'boolean');
});
test('observed active member is open; disposal is separate from process closure', () => {
  const value = native(); value.terminalEvidence.members = members([13]);
  assert.equal(closureAssessment(value).state, 'open'); value.terminalEvidence.members = members([]); value.handleInventory.child.disposition = 'close-failed';
  assert.equal(closureAssessment(value).confirmed, true, 'Signaled processes and complete empty set differ from disposal success');
});
test('output cap retains raw split UTF-8 bytes and drains beyond the cap with explicit loss', () => {
  const output = boundedOutput({ limit: 4 }), bytes = Buffer.from('ééé');
  output.data(bytes.subarray(0, 1)); output.data(bytes.subarray(1)); output.end(); output.close();
  const result = output.snapshot(); assert.equal(result.retained, 4); assert.equal(result.bytes, 6); assert.equal(result.dropped, 2);
  assert.equal(Buffer.from(result.data, 'base64').toString(), 'éé'); assert.equal(outputComplete(result), false); assert.equal(result.drained, true);
});
test('root and child streams remain distinct; close alone does not establish drain', () => {
  const stdout = new EventEmitter(), stderr = new EventEmitter(), out = observeOutput(stdout), err = observeOutput(stderr);
  stdout.emit('data', Buffer.from('root-only')); stdout.emit('end'); stdout.emit('close'); stderr.emit('close');
  assert.equal(outputComplete(out.snapshot()), true); assert.equal(outputComplete(err.snapshot()), false);
  const missingChild = observeOutput(null); assert.equal(outputComplete(missingChild.snapshot()), false); assert.equal(missingChild.snapshot().errors, 1);
  stderr.emit('error', Error('read failure')); assert.equal(err.snapshot().errors, 1);
});
test('standard handle plan rejects mismatched inheritance, job inclusion, duplicates and incomplete handles', () => {
  const valid = { useStdHandles: true, inheritHandles: true, jobInherited: false, readHandlesInherited: false, jobHandle: '0x100', handleList: ['0x101', '0x102', '0x103'] };
  assert.equal(standardWiringComplete(valid), true);
  for (const change of [value => { value.inheritHandles = false; }, value => { value.jobInherited = true; }, value => { value.readHandlesInherited = true; },
    value => { value.handleList[0] = value.jobHandle; }, value => { value.handleList[1] = value.handleList[0]; }, value => { value.handleList.pop(); }]) {
    const value = structuredClone(valid); change(value); assert.equal(standardWiringComplete(value), false);
  }
});
test('C3 saved failed attempt is replayed offline with explicit unknown, original failure unchanged and C2 held', () => {
  const bytes = readFileSync('.local/owner-capability/normal/capture.json'), saved = JSON.parse(bytes), result = sealOwnerCapture(saved);
  assert.equal(result.ownedSetClosureConfirmed, false); assert.equal(result.closureState, 'unknown'); assert.ok(result.closureReasons.includes('child-handle-or-identity-unbound'));
  assert.equal(result.native.error, saved.native.error); assert.equal(result.safeForReuse, false); assert.equal(result.actualRuntimeQualified, false);
  assert.equal(Object.hasOwn(saved, 'ownedSetClosureConfirmed'), false); assert.equal(saved.native.child, undefined);
  assert.equal(readFileSync('.local/owner-capability/normal/capture.json').equals(bytes), true);
});
