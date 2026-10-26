// In-memory saved JSON controls only. No native/helper/controller imports or child processes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifySaved, SAVED_FILES } from './verify-saved.mjs';
const sourceSha256 = '5'.repeat(64), encode = value => Buffer.from(JSON.stringify(value));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(lexemes = ['81.043900000000008', '83.701100000000011']) {
  const nativeText = `{"originalFailure":"InvalidOperationException: original","originalFailureTruncated":false,"events":[{"atMs":${lexemes[0]}},{"atMs":${lexemes[1]}}]}`;
  const identity = { scenario: 'normal', caseId: 'case-1', nonce: 'nonce-1', sourceSha256 };
  const detail = Buffer.from(`{"format":"firstmate.owner-normal/1",${JSON.stringify(identity).slice(1,-1)},"nativeResult":${nativeText},"invocationError":null,"recordingError":null}`);
  const file = JSON.parse(detail), original = { state: 'recorded', value: file.nativeResult.originalFailure, truncated: false };
  const frame = { format: 'firstmate.owner-normal-final/1', ...identity, file: { name: 'normal-helper.json', bytes: detail.length, sha256: digest(detail), complete: true },
    originalFailure: original, invocationError: null, recordingError: null };
  const stdout = Buffer.from(JSON.stringify(frame) + '\n'), stderr = Buffer.alloc(0);
  const stream = bytes => ({ bytes: bytes.length, retained: bytes.length, data: bytes.toString('base64'), encoding: 'base64', drained: true, closed: true, dropped: 0, errors: 0 });
  const outer = { stdout: stream(stdout), stderr: stream(stderr), exitObserved: true, closed: true, status: 2, exitStatus: 2, signal: null, exitSignal: null, error: null };
  const capture = { helperFile: file, native: file.nativeResult, helperFinal: frame, outer, originalFailureDisposition: original,
    normalQualificationPassed: false, ownedSetClosureConfirmed: false, safeForReuse: false, closureState: 'unknown' };
  return { raw: { 'configuration.json': encode(identity), 'normal-helper.json': detail, 'helper.stdout.bin': stdout,
    'helper.stderr.bin': stderr, 'helper-terminal.json': encode(outer), 'normal-capture.json': encode(capture) }, sourceSha256 };
}
function pins(input) { input.bindings = Object.entries(input.raw).map(([path, bytes]) => ({ path, length: bytes.length, sha256: digest(bytes) })); return input; }
const read = (input, name) => JSON.parse(input.raw[name]);
const update = (input, name, fn) => { const value = read(input, name); fn(value); input.raw[name] = encode(value); };
function refreshFrame(input, mutate) {
  const frame = read(input, 'helper.stdout.bin'); mutate(frame);
  input.raw['helper.stdout.bin'] = Buffer.from(JSON.stringify(frame) + '\n');
  const outer = read(input, 'helper-terminal.json'), bytes = input.raw['helper.stdout.bin'];
  Object.assign(outer.stdout, { bytes: bytes.length, retained: bytes.length, data: bytes.toString('base64') });
  input.raw['helper-terminal.json'] = encode(outer);
  update(input, 'normal-capture.json', value => { value.helperFinal = frame; value.outer = outer; });
}
const passed = (r, name) => r.checks.find(row => row.name === name)?.passed;
for (const [name, lexemes, bits] of [
  ['first', ['81.043900000000008','83.70110000000001'], '405442cf41f212d8'],
  ['second', ['81.04390000000001','83.701100000000011'], '4054ecded288ce71'],
  ['both', ['81.043900000000008','83.701100000000011'], null],
]) test(`equivalent binary64 ${name} spellings pass whole-object and independent raw checks`, () => {
  const input = pins(fixture(lexemes));
  const raw = input.raw['normal-helper.json'].toString(), projection = JSON.stringify(read(input, 'normal-capture.json').helperFile);
  assert.notEqual(raw, projection, 'red lexical counterexample remains present');
  if (bits) { const b=Buffer.alloc(8); b.writeDoubleBE(JSON.parse(lexemes[name === 'first' ? 0 : 1])); assert.equal(b.toString('hex'), bits); }
  const before = { ...input, raw: Object.fromEntries(Object.entries(input.raw).map(([name, bytes]) => [name, Buffer.from(bytes)])), bindings: structuredClone(input.bindings) }; const result = verifySaved(input);
  assert.equal(result.savedVerificationPassed, true); assert.ok(result.evidence.every(row => row.bindingMatches));
  assert.equal(result.recordedOutcome.closureState, 'unknown'); assert.equal(result.recordedOutcome.normalQualificationPassed, false);
  assert.equal(result.actualRuntimeQualified, false); assert.equal(result.anotherCaseAuthorized, false);
  assert.deepEqual(input, before, 'checker never mutates saved evidence');
});
for (const [name, value] of [['actual number',82],['adjacent binary64',81.04390000000002],['number-to-string','81.04390000000001'],['number-to-null',null]])
  test(`changed ${name} refuses despite fresh valid raw bindings`, () => {
    const input=fixture(); update(input,'normal-capture.json',v=>{v.native.events[0].atMs=value;});
    const result=verifySaved(pins(input)); assert.equal(result.savedVerificationPassed,false); assert.equal(passed(result,'whole-object:native'),false);
    assert.ok(result.evidence.every(row=>row.bindingMatches));
  });
