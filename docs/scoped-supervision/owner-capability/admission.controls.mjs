import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sealOwnerCapture } from './admission.mjs';
// All values below are explicitly simulated; no native API or resource factory is invoked.
const uuid = 'b472718e-d96e-47da-bf13-5e7cd32e52ab';
const members = (pids, total = 2) => ({ assigned: pids.length, listed: pids.length, active: pids.length, total, pids });
function positive(scenario = 'normal') {
  const handle = pid => ({ pid, handle: '0x' + pid, creationFileTime: '134058240000000000', image: 'C:\\node.exe', member: true });
  const input = { caseId: uuid, nonce: uuid, nodePath: 'C:\\node.exe', nodeVersion: 'v24.18.0', scenario,
    rootEntry: { pid: 12, ppid: 10, childPid: 13, caseId: uuid, nonce: uuid, scenario, node: 'v24.18.0', threadId: 0, isMainThread: true, instance: uuid },
    childEntry: { pid: 13, ppid: 12, caseId: uuid, nonce: uuid, scenario, node: 'v24.18.0', threadId: 0, isMainThread: true, instance: uuid },
    outer: { status: 0, closed: true, deadlineFired: false }, rootResult: { childCode: 0, childSignal: null }, childResult: { fulfilled: true },
    rootDelayedSignal: false, childDelayedSignal: false,
    native: { error: null, targetCreated: true, targetResumed: true, root: handle(12), child: handle(13),
      beforeResume: members([12], 1), liveMembers: members([12, 13]), finalMembers: members([]), rootWait: 0, childWait: 0,
      rootExit: scenario === 'normal' ? 0 : 197, childExit: scenario === 'normal' ? 0 : 197, deadlineFired: scenario === 'blocked',
      terminateRequested: scenario === 'blocked', terminateReturned: scenario === 'blocked', terminationError: 0,
      cleanup: { timerDrained: true, threadHandleClosed: true, childHandleClosed: true, rootHandleClosed: true, jobHandleClosed: true },
      events: ['owner-acquired', 'creation-owner-configured', 'deadline-armed', 'suspended-root-owned', 'root-resumed', 'root-and-descendant-bound',
        scenario === 'normal' ? 'normal-release' : 'termination', 'owned-set-closed'].map((kind, atMs) => ({ kind, atMs,
          data: kind === 'owner-acquired' ? { flags: 8192, helperPid: 10, members: members([], 0) } : kind === 'termination' ? { reason: 'independent-parent-deadline' } : {} })) } };
  return input;
}
test('complete simulated normal and deadline-terminated sets pass only capability admission', () => {
  for (const mode of ['normal', 'blocked']) {
    const receipt = sealOwnerCapture(positive(mode)); assert.equal(receipt.safeForReuse, true); assert.equal(receipt.actualRuntimeQualified, false);
  }
});
for (const [name, mutate] of [
  ['missing membership', value => { delete value.native.liveMembers; }],
  ['truncated membership', value => { value.native.liveMembers.pids.pop(); }],
  ['foreign PID', value => { value.native.liveMembers.pids[1] = 99; }],
  ['missing member handle', value => { delete value.native.child; }],
  ['missing before-execution owner', value => { value.native.events = value.native.events.filter(event => event.kind !== 'creation-owner-configured'); }],
  ['failed termination', value => { value.native.terminateReturned = false; value.native.terminationError = 5; }],
  ['active descendant', value => { value.native.finalMembers = members([13]); }],
  ['unconfirmed child wait', value => { value.native.childWait = 258; }],
  ['unconfirmed helper close', value => { value.outer.closed = false; }],
  ['undrained timer', value => { value.native.cleanup.timerDrained = false; }],
]) test(`in-memory refusal: ${name}`, () => {
  const value = positive('blocked'); mutate(value); const receipt = sealOwnerCapture(value);
  assert.equal(receipt.safeForReuse, false); assert.ok(receipt.problems.length > 0);
});
test('late closure cannot rewrite a sealed refused receipt', () => {
  const value = positive('blocked'); value.native.finalMembers = members([13]); value.native.childWait = 258;
  const receipt = sealOwnerCapture(value); assert.equal(receipt.safeForReuse, false);
  value.native.finalMembers = members([]); value.native.childWait = 0;
  assert.equal(receipt.safeForReuse, false); assert.equal(receipt.native.childWait, 258);
});
