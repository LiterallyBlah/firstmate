// NC1 offline controls: copied pure synthetic input, no native/helper/main/fixture entrypoints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { positive, refreshFinal } from './query-control-input.mjs';
import { interpretNormal } from './qualify-normal.mjs';
const native = input => input.helperFile.nativeResult;
const row = n => n.diagnosticMembers[0];
const failed = key => key === 'wait' ? { ok: false, win32Error: 6 } : { ok: false, win32Error: 5 };
function samples(n) {
  const sample = value => ({ members: { queryOk: true, accountingOk: true, complete: true, assigned: 0, listed: 0, active: 0, total: 2, pids: [] },
    root: structuredClone(n.terminalEvidence.root), child: structuredClone(n.terminalEvidence.child), diagnosticMembers: [{ pid: 13, observation: value }] });
  n.membershipEvidence = { terminalSamples: [sample(structuredClone(row(n).terminal)), sample(structuredClone(row(n).terminal)), sample(structuredClone(row(n).terminal))] };
  n.terminalEvidence = structuredClone(n.membershipEvidence.terminalSamples[2]);
  return n.membershipEvidence.terminalSamples;
}
function refusal(input) {
  const before = structuredClone(native(input)); refreshFinal(input);
  const result = interpretNormal(input);
  assert.equal(result.transport.complete, true, 'query-only mutation keeps raw digest/frame valid');
  assert.equal(result.normalQualificationPassed, false); assert.equal(result.safeForReuse, false);
  assert.equal(result.ownedSetClosureConfirmed, false); assert.equal(result.closureState, 'unknown');
  assert.ok(result.diagnostics.reasons.includes('diagnostic-recorded-required-query-failure'));
  assert.equal(result.actualRuntimeQualified, false); assert.equal(result.anotherCaseAuthorized, false);
  assert.deepEqual(native(input), before, 'admission preserves raw evidence and original error');
  return result;
}
test('NC1 complete copied positive remains synthetic-only with successful pending initial wait258', () => {
  const input = positive(); assert.equal(row(native(input)).initial.wait.result, 258);
  const result = interpretNormal(input); assert.equal(result.normalQualificationPassed, true); assert.equal(result.ownedSetClosureConfirmed, true);
  assert.equal(result.actualRuntimeQualified, false); assert.equal(result.anotherCaseAuthorized, false);
});
test('R02-NC1a: failed initial diagnostic exit query must refuse', () => {
  const input = positive(); row(native(input)).initial.exit = { ok: false, win32Error: 5 };
  assert.equal(native(input).observation.failures, 0); refusal(input);
});
function recoveredTerminal(n, key) {
  // Exact independent mutations: earlier failure, later successful replacement, zero cumulative count.
  const member = row(n), earlier = structuredClone(member.terminal); earlier[key] = { ok: false, win32Error: 6 };
  if (key === 'exit') earlier.wait = { ok: true, result: 258 };
  const sample = value => ({ members: { queryOk: true, accountingOk: true, complete: true, assigned: 0, listed: 0, active: 0, total: 2, pids: [] },
    root: structuredClone(n.terminalEvidence.root), child: structuredClone(n.terminalEvidence.child), diagnosticMembers: [{ pid: 13, observation: value }] });
  n.membershipEvidence = { terminalSamples: [sample(earlier), sample(structuredClone(member.terminal))] };
  n.terminalEvidence = structuredClone(n.membershipEvidence.terminalSamples[1]);
}
for (const key of ['wait','exit']) test(`R02-NC1${key === 'wait' ? 'b' : 'c'}: earlier terminal ${key} failure cannot disappear after success`, () => {
  const input = positive(); recoveredTerminal(native(input), key); assert.equal(native(input).observation.failures, 0); refusal(input);
});
test('NC1 earlier successful pending wait258/exit259 remains allowed until terminal closure', () => {
  const input = positive(), n = native(input), history = samples(n);
  history[0].members = { queryOk: true, accountingOk: true, complete: true, assigned: 2, listed: 2, active: 2, total: 2, pids: [12,13] };
  for (const value of [history[0].root, history[0].child, history[0].diagnosticMembers[0].observation]) { value.wait = { ok: true, result: 258 }; value.exit = { ok: true, code: 259 }; }
  refreshFinal(input); const result = interpretNormal(input);
  assert.equal(result.normalQualificationPassed, true); assert.equal(result.ownedSetClosureConfirmed, true); assert.equal(n.observation.failures, 0);
});
const locations = {
  'initial diagnostic': n => row(n).initial,
  'first diagnostic terminal sample': n => samples(n)[0].diagnosticMembers[0].observation,
  'middle diagnostic terminal sample': n => samples(n)[1].diagnosticMembers[0].observation,
  'last retained diagnostic sample with separate successful latest': n => samples(n)[2].diagnosticMembers[0].observation,
  'earlier root terminal': n => samples(n)[0].root,
  'earlier child terminal': n => samples(n)[0].child,
  'current root terminal': n => n.terminalEvidence.root,
  'initial root handle event': n => { const value = structuredClone(n.terminalEvidence.root); n.events.push({ kind: 'handle-observation', data: value }); return value; },
  'retained inventory observation': n => { n.handleInventory.root.observation = structuredClone(n.terminalEvidence.root); return n.handleInventory.root.observation; },
};
for (const [name, locate] of Object.entries(locations)) for (const key of ['wait','exit']) test(`NC1 all retained evidence refuses ${name} ${key} failure`, () => {
  const input = positive(); locate(native(input))[key] = failed(key); refusal(input);
});
for (const [name, mutate] of [
  ['WAIT_FAILED with inconsistent ok:true', value => { value.wait = { ok: true, result: 0xffffffff }; }],
  ['wait error code with inconsistent ok:true', value => { value.wait = { ok: true, result: 258, win32Error: 6 }; }],
  ['exit error code with inconsistent ok:true', value => { value.exit = { ok: true, code: 259, win32Error: 5 }; }],
  ['missing required initial exit', value => { delete value.exit; }],
  ['recorded identity query failure with zero counter', value => { value.queries.image = { ok: false, win32Error: 5 }; }],
]) test(`NC1 cumulative zero cannot conceal ${name}`, () => { const input = positive(); mutate(row(native(input)).initial); refusal(input); });
test('NC1 original fixture exception and raw failed query remain separate from cumulative accounting', () => {
  const input = positive(), n = native(input); n.error = n.originalFailure = 'InvalidOperationException: original fixture failure';
  n.observation.failures = 1; n.observation.errors = ['diagnostic-1 WaitForSingleObject: 6']; row(n).initial.wait = failed('wait');
  const result = refusal(input); assert.equal(result.originalFailureDisposition.value, n.originalFailure);
  assert.deepEqual(result.native.observation, n.observation); assert.deepEqual(result.native.diagnosticMembers[0].initial.wait, failed('wait'));
});
test('NC1 nonzero cumulative failure cannot be hidden by otherwise successful raw samples', () => {
  const input = positive(); native(input).observation.failures = 1; refreshFinal(input);
  const result = interpretNormal(input); assert.equal(result.normalQualificationPassed, false); assert.equal(result.ownedSetClosureConfirmed, false);
});
test('NC1 native return accounting changes no native call, deadline, bound or original assertion', () => {
  const current = readFileSync(new URL('WindowsJobOwner.cs', import.meta.url), 'utf8');
  const parent = readFileSync(new URL('../../../.local/normal-query-fix/parent/isolated/docs/scoped-supervision/owner-capability/WindowsJobOwner.cs', import.meta.url), 'utf8');
  const part = text => { const start = text.indexOf('        Step(role + " wait", delegate {'); const end = text.indexOf('        ((Dictionary<string, object>)handleInventory[role])', start); return { before: text.slice(0,start), body: text.slice(start,end), after: text.slice(end) }; };
  const now = part(current), old = part(parent); assert.equal(now.before, old.before); assert.equal(now.after, old.after);
  for (const name of ['WaitForSingleObject','GetExitCodeProcess']) assert.equal((now.body.match(new RegExp(`= ${name}\\(`, 'g')) ?? []).length, 1);
  assert.ok(now.body.includes('if (wait == UInt32.MaxValue) ObservationError(role + " WaitForSingleObject: " + waitError)'));
  assert.ok(now.body.includes('if (!exitOk) ObservationError(role + " GetExitCodeProcess: " + exitError)'));
  assert.ok(now.body.indexOf('int waitError =') < now.body.indexOf('if (wait == UInt32.MaxValue) ObservationError'));
  assert.ok(now.body.indexOf('int exitError =') < now.body.indexOf('if (!exitOk) ObservationError'));
  assert.ok(now.body.includes('D("ok", false, "win32Error", waitError)')); assert.ok(now.body.includes('D("ok", false, "win32Error", exitError)'));
});
