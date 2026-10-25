/** Test-only. No gates, cancellation, filesystem substitutes or product imports. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { types } from 'node:util';

const text = value => { try { return String(value).slice(0, 1024); } catch { return '[unreadable observer field]'; } };
const errorText = error => { try { return text(error?.code ?? error?.message ?? error); } catch { return '[unreadable error]'; } };

export function createSession({ name, maxRecords = 8000, sink = () => {} }) {
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 8000) throw Error('Invalid observer bound');
  const identity = { caseId: randomUUID(), workerId: `${process.pid}:${randomUUID()}`, name: String(name).slice(0, 160) };
  const context = new AsyncLocalStorage(), rows = [], restores = [], errors = [];
  const started = performance.now();
  let active = false, disposed = false, entered = false, dropped = 0, fieldTruncations = 0, observerErrors = 0;
  const elapsed = () => performance.now() - started;
  function fault(error) {
    observerErrors++;
    if (errors.length < 8) errors.push(errorText(error).slice(0, 300));
  }
  function note(name, data = '') {
    if (!active || disposed) return;
    if (rows.length >= maxRecords) { dropped++; return; }
    const value = text(data);
    // text() is bounded before retention; count loss explicitly rather than silently truncating.
    try { if (String(data).length > 1024) fieldTruncations++; } catch { fieldTruncations++; }
    rows.push({ id: rows.length, name: text(name).slice(0, 160), at: elapsed(), data: value });
  }
  function call(name, work) {
    if (!active || disposed || !context.getStore()) return work();
    let row;
    if (rows.length < maxRecords) {
      row = { id: rows.length, parent: context.getStore().span ?? null, name: String(name).slice(0, 160), at: elapsed(), state: 'pending' };
      rows.push(row);
    } else dropped++;
    const end = (rejected, error) => {
      if (!row || disposed) return;
      row.end = elapsed(); row.state = rejected ? 'rejected' : 'completed';
      if (rejected) row.error = errorText(error).slice(0, 160);
    };
    return context.run({ span: row?.id ?? context.getStore().span }, () => {
      let value;
      try { value = work(); } catch (error) { end(true, error); throw error; }
      // Return the ORIGINAL promise/value/error. Side continuations still perturb scheduling
      // and rejection observation; this observer cannot establish historical timing causes.
      if (types.isPromise(value)) {
        try { void Promise.prototype.then.call(value, () => end(false), error => end(true, error)); }
        catch (error) { fault(error); }
      } else end(false);
      return value;
    });
  }
  function wrapMethods(target, prefix, names) {
    for (const name of names) {
      if (restores.length >= maxRecords) { dropped++; continue; }
      const own = Object.getOwnPropertyDescriptor(target, name);
      let owner = target, descriptor = own;
      while (!descriptor && (owner = Object.getPrototypeOf(owner))) descriptor = Object.getOwnPropertyDescriptor(owner, name);
      if (!descriptor || typeof descriptor.value !== 'function') { fault(`Missing method ${prefix}.${name}`); continue; }
      const original = descriptor.value;
      const wrapper = function (...args) { return call(`${prefix}.${name}`, () => Reflect.apply(original, this, args)); };
      try {
        Object.defineProperty(target, name, { ...descriptor, value: wrapper });
        restores.push(() => {
          if (Object.getOwnPropertyDescriptor(target, name)?.value !== wrapper) { fault(`Restore conflict ${prefix}.${name}`); return; }
          if (own) Object.defineProperty(target, name, own);
          else delete target[name];
        });
      } catch (error) { fault(error); }
    }
  }
  function snapshot(label) {
    const pendingRows = rows.filter(row => row.state === 'pending');
    let ancestryTruncations = 0;
    const pending = pendingRows.slice(0, 128).map(row => {
      const ancestors = []; let current = row;
      while (current && ancestors.length < 32) { ancestors.push(current.name); current = rows[current.parent]; }
      if (current) ancestryTruncations++;
      return { id: row.id, ancestors };
    });
    return structuredClone({ ...identity, label, mode: 'native-delegation-only', active, disposed,
      elapsedMs: elapsed(), dropped, fieldTruncations, observerErrors, errors,
      pendingEntriesDropped: Math.max(0, pendingRows.length - 128), ancestryTruncations,
      incomplete: dropped > 0 || fieldTruncations > 0 || observerErrors > 0 || pendingRows.length > 128 || ancestryTruncations > 0,
      pending, rows });
  }
  function flush(label) {
    try {
      const result = sink(snapshot(label));
      if (types.isPromise(result)) {
        fault('Async sink unsupported: receipt not synchronously retained');
        void result.catch(error => fault(error));
      }
    } catch (error) { fault(error); }
    return snapshot(label);
  }
  return {
    identity, call, note, wrapMethods, snapshot, flush,
    observing: () => active && !disposed && Boolean(context.getStore()),
    observerError: fault,
    run(work) {
      if (entered || disposed) { fault('A fresh observer is required for every case'); return work(); }
      entered = true; active = true;
      return context.run({ span: null }, () => call('original-callback', work));
    },
    dispose() {
      if (disposed) return;
      active = false;
      for (const restore of restores.reverse()) { try { restore(); } catch (error) { fault(error); } }
      restores.length = 0; disposed = true;
      // Pending rows are retained as unfinished; disposal NEVER asserts they drained.
    },
  };
}
