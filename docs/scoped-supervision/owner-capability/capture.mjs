/** Portable capture helpers only. Native ABI/process behavior requires separate qualification. */
const count = value => Number.isSafeInteger(value) && value >= 0;
const brief = error => { try { return String(error?.message ?? error).slice(0, 300); } catch { return 'unreadable-observation-error'; } };
export function recorder({ limit = 64, sink = () => {} } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64) throw Error('Invalid record bound');
  const rows = [], errors = []; let dropped = 0, failures = 0;
  return {
    note(kind, data) {
      try {
        if (rows.length >= limit) { dropped++; return; }
        const row = structuredClone({ kind, data }); rows.push(row); sink(structuredClone(row));
      } catch (error) { failures++; if (errors.length < 8) errors.push(brief(error)); }
    },
    snapshot: () => structuredClone({ rows, dropped, failures, errors, incomplete: dropped > 0 || failures > 0 }),
  };
}
export function membershipSnapshot(raw = {}) {
  const result = { phase: String(raw.phase ?? 'unknown').slice(0, 40), queryOk: raw.queryOk === true, accountingOk: raw.accountingOk === true, complete: false };
  // Failed native calls do not make output buffer fields valid, including plausible zeroes.
  if (count(raw.queryError)) result.queryError = raw.queryError;
  if (count(raw.accountingError)) result.accountingError = raw.accountingError;
  if (result.queryOk) {
    if (count(raw.assigned)) result.assigned = raw.assigned;
    if (count(raw.listed)) result.listed = raw.listed;
    if (Array.isArray(raw.pids) && raw.pids.length <= 8 && raw.pids.every(pid => Number.isSafeInteger(pid) && pid > 0)) result.pids = [...raw.pids];
    if (count(raw.returnedBytes)) result.returnedBytes = raw.returnedBytes;
  }
  if (result.accountingOk) {
    if (count(raw.active)) result.active = raw.active;
    if (count(raw.total)) result.total = raw.total;
  }
  result.complete = Boolean(result.queryOk && result.accountingOk && count(result.assigned) && result.assigned === result.listed &&
    result.listed <= 8 && result.pids?.length === result.listed && new Set(result.pids).size === result.listed &&
    result.active === result.listed && count(result.total) && result.total >= result.active);
  return result;
}
export function beforeMemberGuard(raw, state, rootPid, record) {
  const previousComplete = state.lastComplete ?? null;
  const observation = membershipSnapshot(raw); state.lastObservation = observation;
  if (observation.complete) state.lastComplete = structuredClone(observation);
  record.note('membership', observation);
  if (!observation.complete || observation.pids.length > 2 || !observation.pids.includes(rootPid)) {
    state.lastCompleteBeforeFailure = structuredClone(previousComplete); state.offending = structuredClone(observation); record.note('offending-membership', observation);
    throw Error(observation.complete ? 'Unexpected live owned set' : 'Incomplete job membership');
  }
  return observation;
}
export function captureCleanup(originalFailure, steps, record) {
  const outcomes = [], errors = []; let failures = 0, outcomesDropped = 0;
  for (const [name, work] of steps) {
    try { const value = work(); if (outcomes.length < 16) outcomes.push({ name, value }); else outcomesDropped++; record.note(name, value); }
    catch (error) { failures++; if (errors.length < 8) errors.push({ name, error: brief(error) }); record.note('cleanup-error', { name, error: brief(error) }); }
  }
  return { originalFailure, outcomes, outcomesDropped, errors, failures }; // preserve the exact original error/value separately
}
export function boundedOutput({ limit = 65536 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 65536) throw Error('Invalid output bound');
  const chunks = []; let retained = 0, bytes = 0, dropped = 0, errors = 0, drained = false, closed = false;
  return {
    data(value) { try { const chunk = Buffer.from(value), keep = Math.min(chunk.length, limit - retained); bytes += chunk.length; dropped += chunk.length - keep;
      if (keep) { chunks.push(Buffer.from(chunk.subarray(0, keep))); retained += keep; } } catch { errors++; } },
    error() { errors++; }, end() { drained = true; }, close() { closed = true; },
    snapshot: () => ({ bytes, retained, dropped, errors, drained, closed, encoding: 'base64', data: Buffer.concat(chunks).toString('base64') }),
  };
}
export function observeOutput(stream) {
  const capture = boundedOutput();
  if (!stream) { capture.error(); return capture; }
  stream.on('data', value => capture.data(value)); stream.on('error', () => capture.error());
  stream.on('end', () => capture.end()); stream.on('close', () => capture.close()); return capture;
}
export const outputComplete = value => Boolean(value && value.drained === true && value.closed === true && value.errors === 0 && value.dropped === 0 &&
  count(value.bytes) && count(value.retained) && value.retained <= 65536 && value.retained === value.bytes);
export const standardWiringComplete = value => Boolean(value?.useStdHandles === true && value.inheritHandles === true && value.jobInherited === false &&
  value.readHandlesInherited === false && /^0x[1-9a-f][0-9a-f]*$/i.test(value.jobHandle) && Array.isArray(value.handleList) && value.handleList.length === 3 &&
  new Set(value.handleList).size === 3 && value.handleList.every(handle => /^0x[1-9a-f][0-9a-f]*$/i.test(handle) && handle !== value.jobHandle));
export function closureAssessment(native) {
  const reasons = [], terminal = native?.terminalEvidence;
  const members = membershipSnapshot(terminal?.members);
  if (native?.captureVersion !== 2) reasons.push('closure-schema-missing');
  if (!members.complete) reasons.push('terminal-membership-unknown');
  else if (members.active !== 0 || members.pids.length !== 0 || members.total !== 2) reasons.push('terminal-owned-set-not-empty-pair');
  for (const role of ['root', 'child']) {
    const handle = native?.handleInventory?.[role], observed = terminal?.[role], bound = native?.[role];
    if (handle?.acquisition !== 'acquired' || !Number.isSafeInteger(bound?.pid) || bound.pid <= 0 || !/^\d{16,20}$/.test(bound?.creationFileTime) ||
      observed?.identity?.pid !== bound.pid || observed?.identity?.creationFileTime !== bound.creationFileTime)
      reasons.push(role + '-handle-or-identity-unbound');
    if (observed?.wait?.ok !== true || observed.wait.result !== 0 || observed?.exit?.ok !== true || !count(observed.exit.code) || observed.exit.code > 0xffffffff) reasons.push(role + '-terminal-wait-or-exit-unknown');
  }
  const observation = native?.observation;
  if (!observation || observation.dropped !== 0 || observation.failures !== 0) reasons.push('observation-incomplete');
  const confirmed = reasons.length === 0;
  return { confirmed, state: confirmed ? 'confirmed' : members.complete && members.active > 0 ? 'open' : 'unknown', reasons };
}
