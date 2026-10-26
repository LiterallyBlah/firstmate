/** Saved-byte verification only; never imports or invokes qualification/native code. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { openSync, readSync, closeSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

export const SAVED_FILES = Object.freeze({
  'configuration.json': 2097152, 'normal-capture.json': 2097152,
  'normal-helper.json': 2097152, 'helper-terminal.json': 2097152,
  'helper.stdout.bin': 32768, 'helper.stderr.bin': 65536,
});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const count = value => Number.isSafeInteger(value) && value >= 0;
const json = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
export function verifySaved({ raw, bindings, sourceSha256 }) {
  const checks = [], evidence = [], parsed = {};
  const check = (name, ok) => checks.push({ name, passed: ok === true });
  for (const [name, limit] of Object.entries(SAVED_FILES)) {
    const bytes = raw?.[name], bounded = Buffer.isBuffer(bytes) && bytes.length <= limit;
    const pins = Array.isArray(bindings) ? bindings.filter(row => row.path === name) : [];
    const digest = bounded ? sha(bytes) : null;
    const matches = bounded && pins.length === 1 && count(pins[0].length) && pins[0].length === bytes.length &&
      /^[a-f0-9]{64}$/.test(pins[0].sha256) && pins[0].sha256 === digest;
    check(`raw:${name}`, matches);
    evidence.push({ name, bytes: bounded ? bytes.length : null, sha256: digest, bindingMatches: matches });
    if (bounded && (name.endsWith('.json') || name === 'helper.stdout.bin')) {
      try { parsed[name] = json(bytes); check(`json:${name}`, true); }
      catch { check(`json:${name}`, false); }
    }
  }
  const configuration = parsed['configuration.json'], capture = parsed['normal-capture.json'];
  const file = parsed['normal-helper.json'], frame = parsed['helper.stdout.bin'], outer = parsed['helper-terminal.json'];
  // Compare whole parsed objects with the SAME JSON-number semantics as the controller.
  // No reserialization, epsilon, decimal rounding or normalization of other fields.
  for (const [name, actual, expected] of [
    ['frame', capture?.helperFinal, frame], ['file', capture?.helperFile, file],
    ['native', capture?.native, file?.nativeResult], ['outer', capture?.outer, outer],
  ]) check(`whole-object:${name}`, actual !== undefined && expected !== undefined && isDeepStrictEqual(actual, expected));
  const identity = value => Boolean(configuration && value?.scenario === 'normal' && value.caseId === configuration.caseId &&
    value.nonce === configuration.nonce && typeof value.caseId === 'string' && typeof value.nonce === 'string' &&
    /^[a-f0-9]{64}$/.test(sourceSha256) && value.sourceSha256 === sourceSha256);
  check('frame-and-file-identity', identity(frame) && identity(file) && frame?.format === 'firstmate.owner-normal-final/1' && file?.format === 'firstmate.owner-normal/1');
  const detail = evidence.find(row => row.name === 'normal-helper.json');
  check('raw-file-frame-digest-length-disposal', frame?.file?.name === 'normal-helper.json' && frame.file.complete === true &&
    detail?.bindingMatches === true && frame.file.bytes === detail.bytes && frame.file.sha256 === detail.sha256);
  const stream = (name, value) => {
    const bytes = raw?.[name];
    return Buffer.isBuffer(bytes) && value?.encoding === 'base64' && value.data === bytes.toString('base64') &&
      value.drained === true && value.closed === true && value.errors === 0 && value.dropped === 0 &&
      count(value.bytes) && count(value.retained) && value.bytes === bytes.length && value.retained === bytes.length;
  };
  check('raw-stream-bytes-EOF-close-and-zero-loss', stream('helper.stdout.bin', outer?.stdout) && stream('helper.stderr.bin', outer?.stderr));
  check('single-final-frame', Buffer.isBuffer(raw?.['helper.stdout.bin']) && /^[^\r\n]+\r?\n$/.test(raw['helper.stdout.bin'].toString('utf8')));
  check('separate-helper-exit-and-close-observed', outer?.exitObserved === true && outer.closed === true &&
    Number.isInteger(outer.exitStatus) && outer.exitStatus === outer.status && outer.exitSignal === null && outer.signal === null && outer.error === null);
  const native = file?.nativeResult;
  const original = native ? { state: typeof native.originalFailure === 'string' ? 'recorded' : native.originalFailure === null ? 'none-recorded' : 'unavailable',
    value: native.originalFailure ?? null, truncated: native.originalFailureTruncated ?? null } : null;
  check('original-failure-projection', original !== null && isDeepStrictEqual(original, frame?.originalFailure) && isDeepStrictEqual(original, capture?.originalFailureDisposition));
  return { format: 'firstmate.owner-normal-saved-verification/2', savedVerificationPassed: checks.every(row => row.passed), checks, evidence,
    comparison: 'whole-object JSON.parse + isDeepStrictEqual; raw-byte SHA256/length/stream checks independent',
    recordedOutcome: capture ? { normalQualificationPassed: capture.normalQualificationPassed, ownedSetClosureConfirmed: capture.ownedSetClosureConfirmed,
      closureState: capture.closureState, safeForReuse: capture.safeForReuse, originalFailure: capture.originalFailureDisposition } : null,
    changesQualificationOutcome: false, actualRuntimeQualified: false, anotherCaseAuthorized: false };
}

function readBounded(path, limit) {
  const handle = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(limit + 1); let size = 0;
    while (size < buffer.length) { const n = readSync(handle, buffer, size, buffer.length - size, null); if (!n) break; size += n; }
    assert.ok(size <= limit, `Saved file exceeds bound: ${path}`);
    return buffer.subarray(0, size);
  } finally { closeSync(handle); }
}
function main() {
  assert.equal(process.argv.length, 6, 'Arguments: saved-case-directory saved-case-manifest source-sha256 NEW-receipt-path');
  const [directory, manifestPath, sourceSha256, receiptPath] = process.argv.slice(2);
  assert.notEqual(resolve(receiptPath), resolve(manifestPath));
  // Refuse writing into the case: original raw files and reservations remain untouched.
  const relativeReceipt = resolve(receiptPath).toLowerCase(), casePath = resolve(directory).toLowerCase();
  assert.ok(relativeReceipt !== casePath && !relativeReceipt.startsWith(casePath + sep));
  const manifestRaw = readBounded(manifestPath, 2097152), manifest = json(manifestRaw);
  assert.equal(resolve(directory), resolve(manifest.originalDirectory));
  const raw = Object.fromEntries(Object.entries(SAVED_FILES).map(([name, limit]) => [name, readBounded(join(directory, name), limit)]));
  const result = verifySaved({ raw, bindings: manifest.files, sourceSha256 });
  const receipt = { ...result, utc: new Date().toISOString(), node: process.version, directory: resolve(directory),
    checkerSha256: sha(readFileSync(fileURLToPath(import.meta.url))), manifestSha256: sha(manifestRaw), sourceSha256 };
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ receipt: resolve(receiptPath), savedVerificationPassed: receipt.savedVerificationPassed,
    recordedOutcome: receipt.recordedOutcome, actualRuntimeQualified: false, anotherCaseAuthorized: false }));
  if (!result.savedVerificationPassed) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
