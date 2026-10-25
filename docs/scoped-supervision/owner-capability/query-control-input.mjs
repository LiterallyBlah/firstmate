// Exact builder synthetic fixture prefix; exports only. No registered tests or controller main.
import {createHash} from 'node:crypto';
import {normalConfiguration,NORMAL_PINS} from './qualify-normal.mjs';
import {boundedOutput} from './capture.mjs';
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
  const queries = Object.fromEntries(['pid','creation','image','membership'].map(key => [key, { ok: true }]));
  native.diagnosticVersion = 1; native.diagnosticOverflow = 0;
  native.cleanup.diagnosticHandlesClosed = true;
  native.diagnosticMembers = [{ pid: 13, role: 'diagnostic-1', acquisition: 'acquired', handle: '0x40', bindingComplete: true,
    initial: { identity: identity(13), queries, wait: { ok: true, result: 258 }, exit: { ok: true, code: 259 } },
    terminal: { identity: identity(13), queries, wait: { ok: true, result: 0 }, exit: { ok: true, code: 0 } } }];
  native.handleInventory['diagnostic-1'] = { acquisition: 'acquired', handle: '0x40', disposition: 'closed' };
  const envelope = { format: 'firstmate.owner-normal/1', scenario: 'normal', caseId: uuid, nonce, sourceSha256: NORMAL_PINS['WindowsJobOwner.cs'], nativeResult: native, invocationError: null, recordingError: null };
  const value = { ...configuration, childScriptPath: configuration.childEntry, rootPreSpawn: { ...entry(12), format: 'firstmate.root-pre-spawn/1', stage: 'before-child-spawn', childEntry: configuration.childEntry },
    helperFile: envelope, outer: { helperPid: 10, error: null, closed: true, status: 0, signal: null, exitObserved: true, exitStatus: 0, exitSignal: null, deadlineFired: false,
    stdout: stream(JSON.stringify(envelope)), stderr: stream(), outputLoss: { stdout: 0, stderr: 0 }, outputErrors: { stdout: 0, stderr: 0 }, observation: { dropped: 0, failures: 0 } },
    rootEntry: entry(12), childEntry: entry(13), rootResult: { childCode: 0, childSignal: null }, childResult: { fulfilled: true }, childOutput: { stdout: stream(), stderr: stream() }, readErrors: [] };
  refreshFinal(value); return value;
}
const refreshFinal = value => {
  value.helperFileRaw = Buffer.from(JSON.stringify(value.helperFile));
  const n = value.helperFile.nativeResult;
  value.outer.stdout = stream(JSON.stringify({ format: 'firstmate.owner-normal-final/1', scenario: 'normal', caseId: value.caseId, nonce: value.nonce,
    sourceSha256: value.helperFile.sourceSha256, file: { name: 'normal-helper.json', bytes: value.helperFileRaw.length,
      sha256: createHash('sha256').update(value.helperFileRaw).digest('hex'), complete: true }, invocationError: value.helperFile.invocationError, recordingError: null,
    originalFailure: { state: n ? n.originalFailure === null ? 'none-recorded' : 'recorded' : 'unavailable', value: n?.originalFailure ?? null, truncated: n?.originalFailureTruncated ?? null } }));
};

export {positive,refreshFinal,stream};
