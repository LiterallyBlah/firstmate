/** One fresh, normal-only test command. Importing this module performs no process/file work. */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, openSync, readSync, closeSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import assert from 'node:assert/strict';
import { sealOwnerCapture } from './admission.mjs';
import { recorder, observeOutput, outputComplete, membershipSnapshot } from './capture.mjs';

export const NORMAL_PINS = Object.freeze({
  'WindowsJobOwner.cs': '6d8042a92ef0b2800cff498fa3964d9f04b80b670fa70f4910ced1f2863ff2ef',
  'normal-only.ps1': 'e88cbb76d9bd634915ebc96cbbce8cf7a2912796ce3556414a6c7ce01f0cd6d6',
  'root.mjs': '59f4adbf5d99f4412a6c458ef3137378f8c93ef7d369a2a5cf5565c131505537',
  'child.mjs': '1d5201bb4fb63e88f83c9831e46e6bc131a8fff38d11fd37f5e90e846189a6e3',
  'capture.mjs': '875933e8b1235230305e8f25162ec94b1f5dc0d85bed9fa4b16cf02f919cfa99',
  'admission.mjs': '0ac15bb42dafb34f430973d0c334156f8a2af38d0f59416fea3dd918d9f8e105',
});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function normalConfiguration({ directory, nodePath, nodeVersion, caseId, nonce, childEntry, scenario = 'normal' }) {
  assert.equal(scenario, 'normal', 'Blocked/other cases are unsupported');
  assert.ok(uuid(caseId) && uuid(nonce) && caseId !== nonce, 'Distinct fresh case/nonce identities required');
  return { directory, nodePath, nodeVersion, caseId, nonce, childEntry, scenario: 'normal' };
}
export function interpretNormal(input) {
  const problems = [], require = (value, reason) => { if (!value) problems.push(reason); };
  let final = null;
  try {
    const stream = input.outer?.stdout;
    assert.ok(outputComplete(stream) && stream.encoding === 'base64' && stream.retained > 0);
    const bytes = Buffer.from(stream.data, 'base64');
    assert.equal(bytes.length, stream.retained); assert.equal(bytes.toString('base64'), stream.data);
    final = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { problems.push('final-helper-output-missing-invalid-or-incomplete'); }
  const file = input.helperFile;
  const envelope = value => value?.format === 'firstmate.owner-normal/1' && value.scenario === 'normal' &&
    value.caseId === input.caseId && value.nonce === input.nonce && value.sourceSha256 === NORMAL_PINS['WindowsJobOwner.cs'];
  require(envelope(final) && envelope(file) && isDeepStrictEqual(final, file), 'helper-final-file-mismatch');
  require(final?.invocationError === null && final?.recordingError === null, 'helper-invocation-or-recording-error');
  require(input.outer?.error === null && input.outer?.exitObserved === true && input.outer.exitStatus === 0 && input.outer.exitSignal === null &&
    input.outer.closed === true && input.outer.status === 0 && input.outer.signal === null, 'helper-exit-or-close-incomplete');
  require(outputComplete(input.outer?.stderr) && input.outer.stderr.bytes === 0, 'helper-stderr-incomplete-or-nonempty');
  require(Array.isArray(input.readErrors) && input.readErrors.length === 0, 'saved-file-read-incomplete');
  require(input.scenario === 'normal', 'normal-only-boundary');
  // Retain a file-only native failure for diagnosis, while missing final evidence always refuses success.
  const native = final?.nativeResult ?? file?.nativeResult ?? null;
  require(native?.originalFailure === null && native?.originalFailureTruncated === false, 'native-original-failure-or-unknown');
  const fresh = membershipSnapshot(native?.freshOwner);
  require(fresh.complete && fresh.active === 0 && fresh.total === 0 && fresh.pids.length === 0, 'fresh-owner-readback-missing-or-nonempty');
  require(Number.isSafeInteger(input.outer?.helperPid) && input.outer.helperPid > 0 &&
    native?.events?.find(event => event.kind === 'owner-acquired')?.data?.helperPid === input.outer.helperPid, 'helper-native-identity-mismatch');
  const capture = sealOwnerCapture({ ...input, native, helperFinal: final });
  require(capture.safeForReuse, 'owned-normal-capture-refused');
  const failure = capture.native?.originalFailure, mismatch = capture.native?.membershipEvidence?.offending;
  return { ...capture, normalProblems: problems, normalQualificationPassed: problems.length === 0,
    originalFailureDisposition: { state: typeof failure === 'string' ? 'recorded' : failure === null ? 'none-recorded' : 'unavailable',
      value: failure ?? null, truncated: capture.native?.originalFailureTruncated ?? null },
    membershipMismatch: { state: mismatch ? 'recorded' : capture.native ? 'none-recorded' : 'unavailable', observation: mismatch ?? null },
    safeForReuse: problems.length === 0 && capture.safeForReuse, historicalC2State: 'failed/unknown',
    actualRuntimeQualified: false, anotherCaseAuthorized: false };
}
function savedJson(path, errors) {
  const limit = 2 * 1024 * 1024;
  let descriptor;
  try {
    descriptor = openSync(path, 'r'); const buffer = Buffer.alloc(limit + 1); let size = 0;
    while (size < buffer.length) { const count = readSync(descriptor, buffer, size, buffer.length - size, null); if (!count) break; size += count; }
    assert.ok(size <= limit, 'Saved JSON exceeds 2 MiB');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)));
  } catch (error) { if (errors.length < 8) errors.push({ path, error: String(error.message).slice(0, 300) }); return null; }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}
