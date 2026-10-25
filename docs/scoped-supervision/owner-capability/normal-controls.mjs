// Finite offline controls. No fixture imports, process factories, native code or real timers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { normalConfiguration, interpretNormal, NORMAL_PINS } from './qualify-normal.mjs';
import { beforeMemberGuard, recorder, boundedOutput } from './capture.mjs';
const uuid = 'b472718e-d96e-47da-bf13-5e7cd32e52ab', nonce = 'c472718e-d96e-47da-bf13-5e7cd32e52ab';
const members = pids => ({ queryOk: true, accountingOk: true, complete: true, assigned: pids.length, listed: pids.length, active: pids.length, total: 2, pids });
const empty = () => ({ ...members([]), total: 0 });
const stream = value => { const capture = boundedOutput(); if (value) capture.data(Buffer.from(value)); capture.end(); capture.close(); return capture.snapshot(); };
function positive() {
  const configuration = normalConfiguration({ directory: 'C:\\fresh\\normal-1', nodePath: 'C:\\node.exe', nodeVersion: 'v24.18.0', caseId: uuid, nonce, childEntry: 'C:\\fixed\\child.mjs' });
  const identity = pid => ({ pid, handle: '0x' + pid, creationFileTime: '1340582400000000' + pid, image: configuration.nodePath, member: true });
  const entry = pid => ({ pid, ppid: pid === 12 ? 10 : 12, childPid: pid === 12 ? 13 : undefined, caseId: uuid, nonce, scenario: 'normal', node: configuration.nodeVersion, threadId: 0, isMainThread: true, instance: uuid });
  const native = { scenario: 'normal', error: null, originalFailure: null, originalFailureTruncated: false, targetCreated: true, targetResumed: true,
    root: identity(12), child: identity(13), freshOwner: empty(), beforeResume: { ...members([12]), total: 1 }, liveMembers: members([12, 13]), finalMembers: members([]),
    rootWait: 0, childWait: 0, rootExit: 0, childExit: 0, deadlineFired: false, terminateRequested: false, captureVersion: 2,
    cleanup: Object.fromEntries(['timerDrained','threadHandleClosed','childHandleClosed','rootHandleClosed','jobHandleClosed'].map(key => [key, true])),
    handleInventory: Object.fromEntries(['root','child','thread','job'].map(role => [role, { acquisition: 'acquired', disposition: 'closed' }])),
    observation: { dropped: 0, failures: 0, errors: [] }, rootOutput: { stdout: stream(), stderr: stream() }, stdinClosed: true,
    standardWiring: { useStdHandles: true, inheritHandles: true, jobInherited: false, readHandlesInherited: false, jobHandle: '0x100', handleList: ['0x101','0x102','0x103'] },
    events: ['owner-acquired','creation-owner-configured','deadline-armed','suspended-root-owned','root-resumed','root-and-descendant-bound','normal-release','owned-set-closed'].map((kind, atMs) => ({ kind, atMs,
      data: kind === 'owner-acquired' ? { flags: 8192, members: empty(), helperPid: 10 } : {} })) };
  native.terminalEvidence = { members: members([]), ...Object.fromEntries(['root','child'].map(role => [role,
    { identity: { pid: native[role].pid, creationFileTime: native[role].creationFileTime }, wait: { ok: true, result: 0 }, exit: { ok: true, code: 0 } }])) };
  const envelope = { format: 'firstmate.owner-normal/1', scenario: 'normal', caseId: uuid, nonce, sourceSha256: NORMAL_PINS['WindowsJobOwner.cs'], nativeResult: native, invocationError: null, recordingError: null };
  return { ...configuration, helperFile: envelope, outer: { helperPid: 10, error: null, closed: true, status: 0, signal: null, exitObserved: true, exitStatus: 0, exitSignal: null, deadlineFired: false,
    stdout: stream(JSON.stringify(envelope)), stderr: stream(), outputLoss: { stdout: 0, stderr: 0 }, outputErrors: { stdout: 0, stderr: 0 }, observation: { dropped: 0, failures: 0 } },
    rootEntry: entry(12), childEntry: entry(13), rootResult: { childCode: 0, childSignal: null }, childResult: { fulfilled: true }, childOutput: { stdout: stream(), stderr: stream() }, readErrors: [] };
}
const refreshFinal = value => { value.outer.stdout = stream(JSON.stringify(value.helperFile)); };
test('complete simulated normal passes only normal admission, never runtime or another case', () => {
  const result = interpretNormal(positive()); assert.equal(result.normalQualificationPassed, true); assert.equal(result.ownedSetClosureConfirmed, true);
  assert.equal(result.actualRuntimeQualified, false); assert.equal(result.anotherCaseAuthorized, false); assert.equal(result.historicalC2State, 'failed/unknown');
});
test('configuration rejects blocked and reused/nonfresh identity forms', () => {
  for (const patch of [{ scenario: 'blocked' }, { nonce: uuid }, { caseId: 'old-pid' }]) assert.throws(() => normalConfiguration({ ...positive(), ...patch }));
});
test('original unexpected-owned-set payload/error survives termination and uncertain child closure', () => {
  const input = positive(), n = input.helperFile.nativeResult, state = {}, record = recorder();
  beforeMemberGuard(members([12, 13]), state, 12, record);
  let original;
  try { beforeMemberGuard(members([13]), state, 12, record); } catch (error) { original = error; }
  assert.equal(original.message, 'Unexpected live owned set');
  n.error = n.originalFailure = 'InvalidOperationException: ' + original.message;
  n.membershipEvidence = state; n.terminateRequested = true; n.terminateReturned = true; n.terminationError = 0;
  n.child = null; n.handleInventory.child = { acquisition: 'never-acquired', disposition: 'not-attempted' }; n.terminalEvidence.child = { state: 'never-acquired', wait: { ok: false }, exit: { ok: false } };
  input.outer.status = input.outer.exitStatus = 2; input.childOutput = null; refreshFinal(input);
  const result = interpretNormal(input); assert.equal(result.normalQualificationPassed, false); assert.equal(result.native.originalFailure, n.originalFailure);
  assert.deepEqual(result.native.membershipEvidence.lastCompleteBeforeFailure.pids, [12, 13]); assert.deepEqual(result.native.membershipEvidence.offending.pids, [13]);
  assert.equal(result.originalFailureDisposition.state, 'recorded'); assert.deepEqual(result.membershipMismatch.observation.pids, [13]);
  assert.equal(result.native.terminateReturned, true); assert.equal(result.closureState, 'unknown'); assert.equal(result.ownedSetClosureConfirmed, false);
});
test('extra-member mismatch is retained without relaxing the original assertion', () => {
  const state = {}; assert.throws(() => beforeMemberGuard({ ...members([12, 13, 14]), total: 3 }, state, 12, recorder()), /Unexpected live owned set/);
  assert.deepEqual(state.offending.pids, [12, 13, 14]);
});
test('file-only original failure remains visible but cannot pass final-channel admission', () => {
  const input = positive(); input.helperFile.nativeResult.error = input.helperFile.nativeResult.originalFailure = 'original failure'; input.outer.stdout = stream();
  const result = interpretNormal(input); assert.equal(result.native.originalFailure, 'original failure'); assert.equal(result.normalQualificationPassed, false);
});
test('missing native result is explicit unknown, never an invented no-error or closure', () => {
  const input = positive(); input.helperFile.nativeResult = null; input.helperFile.invocationError = { message: 'Add-Type failed' }; refreshFinal(input);
  const result = interpretNormal(input); assert.equal(result.normalQualificationPassed, false); assert.equal(result.originalFailureDisposition.state, 'unavailable');
  assert.equal(result.membershipMismatch.state, 'unavailable'); assert.equal(result.closureState, 'unknown'); assert.equal(result.ownedSetClosureConfirmed, false);
});
test('post-write recording failure refuses despite the earlier successful file', () => {
  const input = positive(), final = structuredClone(input.helperFile); final.recordingError = { message: 'post-write sink failed' }; input.outer.stdout = stream(JSON.stringify(final));
  const result = interpretNormal(input); assert.equal(result.normalQualificationPassed, false); assert.equal(result.helperFinal.recordingError.message, 'post-write sink failed');
  assert.equal(result.helperFile.recordingError, null);
});
for (const [name, mutate] of [
  ['missing helper exit', input => { input.outer.exitObserved = false; }],
  ['outer timeout', input => { input.outer.deadlineFired = true; }],
  ['stdout loss', input => { input.outer.stdout.dropped = 1; }],
  ['stderr not drained', input => { input.outer.stderr.drained = false; }],
  ['missing final membership', input => { delete input.helperFile.nativeResult.terminalEvidence; refreshFinal(input); }],
  ['failed wait', input => { input.helperFile.nativeResult.terminalEvidence.child.wait.result = 258; refreshFinal(input); }],
  ['failed disposal', input => { input.helperFile.nativeResult.handleInventory.job.disposition = 'close-failed'; refreshFinal(input); }],
  ['inconsistent original error', input => { input.helperFile.nativeResult.originalFailure = 'retained failure'; refreshFinal(input); }],
  ['helper identity mismatch', input => { input.outer.helperPid = 99; }],
  ['nonempty fresh owner', input => { input.helperFile.nativeResult.freshOwner = members([99]); refreshFinal(input); }],
  ['unreadable saved file', input => { input.readErrors.push({ error: 'partial JSON' }); }],
  ['blocked payload', input => { input.scenario = 'blocked'; }],
]) test(`conservative uncertainty refusal: ${name}`, () => { const input = positive(); mutate(input); assert.equal(interpretNormal(input).normalQualificationPassed, false); });
test('new source boundary keeps legacy holds and capture/limits, normal call fixed and pinned', () => {
  const text = file => readFileSync(new URL(file, import.meta.url), 'utf8'), native = text('WindowsJobOwner.cs'), helper = text('normal-only.ps1');
  assert.match(native, /Run\([^]*?if \(!CaptureReviewAccepted\)/); assert.match(native, /static readonly bool CaptureReviewAccepted = false/);
  assert.match(native, /QualifyNormal\([^]*?RunOwned\(node, entry, config, directory, "normal"\)/); assert.match(native, /if \(scenario != "normal"\)/);
  assert.ok(native.indexOf('receipt["freshOwner"] = empty') < native.indexOf('bool created = CreateProcessW'));
  for (const unchanged of ['pids.Count > 2 || !pids.Contains(owner.root.Pid)', 'owner.Offending(members); owner.ObserveProcess', '}, null, 5000, Timeout.Infinite)', 'TotalMilliseconds + 8000', 'attempt < 8', 'Thread.Sleep(10)', 'reader.Join(100)', '65536', 'events.Count >= 64']) assert.ok(native.includes(unchanged), unchanged);
  assert.equal((helper.match(/\[FirstMateJobCapability\]::QualifyNormal\(/g) ?? []).length, 1); assert.doesNotMatch(helper, /::Run\(|GetField|SetValue|BindingFlags/);
  for (const [file, expected] of Object.entries(NORMAL_PINS)) assert.equal(createHash('sha256').update(readFileSync(new URL(file, import.meta.url))).digest('hex'), expected);
  const base = new URL('../../../.local/qualification-recovery/baseline/', import.meta.url);
  for (const file of ['run.mjs','invoke.ps1','root.mjs','child.mjs','capture.mjs','admission.mjs']) assert.deepEqual(readFileSync(new URL(file, import.meta.url)), readFileSync(new URL(file, base)));
});
