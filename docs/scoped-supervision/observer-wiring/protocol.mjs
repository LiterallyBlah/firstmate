/** Test diagnostics only. File frames qualify typed local sources, not authentication. */
import { appendFileSync, readFileSync, statSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { isAbsolute, relative, resolve } from 'node:path';
import { threadId, isMainThread } from 'node:worker_threads';
import { types } from 'node:util';
import { createSession } from '../observer-admission/session.mjs';

export const sha = value => createHash('sha256').update(value).digest('hex');
export const digest = value => sha(JSON.stringify(value));
const within = (root, path) => isAbsolute(path) && relative(resolve(root), resolve(path)) !== '' &&
  !relative(resolve(root), resolve(path)).startsWith('..') && !isAbsolute(relative(resolve(root), resolve(path)));

export function fileSender(path) {
  let count = 0;
  return frame => {
    const line = JSON.stringify(frame) + '\n';
    if (++count > 256 || Buffer.byteLength(line) > 16384) throw Error('External observer channel bound exceeded');
    appendFileSync(path, line); // separate from the observer sink; parent created one file per slot
  };
}

export function createCase({ capsule, home, send, sink = () => {}, maxRecords = 8000, heartbeatMs = 100 }) {
  const session = createSession({ name: capsule.name, sink, maxRecords });
  const actualWorker = { pid: process.pid, threadId, isMainThread, node: process.version, instance: randomUUID() };
  const resources = new Map();
  let seq = 0, heartbeat, finalized = false, entered = false, result = { state: 'pending' }, channelErrors = 0;
  function emit(kind, data) {
    try { send({ protocol: 1, slotId: capsule.slotId, capsuleHash: digest(capsule), caseId: session.identity.caseId,
      actualWorker, sessionWorkerId: session.identity.workerId, home, seq: ++seq, childAtMs: performance.now(), kind, data }); }
    catch (error) { channelErrors++; session.observerError(error); }
  }
  function status(snapshot) {
    return { disposed: snapshot.disposed, incomplete: snapshot.incomplete || channelErrors > 0,
      observerErrors: snapshot.observerErrors, errors: snapshot.errors, dropped: snapshot.dropped,
      fieldTruncations: snapshot.fieldTruncations, pendingCount: snapshot.rows.filter(row => row.state === 'pending').length,
      pendingEntriesDropped: snapshot.pendingEntriesDropped, ancestryTruncations: snapshot.ancestryTruncations,
      channelErrors, resources: structuredClone([...resources.values()]) };
  }
  function flush(label) { const snapshot = session.flush(label); emit('observer-status', status(snapshot)); return snapshot; }
  return {
    session, actualWorker, flush,
    run(work) {
      if (entered || finalized) { session.observerError('Case bridge reuse'); return work(); }
      entered = true;
      return session.run(() => {
        emit('case-entry', { capsule });
        heartbeat = setInterval(() => emit('heartbeat', { pending: result.state === 'pending' }), heartbeatMs);
        let value;
        const complete = state => { result = { state }; emit('case-result', result); };
        try { value = work(); } catch (error) { complete('rejected'); throw error; }
        if (types.isPromise(value)) {
          try { void Promise.prototype.then.call(value, () => complete('fulfilled'), () => complete('rejected')).catch(error => session.observerError(error)); }
          catch (error) { session.observerError(error); }
        }
        else complete('fulfilled');
        return value; // original value/promise/error identity, no await/abort/retry
      });
    },
    registerChild(child, kind = 'existing-exec') {
      if (!child || resources.size >= 32) { session.observerError('Missing child or resource bound exceeded'); return; }
      const id = randomUUID(), record = { id, kind, pid: child.pid ?? null, closed: false };
      resources.set(id, record); emit('resource-entry', record);
      child.once('close', (code, signal) => { record.closed = true; emit('resource-close', { ...record, code, signal }); });
      child.once('error', error => { session.observerError(error); emit('resource-error', { id, message: String(error.message).slice(0, 300) }); });
      // A direct child close never certifies descendants. The runtime gate owns that decision.
    },
    registerLifecycle(resource, kind, event = 'close') {
      if (!resource || resources.size >= 32) { session.observerError('Missing lifecycle resource or bound exceeded'); return; }
      const id = randomUUID(), record = { id, kind, closed: false };
      resources.set(id, record); emit('resource-entry', record);
      resource.once(event, () => { record.closed = true; emit('resource-close', record); });
    },
    finalize(reason = 'test-finished') {
      if (finalized) return;
      finalized = true; clearInterval(heartbeat);
      flush('before-dispose'); session.dispose();
      const final = status(session.flush('post-dispose'));
      emit('case-final', { reason, outcome: result, observer: final });
      return structuredClone({ outcome: result, observer: status(session.snapshot('after-external-final-send')) });
    },
  };
}

/** Independent parent reader: receipt times are parent observations, not child-clock translations. */
export function createWitness({ capsule, homeRoot, expectedPid }) {
  const events = [], problems = [];
  const lossFields = ['observerErrors', 'dropped', 'fieldTruncations', 'pendingEntriesDropped', 'ancestryTruncations', 'channelErrors'];
  let offset = 0, partial = Buffer.alloc(0), seq = 0, caseId, worker, home, final, outcome, entry = false, sealed = false, problemsTotal = 0;
  const fail = message => { problemsTotal++; if (problems.length < 32) problems.push(message); };
  function receive(frame) {
    try {
    if (sealed) return;
    frame = structuredClone(frame);
    if (events.length >= 256) { fail('parent-record-overflow'); return; }
    if (frame.protocol !== 1 || frame.slotId !== capsule.slotId || frame.capsuleHash !== digest(capsule) ||
      frame.actualWorker?.pid !== expectedPid() || typeof frame.home !== 'string' || !within(homeRoot, frame.home) || !Number.isFinite(frame.childAtMs) ||
      typeof frame.caseId !== 'string' || !frame.caseId || !Number.isSafeInteger(frame.seq)) { fail('correlation-mismatch'); return; }
    if (frame.kind === 'case-final' && (!frame.data?.observer || typeof frame.data.observer.disposed !== 'boolean' ||
      typeof frame.data.observer.incomplete !== 'boolean' || !Number.isSafeInteger(frame.data.observer.pendingCount) || frame.data.observer.pendingCount < 0 ||
      lossFields.some(key => !Number.isSafeInteger(frame.data.observer[key]) || frame.data.observer[key] < 0) ||
      !Array.isArray(frame.data.observer.errors) || frame.data.observer.errors.length > 8 ||
      !Array.isArray(frame.data.observer.resources) || frame.data.observer.resources.length > 32 ||
      frame.data.observer.resources.some(resource => typeof resource.closed !== 'boolean') ||
      !['fulfilled', 'rejected', 'pending'].includes(frame.data.outcome?.state))) { fail('malformed-final-status'); return; }
    if (frame.seq !== seq + 1) fail('source-sequence-gap'); seq = frame.seq;
    if (caseId && (frame.caseId !== caseId || frame.home !== home || digest(frame.actualWorker) !== digest(worker))) { fail('worker-case-or-home-changed'); return; }
    caseId ??= frame.caseId; worker ??= frame.actualWorker; home ??= frame.home;
    events.push({ ...frame, parentAtMs: performance.now() });
    if (frame.kind === 'case-entry') {
      if (entry || digest(frame.data.capsule) !== digest(capsule)) fail('invalid-or-duplicate-entry');
      entry = true;
    }
    if (frame.kind === 'case-result') {
      if (outcome || !['fulfilled', 'rejected'].includes(frame.data?.state)) fail('invalid-or-duplicate-result');
      outcome = frame.data;
    }
    if (frame.kind === 'case-final') { if (final) fail('duplicate-final'); final = frame.data; }
    } catch { fail('malformed-external-frame'); }
  }
  return {
    receive,
    read(path) {
      try {
        if (statSync(path).size > 256 * 16384) { fail('external-file-overflow'); return; }
        const bytes = readFileSync(path); const next = Buffer.concat([partial, bytes.subarray(offset)]); offset = bytes.length;
        let start = 0, end;
        while ((end = next.indexOf(10, start)) !== -1) {
          const line = next.subarray(start, end); start = end + 1;
          if (line.length > 16384) { fail('external-frame-overflow'); continue; }
          try { receive(JSON.parse(line.toString())); } catch { fail('malformed-external-frame'); }
        }
        partial = next.subarray(start);
      } catch (error) { fail(`external-read:${error.code ?? 'error'}`); }
    },
    hasEntry: () => entry,
    seal({ runtime, directClosed, terminationRequested = false, closureEvidence = [] }) {
      sealed = true;
      if (partial.length) fail('partial-external-frame');
      if (!entry) fail('missing-entry'); if (!outcome) fail('missing-result'); if (!final) fail('missing-final');
      if (outcome && final && outcome.state !== final.outcome.state) fail('result-final-mismatch');
      const observerComplete = Boolean(final && final.observer.disposed && !final.observer.incomplete &&
        lossFields.every(key => final.observer[key] === 0) && final.observer.errors.length === 0);
      const workDrained = Boolean(final && final.observer.pendingCount === 0 && final.outcome.state !== 'pending');
      const knownResourcesClosed = Boolean(final && final.observer.resources.every(resource => resource.closed));
      const supported = runtime === 'fixed-synthetic-node';
      const runtimeClosed = supported && directClosed; // no general descendant claim
      const captureAdmissible = problems.length === 0 && observerComplete;
      return structuredClone({ capsule, caseId, worker, events, problems, problemRecordsDropped: Math.max(0, problemsTotal - problems.length), outcome: outcome ?? { state: 'missing' }, final: final ?? null,
        observerComplete, workDrained, knownResourcesClosed, captureAdmissible, supported, directClosed, runtimeClosed,
        terminationRequested, closureEvidence, retainFixture: true,
        safeForReuse: captureAdmissible && workDrained && knownResourcesClosed && runtimeClosed });
    },
  };
}
