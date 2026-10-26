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
  // New capture requirements are explicit simulated facts, not a native ownership qualification.
  input.native.captureVersion = 2; input.native.observation = { dropped: 0, failures: 0, errors: [] };
  input.native.handleInventory = Object.fromEntries(['root', 'child', 'thread', 'job'].map(role => [role, { acquisition: 'acquired', disposition: 'closed' }]));
  const terminalProcess = role => ({ identity: { pid: input.native[role].pid, creationFileTime: input.native[role].creationFileTime }, wait: { ok: true, result: 0 }, exit: { ok: true, code: input.native[role + 'Exit'] } });
  input.native.terminalEvidence = { members: { ...members([]), queryOk: true, accountingOk: true }, root: terminalProcess('root'), child: terminalProcess('child') };
  const emptyOutput = () => ({ bytes: 0, retained: 0, dropped: 0, errors: 0, drained: true, closed: true });
  input.native.rootOutput = { stdout: emptyOutput(), stderr: emptyOutput() }; input.childOutput = { stdout: emptyOutput(), stderr: emptyOutput() };
  input.native.standardWiring = { useStdHandles: true, inheritHandles: true, jobInherited: false, readHandlesInherited: false, jobHandle: '0x100', handleList: ['0x101', '0x102', '0x103'] }; input.native.stdinClosed = true;
  input.outer.observation = { dropped: 0, failures: 0 }; input.outer.outputLoss = { stdout: 0, stderr: 0 }; input.outer.outputErrors = { stdout: 0, stderr: 0 };
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
  ['failed handle close', value => { value.native.handleInventory.child.disposition = 'close-failed'; }],
  ['never acquired handle is not closed', value => { value.native.handleInventory.child = { acquisition: 'never-acquired', disposition: 'not-attempted' }; }],
  ['recording overflow', value => { value.native.observation.dropped = 1; }],
  ['recording error', value => { value.native.observation.failures = 1; }],
  ['root output lost', value => { value.native.rootOutput.stderr.dropped = 1; }],
  ['child drain unknown', value => { delete value.childOutput; }],
  ['failed stream read', value => { value.childOutput.stdout.errors = 1; }],
  ['standard handles inconsistent', value => { value.native.standardWiring.inheritHandles = false; }],
  ['stdin close failed', value => { value.native.stdinClosed = false; }],
  ['outer recorder lost events', value => { value.outer.observation.dropped = 1; }],
  ['outer recorder failed', value => { value.outer.observation.failures = 1; }],
  ['outer output truncated', value => { value.outer.outputLoss.stderr = 1; }],
  ['outer output read failed', value => { value.outer.outputErrors.stdout = 1; }],
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