async function main() {
  assert.equal(process.argv.length, 2, 'No mode, override or subsequent case is supported');
  assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64'); assert.equal(process.version, 'v24.18.0');
  const source = fileURLToPath(new URL('.', import.meta.url)), repo = fileURLToPath(new URL('../../../', import.meta.url));
  assert.equal(resolve('.'), resolve(repo), 'Use the pinned worktree');
  assert.equal(sha(readFileSync(process.execPath)), '9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de', 'Node image changed');
  const powershell = 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
  assert.equal(sha(readFileSync(powershell)), '60c9b29843624dd8af6b6a7b26147753be6aeef65098b9a503cc50850afe410f', 'PowerShell changed');
  for (const [file, expected] of Object.entries(NORMAL_PINS)) assert.equal(sha(readFileSync(join(source, file))), expected, `Changed source: ${file}`);
  const parent = resolve('.local/owner-normal-qualification'), directory = join(parent, 'normal-1');
  mkdirSync(parent, { recursive: true }); mkdirSync(directory); // atomic persistent one-attempt boundary; never remove/reset
  mkdirSync(join(directory, 'source'));
  for (const file of [...Object.keys(NORMAL_PINS), 'qualify-normal.mjs']) copyFileSync(join(source, file), join(directory, 'source', file));
  const save = (name, data) => writeFileSync(join(directory, name), Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  const configuration = normalConfiguration({ directory, nodePath: process.execPath, nodeVersion: process.version,
    caseId: randomUUID(), nonce: randomUUID(), childEntry: join(source, 'child.mjs') });
  save('configuration.json', configuration);
  const args = ['-NoProfile', '-NonInteractive', '-File', join(source, 'normal-only.ps1'), '-OutputDirectory', directory,
    '-NodePath', process.execPath, '-Configuration', join(directory, 'configuration.json')];
  save('launch.json', { configuration, executable: powershell, args, pins: NORMAL_PINS, controllerSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
    nodeImageSha256: sha(readFileSync(process.execPath)), historicalC2State: 'failed/unknown' });
  const journal = recorder(), helper = spawn(powershell, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = observeOutput(helper.stdout), stderr = observeOutput(helper.stderr), started = performance.now();
  let closed = false, status = null, signal = null, error = null, exitObserved = false, exitStatus = null, exitSignal = null, deadlineFired = false;
  const note = (kind, data) => journal.note(kind, { atMs: performance.now() - started, ...data });
  for (const key of ['stdout', 'stderr']) helper[key]?.on('error', caught => note('helper-output-error', { stream: key, error: String(caught.message).slice(0, 300) }));
  note('helper-created', { pid: helper.pid, controllerPid: process.pid, instance: randomUUID(), node: process.version });
  await new Promise(done => {
    let grace;
    const timer = setTimeout(() => {
      deadlineFired = true; note('outer-deadline', { helperPid: helper.pid });
      try { note('terminate-only-owned-helper', { returned: helper.kill() }); } catch (caught) { note('helper-termination-error', { error: String(caught.message).slice(0, 300) }); }
      grace = setTimeout(() => { note('helper-close-unknown', {}); helper.unref(); helper.stdout?.unref?.(); helper.stderr?.unref?.(); done(); }, 3000);
    }, 15000);
    helper.once('error', caught => { error = String(caught.message).slice(0, 300); note('helper-error', { error }); });
    helper.once('exit', (code, why) => { exitObserved = true; exitStatus = code; exitSignal = why; note('helper-exit', { code, signal: why }); });
    helper.once('close', (code, why) => { closed = true; status = code; signal = why; note('helper-close', { code, signal: why }); clearTimeout(timer); clearTimeout(grace); done(); });
  });
  const out = stdout.snapshot(), err = stderr.snapshot();
  save('helper.stdout.bin', Buffer.from(out.data, 'base64')); save('helper.stderr.bin', Buffer.from(err.data, 'base64'));
  const outer = { helperPid: helper.pid ?? null, closed, status, signal, error, exitObserved, exitStatus, exitSignal, deadlineFired,
    stdout: out, stderr: err, observation: journal.snapshot(), outputLoss: { stdout: out.dropped, stderr: err.dropped }, outputErrors: { stdout: out.errors, stderr: err.errors } };
  save('helper-terminal.json', outer);
  const readErrors = [], read = name => savedJson(join(directory, name), readErrors);
  const input = { ...configuration, outer, helperFile: read('normal-helper.json'), rootEntry: read('root-entry.json'), childEntry: read('child-entry.json'),
    rootResult: read('root-result.json'), childResult: read('child-result.json'), childOutput: read('child-output.json'),
    rootDelayedSignal: existsSync(join(directory, 'root-delayed-signal.json')), childDelayedSignal: existsSync(join(directory, 'child-delayed-signal.json')), readErrors };
  const result = interpretNormal(input); save('normal-capture.json', result);
  console.log(JSON.stringify({ directory, normalQualificationPassed: result.normalQualificationPassed, originalFailure: result.originalFailureDisposition,
    closureState: result.closureState, problems: result.normalProblems, actualRuntimeQualified: false, anotherCaseAuthorized: false }));
  if (!result.normalQualificationPassed) process.exitCode = 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(String(error?.stack ?? error)); process.exitCode = 2; });
}