for (const part of ['frame','file','outer']) test(`changed whole ${part} object refuses`,()=>{
  const input=fixture(); update(input,'normal-capture.json',v=>{v[{frame:'helperFinal',file:'helperFile',outer:'outer'}[part]].unexpected='changed';});
  const result=verifySaved(pins(input)); assert.equal(result.savedVerificationPassed,false); assert.equal(passed(result,`whole-object:${part}`),false);
});
for (const [name,mutate] of [
  ['digest',f=>{f.file.sha256='0'.repeat(64);}], ['length',f=>{f.file.bytes++;}], ['disposal',f=>{f.file.complete=false;}],
]) test(`changed raw-file frame ${name} refuses even with equal objects and refreshed bindings`,()=>{
  const input=fixture(); refreshFrame(input,mutate); const result=verifySaved(pins(input));
  assert.equal(result.savedVerificationPassed,false); assert.equal(passed(result,'raw-file-frame-digest-length-disposal'),false);
  assert.ok(result.checks.filter(row=>row.name.startsWith('whole-object:')).every(row=>row.passed));
});
for (const key of ['dropped','errors','drained','closed','bytes','retained','data']) test(`recorded stdout ${key} discrepancy refuses without relying on object mismatch`,()=>{
  const input=fixture(), outer=read(input,'helper-terminal.json');
  outer.stdout[key]=['drained','closed'].includes(key)?false:key==='data'?'':outer.stdout[key]+1;
  input.raw['helper-terminal.json']=encode(outer); update(input,'normal-capture.json',v=>{v.outer=outer;});
  const result=verifySaved(pins(input)); assert.equal(result.savedVerificationPassed,false); assert.equal(passed(result,'raw-stream-bytes-EOF-close-and-zero-loss'),false);
  assert.equal(passed(result,'whole-object:outer'),true);
});
for (const name of Object.keys(SAVED_FILES)) test(`missing or altered original binding for ${name} refuses`,()=>{
  const input=pins(fixture()); input.bindings.find(row=>row.path===name).sha256='0'.repeat(64);
  assert.equal(verifySaved(input).savedVerificationPassed,false);
});
test('source identity mismatch refuses',()=>{const input=pins(fixture());input.sourceSha256='0'.repeat(64);assert.equal(verifySaved(input).savedVerificationPassed,false);});
test('malformed UTF8 is refused before JSON value comparison',()=>{const input=fixture();input.raw['normal-capture.json']=Buffer.from([0xff]);assert.equal(verifySaved(pins(input)).savedVerificationPassed,false);});
test('duplicate binding, missing file and over-cap frame each refuse',()=>{
  const duplicate=pins(fixture()); duplicate.bindings.push({...duplicate.bindings[0]}); assert.equal(verifySaved(duplicate).savedVerificationPassed,false);
  const missing=pins(fixture()); delete missing.raw['helper.stderr.bin']; assert.equal(verifySaved(missing).savedVerificationPassed,false);
  const large=fixture();large.raw['helper.stdout.bin']=Buffer.alloc(32769,32);assert.equal(verifySaved(pins(large)).savedVerificationPassed,false);
});
test('observed nonzero helper outcome stays recorded, never interpreted as qualification success',()=>{
  const result=verifySaved(pins(fixture()));assert.equal(result.savedVerificationPassed,true);assert.equal(result.changesQualificationOutcome,false);
  assert.equal(result.recordedOutcome.safeForReuse,false);assert.equal(result.recordedOutcome.ownedSetClosureConfirmed,false);
});
test('negative zero and zero are not blanket-normalized by the saved checker',()=>{
  const input=fixture(['-0','0']); const result=verifySaved(pins(input));
  assert.equal(result.savedVerificationPassed,false);assert.equal(passed(result,'whole-object:native'),false);
});
test('stderr loss refuses even when both saved outer projections agree',()=>{
  const input=fixture(), outer=read(input,'helper-terminal.json'); outer.stderr.dropped=1;
  input.raw['helper-terminal.json']=encode(outer);update(input,'normal-capture.json',v=>{v.outer=outer;});
  const result=verifySaved(pins(input));assert.equal(result.savedVerificationPassed,false);
  assert.equal(passed(result,'whole-object:outer'),true);assert.equal(passed(result,'raw-stream-bytes-EOF-close-and-zero-loss'),false);
});
