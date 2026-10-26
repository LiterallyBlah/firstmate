/** Pure local-byte admission. A digest binds bytes; it does not authenticate IPC. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { outputComplete } from './capture.mjs';
export const FILE_LIMIT = 2 * 1024 * 1024, FRAME_LIMIT = 32768;
export function normalTransport(input, sourceSha256) {
  const reasons = [], require = (ok, reason) => { if (!ok) reasons.push(reason); };
  let frame = null, file = null, bytes = null;
  try {
    const stream = input.outer?.stdout;
    assert.ok(outputComplete(stream) && stream.encoding === 'base64' && stream.retained > 0 && stream.retained <= FRAME_LIMIT);
    const raw = Buffer.from(stream.data, 'base64');
    assert.equal(raw.length, stream.retained); assert.equal(raw.toString('base64'), stream.data);
    frame = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch { reasons.push('final-helper-frame-missing-invalid-or-incomplete'); }
  try {
    assert.ok(Buffer.isBuffer(input.helperFileRaw) && input.helperFileRaw.length > 0 && input.helperFileRaw.length <= FILE_LIMIT);
    bytes = input.helperFileRaw;
    file = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { reasons.push('helper-raw-file-missing-invalid-or-over-cap'); }
  const identity = value => value?.scenario === 'normal' && value.caseId === input.caseId && value.nonce === input.nonce && value.sourceSha256 === sourceSha256;
  require(frame?.format === 'firstmate.owner-normal-final/1' && identity(frame), 'final-helper-frame-identity');
  require(file?.format === 'firstmate.owner-normal/1' && identity(file), 'helper-file-identity');
  const evidence = { bytes: bytes?.length ?? null, sha256: bytes ? createHash('sha256').update(bytes).digest('hex') : null };
  require(frame?.file?.name === 'normal-helper.json' && frame.file.complete === true && evidence.bytes !== null &&
    frame.file.bytes === evidence.bytes && frame.file.sha256 === evidence.sha256, 'helper-raw-file-digest-length-or-disposal');
  require(frame?.invocationError === null && frame?.recordingError === null && file?.invocationError === null && file?.recordingError === null,
    'helper-final-invocation-or-recording-error');
  const original = file?.nativeResult;
  require(frame?.originalFailure?.state === (original ? typeof original.originalFailure === 'string' ? 'recorded' : original.originalFailure === null ? 'none-recorded' : 'unavailable' : 'unavailable') &&
    frame?.originalFailure?.value === (original?.originalFailure ?? null) && frame?.originalFailure?.truncated === (original?.originalFailureTruncated ?? null), 'helper-original-failure-disagreement');
  // A parsed file-only failure remains diagnostic evidence. No file-only input can qualify.
  return { complete: reasons.length === 0, reasons, evidence, frame, file: file ?? input.helperFile ?? null };
}
