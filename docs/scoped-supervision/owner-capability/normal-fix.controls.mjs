// Offline counterexamples only. Never runs controller main, native code or fixture entrypoints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { interpretNormal, NORMAL_PINS } from './qualify-normal.mjs';
import { boundedOutput, beforeMemberGuard, recorder, captureCleanup } from './capture.mjs';
import { normalTransport, FILE_LIMIT, FRAME_LIMIT } from './normal-frame.mjs';
import { diagnosticAssessment } from './diagnostic-capture.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const saved = new URL('../../../.local/owner-normal-qualification/normal-1/', import.meta.url);
const bytes = readFileSync(new URL('normal-helper.json', saved)), old = JSON.parse(readFileSync(new URL('normal-capture.json', saved)));
const stream = bytes => { const out = boundedOutput(); out.data(bytes); out.end(); out.close(); return out.snapshot(); };
function framed(raw, file = JSON.parse(raw)) {
  const final = { format: 'firstmate.owner-normal-final/1', scenario: 'normal', caseId: old.caseId, nonce: old.nonce,
    sourceSha256: file.sourceSha256, file: { name: 'normal-helper.json', bytes: raw.length, sha256: sha(raw), complete: true },
    invocationError: null, recordingError: null, originalFailure: { state: 'recorded', value: file.nativeResult.originalFailure, truncated: false } };
  return { ...old, helperFileRaw: raw, outer: { ...old.outer, stdout: stream(Buffer.from(JSON.stringify(final))) } };
}
test('N1 exact 92671-byte saved failure travels through bounded frame without stdout loss', () => {
  assert.equal(bytes.length, 92671); assert.equal(sha(bytes), '954e00a669b90bd8df1c5704044ac4390c073e4fdcf7ebac07f4a58c784c9fca');
  const result = interpretNormal(framed(bytes));
  assert.equal(normalTransport(framed(bytes), JSON.parse(bytes).sourceSha256).complete, true);
  assert.equal(result.native.originalFailure, 'InvalidOperationException: Unexpected live owned set');
  assert.equal(result.normalQualificationPassed, false); assert.equal(result.closureState, 'unknown');
});
const transport = input => normalTransport(input, JSON.parse(bytes).sourceSha256);
const updateFrame = (input, change) => { const frame = JSON.parse(Buffer.from(input.outer.stdout.data, 'base64')); change(frame); input.outer.stdout = stream(Buffer.from(JSON.stringify(frame))); };
test('N1 all four maximum raw output streams fit file cap while final frame stays independent of base64 payload', () => {
  const file = JSON.parse(bytes), output = stream(Buffer.alloc(65536, 255));
  assert.equal(output.data.length, 87384);
  file.nativeResult.rootOutput = { stdout: output, stderr: output }; file.nativeResult.syntheticChildOutput = { stdout: output, stderr: output };
  const raw = Buffer.from(JSON.stringify(file)), input = framed(raw, file);
  assert.ok(raw.length > 4 * 65536 && raw.length < FILE_LIMIT);
  assert.ok(input.outer.stdout.bytes < 1024 && input.outer.stdout.bytes < FRAME_LIMIT);
  assert.equal(transport(input).complete, true); assert.equal(interpretNormal(input).normalQualificationPassed, false);
});
test('N1 worst scalar escaping preserves original 4096-character failure within final cap', () => {
  const file = JSON.parse(bytes); file.nativeResult.originalFailure = '\u0000'.repeat(4096); file.nativeResult.originalFailureTruncated = true;
  const input = framed(Buffer.from(JSON.stringify(file)), file);
  updateFrame(input, frame => { frame.originalFailure.truncated = true; frame.invocationError = frame.recordingError = { message: '\u0001'.repeat(256), truncated: true }; });
  assert.ok(input.outer.stdout.retained < FRAME_LIMIT); assert.equal(transport(input).complete, false);
  assert.equal(transport(input).frame.originalFailure.value, file.nativeResult.originalFailure);
});
for (const [name, change] of [
  ['missing frame', input => { input.outer.stdout = stream(Buffer.alloc(0)); }],
  ['truncated frame', input => { const raw = Buffer.from(input.outer.stdout.data, 'base64'); input.outer.stdout = stream(raw.subarray(0, raw.length - 1)); }],
  ['missing EOF', input => { input.outer.stdout.drained = false; }],
  ['lost bytes', input => { input.outer.stdout.dropped = 1; }],
  ['read error', input => { input.outer.stdout.errors = 1; }],
  ['invalid UTF8', input => { input.outer.stdout = stream(Buffer.from([255])); }],
  ['wrong source', input => updateFrame(input, frame => { frame.sourceSha256 = '0'.repeat(64); })],
  ['wrong nonce', input => updateFrame(input, frame => { frame.nonce = 'wrong'; })],
  ['wrong length', input => updateFrame(input, frame => { frame.file.bytes++; })],
  ['wrong digest', input => updateFrame(input, frame => { frame.file.sha256 = '0'.repeat(64); })],
  ['file not disposed', input => updateFrame(input, frame => { frame.file.complete = false; })],
  ['post-write error', input => updateFrame(input, frame => { frame.recordingError = { message: 'dispose failed', truncated: false }; })],
  ['invocation error', input => updateFrame(input, frame => { frame.invocationError = { message: 'compile failed', truncated: false }; })],
  ['original error replaced', input => updateFrame(input, frame => { frame.originalFailure.value = 'different'; })],
  ['raw bytes changed', input => { input.helperFileRaw = Buffer.concat([input.helperFileRaw, Buffer.from(' ')]); }],
  ['frame over cap', input => updateFrame(input, frame => { frame.padding = 'x'.repeat(FRAME_LIMIT); })],
  ['file over cap', input => { input.helperFileRaw = Buffer.alloc(FILE_LIMIT + 1, 32); }],
]) test(`N1 transport refusal: ${name}`, () => { const input = framed(bytes); change(input); assert.equal(transport(input).complete, false); assert.equal(interpretNormal(input).normalQualificationPassed, false); });
test('N1 producer enforces caps before sinks and emits only final byte frame after file disposal', () => {
  const helper = readFileSync(new URL('normal-only.ps1', import.meta.url), 'utf8');
  assert.ok(helper.indexOf('$bytes.Length -gt 2097152') < helper.indexOf("'normal-helper.json'), [System.IO.FileMode]::CreateNew"));
  assert.ok(helper.indexOf('$file.Dispose()') < helper.indexOf('$descriptor.complete = $true'));
  assert.ok(helper.indexOf('$descriptor.complete = $true') < helper.indexOf('$frameBytes ='));
  assert.ok(helper.indexOf('$frameBytes.Length -gt 32768') < helper.indexOf('$stdout.Write($frameBytes'));
  assert.ok(helper.includes('ComputeHash($bytes)')); assert.ok(!helper.includes('Write-Output ($receipt'));
});
function diagnostics() {
  const identity = pid => ({ pid, creationFileTime: '134374311535571990', image: 'C:/node.exe', member: true });
  const query = () => ({ queries: Object.fromEntries(['pid','creation','image','membership'].map(key => [key, { ok: true }])) });
  const row = pid => ({ pid, role: `diagnostic-${pid}`, handle: `0x${pid}`, acquisition: 'acquired', bindingComplete: true,
    initial: { ...query(), identity: identity(pid), wait: { ok: true, result: 258 }, exit: { ok: true, code: 259 } }, terminal: { ...query(), identity: identity(pid), wait: { ok: true, result: 0 }, exit: { ok: true, code: 0 } } });
  const n = { diagnosticVersion: 1, diagnosticOverflow: 0, root: identity(1), child: identity(2), diagnosticMembers: [row(2)],
    handleInventory: { 'diagnostic-2': { acquisition: 'acquired', handle: '0x2', disposition: 'closed' } },
    observation: { dropped: 0, failures: 0 }, cleanup: { diagnosticHandlesClosed: true }, events: [{ kind: 'owner-acquired', data: { helperPid: 10 } }] };
  const entry = pid => ({ pid, ppid: pid === 1 ? 10 : 1, childPid: 2, caseId: old.caseId, nonce: old.nonce, scenario: 'normal', instance: old.caseId,
    node: 'v24.18.0', threadId: 0, isMainThread: true });
  const input = { caseId: old.caseId, nonce: old.nonce, childScriptPath: 'C:/fixed/child.mjs', nodeVersion: 'v24.18.0', rootEntry: entry(1), childEntry: entry(2),
    rootPreSpawn: { ...entry(1), format: 'firstmate.root-pre-spawn/1', stage: 'before-child-spawn', childEntry: 'C:/fixed/child.mjs' } };
  return { input, n, row };
}
test('N2 complete simulated pair requires stable diagnostic handles and pre/post-spawn correlation', () => {
  const { input, n } = diagnostics(); assert.deepEqual(diagnosticAssessment(input, n), { complete: true, membersClosed: true, reasons: [], origin: 'correlated-fixed-fixture' });
});
test('N2 omitted expected-child diagnostic row cannot claim diagnostic closure', () => {
  const { input, n } = diagnostics(); n.diagnosticMembers = [];
  assert.equal(diagnosticAssessment(input, n).membersClosed, false);
});
test('N2 omitted offending member cannot claim diagnostic closure or origin', () => {
  const { input, n } = diagnostics(); n.membershipEvidence = { offending: { queryOk: true, pids: [1, 2, 3] } };
  assert.equal(diagnosticAssessment(input, n).membersClosed, false); assert.equal(diagnosticAssessment(input, n).complete, false);
});
for (const [name, change] of [
  ['acquisition failed', (i,n) => { n.diagnosticMembers[0].acquisition = 'failed'; }],
  ['query failed', (i,n) => { n.diagnosticMembers[0].initial.queries.image = { ok: false, win32Error: 5 }; }],
  ['job membership query failed', (i,n) => { n.membershipEvidence = { offending: { queryOk: false, complete: false, pids: [] } }; }],
  ['raced PID', (i,n) => { n.diagnosticMembers[0].initial.identity.pid = 3; }],
  ['nonmember', (i,n) => { n.diagnosticMembers[0].initial.identity.member = false; }],
  ['already exited', (i,n) => { n.diagnosticMembers[0].initial.wait.result = 0; }],
  ['terminal query failed', (i,n) => { n.diagnosticMembers[0].terminal.queries.creation = { ok: false }; }],
  ['terminal wait failed', (i,n) => { n.diagnosticMembers[0].terminal.wait = { ok: false }; }],
  ['changed identity', (i,n) => { n.diagnosticMembers[0].terminal.identity.creationFileTime = '134374311535571991'; }],
  ['disposal failed', (i,n) => { n.handleInventory['diagnostic-2'].disposition = 'close-failed'; }],
  ['recording failed', (i,n) => { n.observation.failures = 1; }],
  ['inventory over bound', (i,n) => { n.diagnosticOverflow = 1; }],
]) test(`N2 unknown closure: ${name}`, () => {
  const { input, n } = diagnostics(); const original = Error('Unexpected live owned set'); n.originalFailure = original.message; change(input,n);
  const result = captureCleanup(original, [['terminal', () => diagnosticAssessment(input,n)], ['close', () => { throw Error('close failed'); }]], recorder());
  assert.equal(result.originalFailure, original); assert.equal(result.outcomes[0].value.membersClosed, false); assert.equal(n.originalFailure, original.message);
});
for (const [name, change] of [
  ['missing pre marker', i => { i.rootPreSpawn = null; }],
  ['wrong root instance', i => { i.rootPreSpawn.instance = 'missing'; }],
  ['wrong case', i => { i.childEntry.nonce = 'other'; }],
  ['wrong parent', i => { i.childEntry.ppid = 3; }],
  ['wrong fixed child', i => { i.rootPreSpawn.childEntry = 'C:/other.mjs'; }],
  ['oversized marker', i => { i.rootPreSpawn.padding = 'x'.repeat(4096); }],
]) test(`N2 origin stays unresolved: ${name}`, () => { const { input,n } = diagnostics(); change(input); const result = diagnosticAssessment(input,n); assert.equal(result.complete,false); assert.equal(result.origin,'unresolved'); });
test('N2 saved one/two/three-member sequence preserves original error, extra member never becomes expected child', () => {
  const state = {}, record = recorder(), acquired = [], { input,n,row } = diagnostics();
  n.root.pid = 63616; n.child = null; n.diagnosticMembers = [];
  const sequence = [old.native.beforeResume, old.native.membershipEvidence.lastCompleteBeforeFailure, old.native.membershipEvidence.offending];
  let original;
  for (const members of sequence) {
    for (const pid of members.pids) if (pid !== n.root.pid && !acquired.includes(pid)) { acquired.push(pid); n.diagnosticMembers.push(row(pid)); }
    try { beforeMemberGuard(members,state,n.root.pid,record); } catch(error) { original = error; break; }
  }
  assert.equal(original.message,'Unexpected live owned set'); assert.deepEqual(acquired,[78980,60584]); assert.deepEqual(state.offending.pids,[63616,78980,60584]);
  const result = diagnosticAssessment(input,n); assert.equal(result.complete,false); assert.equal(result.membersClosed,false); assert.equal(result.origin,'unresolved');
  assert.equal(captureCleanup(original,[['record',()=>{throw Error('sink failure');}]],recorder()).originalFailure,original);
});
test('N2 native captures job-local non-root handles before original guard/termination', () => {
  const native = readFileSync(new URL('WindowsJobOwner.cs', import.meta.url), 'utf8');
  assert.match(native, /CaptureDiagnosticMembers\(result\)/);
  assert.match(native, /diagnosticMembers.Count >= 8/);
  assert.match(native, /CloseDiagnosticMembers\(/);
  assert.match(native, /pids.Count > 2 \|\| !pids.Contains\(owner.root.Pid\)/);
  assert.ok(native.indexOf('receipt["originalFailure"] = receipt["error"]') < native.indexOf('owner.Step("failure diagnostic capture"'));
  assert.ok(native.indexOf('owner.Step("failure diagnostic capture"') < native.indexOf('owner.Step("failed-prerequisite termination"'));
  assert.match(native, /Step\("diagnostic membership capture", delegate \{ CaptureDiagnosticMembers\(result\); \}\)/);
  assert.match(native, /pair\["active"\] != 2 \|\| \(uint\)pair\["listed"\] != 2 \|\| \(uint\)pair\["total"\] != 2/);
  assert.ok(!/GetProcesses|Get-CimInstance|taskkill|ProcessName/.test(native));
});
test('N2 bounded pre-spawn marker precedes the fixture spawn and shares root instance', () => {
  const root = readFileSync(new URL('root.mjs', import.meta.url), 'utf8');
  assert.ok(root.indexOf("save('root-pre-spawn.json'") >= 0);
  assert.ok(root.indexOf("save('root-pre-spawn.json'") < root.indexOf('const child = spawn('));
  assert.match(root, /4096/);
});
