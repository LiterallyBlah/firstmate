import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createSession } from './session.mjs';
import { runContainedWorker } from './containment.mjs';
import { filesystemPhases, observeExistingExec, literalCallback, targets } from './adapters.mjs';
import { observeStartupPage } from './browser.mjs';

test('T1: fresh case/worker identity, scoped activation and restoration; late completion/cleanup cannot enter next case', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const original = function (value) { assert.equal(this.tag, 'receiver'); return value; };
  const subject = { tag: 'receiver', method: original };
  const a = createSession({ name: 'A' });
  a.wrapMethods(subject, 'subject', ['method']);
  assert.equal(subject.method(1), 1); assert.equal(a.snapshot('inactive').rows.length, 0);
  assert.equal(a.run(() => subject.method(pending)), pending);
  a.dispose();
  assert.equal(subject.method, original);
  const before = a.snapshot('disposed').rows;
  const b = createSession({ name: 'B' }); b.wrapMethods(subject, 'subject', ['method']);
  assert.notEqual(a.identity.caseId, b.identity.caseId); assert.notEqual(a.identity.workerId, b.identity.workerId);
  assert.equal(b.run(() => subject.method('B-result')), 'B-result');
  const recorded = b.snapshot('active').rows.length;
  assert.equal(subject.method('outside-case-context'), 'outside-case-context');
  assert.equal(b.snapshot('outside-context').rows.length, recorded);
  release('A-result'); await pending; await Promise.resolve();
  assert.deepEqual(a.snapshot('after-late-completion').rows, before);
  assert.equal(b.snapshot('B').rows.filter(row => row.name === 'subject.method').length, 1);
  b.dispose(); assert.equal(subject.method, original);
  const count = b.snapshot('disposed').rows.length; subject.method('cleanup');
  assert.equal(b.snapshot('cleanup').rows.length, count);
  assert.equal(a.run(() => 'original-still-executes'), 'original-still-executes');
  assert.match(a.snapshot('invalid-reuse').errors[0], /fresh observer/);
});

test('T2: cap and failing sink never suppress delegation, change promise identity, value or original error', async () => {
  let delegated = 0;
  const result = Promise.resolve({ original: true }), failure = Error('original rejection');
  const rejected = Promise.reject(failure); rejected.catch(() => {});
  const s = createSession({ name: 'overflow-sink', maxRecords: 1, sink() { throw Error('synthetic disk error'); } });
  s.run(() => {
    assert.equal(s.call('over-cap', () => { delegated++; return result; }), result);
    assert.equal(s.call('over-cap-rejection', () => { delegated++; return rejected; }), rejected);
    assert.throws(() => s.call('over-cap-throw', () => { delegated++; throw failure; }), error => error === failure);
    s.note('oversized', 'x'.repeat(2000));
  });
  assert.equal(delegated, 3); assert.equal(await result, await result);
  await assert.rejects(rejected, error => error === failure);
  const receipt = s.flush('failure');
  assert.equal(receipt.rows.length, 1); assert.equal(receipt.dropped, 4);
  assert.equal(receipt.observerErrors, 1); assert.equal(receipt.incomplete, true);
  assert.match(receipt.errors[0], /synthetic disk error/); s.dispose();
  const bounded = createSession({ name: 'field-bound' });
  bounded.run(() => bounded.note('bounded', 'x'.repeat(2000)));
  assert.equal(bounded.snapshot('bounded').fieldTruncations, 1);
  assert.equal(bounded.snapshot('bounded').rows[1].data.length, 1024); bounded.dispose();
  const restoreBound = createSession({ name: 'restore-bound', maxRecords: 1 });
  const method = () => 'native-result', subject = { a: method, b: method, c: method };
  restoreBound.wrapMethods(subject, 'fixture', ['a', 'b', 'c']);
  assert.equal(subject.b, method); assert.equal(subject.c, method);
  assert.equal(restoreBound.run(() => subject.a()), 'native-result'); restoreBound.dispose();
  assert.equal(subject.a, method); assert.ok(restoreBound.snapshot('bounded-restores').dropped >= 2);
});

test('T2 positive: complete receipt and native-style open/handle promise, receiver and errors preserved', async () => {
  const receipts = [], handle = { tag: 'handle', sync() { assert.equal(this, handle); return Promise.resolve('sync-result'); }, writeFile() {}, close() {} };
  const opened = Promise.resolve(handle), actual = { open() { assert.equal(this, actual); return opened; } };
  const s = createSession({ name: 'positive', sink: receipt => receipts.push(receipt) });
  const fs = filesystemPhases(s, actual);
  await s.run(async () => { assert.equal(fs.open('fixture'), opened); assert.equal(await opened, handle); assert.equal(await handle.sync(), 'sync-result'); });
  await Promise.resolve();
  assert.equal(s.flush('complete').incomplete, false); assert.equal(receipts.length, 1);
  assert.equal(receipts[0].pending.length, 0); s.dispose(); assert.equal(Object.hasOwn(handle, 'sync'), true);
});

for (const mode of ['blocked-thread', 'nonsettling']) test(`T3: external witness contains ${mode}; next clean worker has no inherited fixture`, async () => {
  const entry = fileURLToPath(new URL('./synthetic-worker.mjs', import.meta.url));
  const receipt = await runContainedWorker({ entry, args: [mode], deadlineMs: 40, graceMs: 130 });
  assert.equal(receipt.safeForNextCase, true); assert.equal(receipt.terminationRequested, true); assert.equal(receipt.terminationConfirmed, true);
  assert.ok(receipt.events.find(event => event.kind === 'external-deadline'));
  const close = receipt.events.findIndex(event => event.kind === 'close');
  assert.ok(close > receipt.events.findIndex(event => event.kind === 'termination-request'));
  if (mode === 'blocked-thread') {
    const signal = JSON.parse(receipt.events.find(event => event.kind === 'cooperative-signal').data);
    assert.equal(signal.requestedMs, 20); assert.ok(signal.observedMs >= 100);
  } else {
    const heartbeat = JSON.parse(receipt.events.find(event => event.kind === 'heartbeat').data);
    assert.ok(heartbeat.pending.some(row => row.ancestors.includes('synthetic.unresolved')));
  }
  const clean = await runContainedWorker({ entry, args: ['clean'], deadlineMs: 500 });
  assert.equal(clean.safeForNextCase, true); assert.equal(clean.code, 0); assert.equal(clean.terminationRequested, false);
  assert.notEqual(clean.workerId, receipt.workerId);
  assert.deepEqual(JSON.parse(clean.events.find(event => event.kind === 'case-result').data), { result: 'original-result', cleanup: 'completed' });
  console.log(JSON.stringify({ control: mode, receipt, next: clean }));
});

test('T3 negative: kill request without close never opens admission; late close cannot rewrite returned evidence', async () => {
  const child = Object.assign(new EventEmitter(), { pid: 5678, connected: true, exitCode: null, signalCode: null,
    stdout: Object.assign(new EventEmitter(), { destroy() {} }), stderr: Object.assign(new EventEmitter(), { destroy() {} }),
    kill: () => true, disconnect() { this.connected = false; }, unref() {} });
  const receipt = await runContainedWorker({ entry: 'synthetic-not-launched', deadlineMs: 5, startupMs: 5, exitWaitMs: 5,
    launch: () => child });
  assert.equal(receipt.killReturned, true); assert.equal(receipt.terminationConfirmed, false); assert.equal(receipt.safeForNextCase, false);
  assert.ok(receipt.events.some(event => event.kind === 'termination-unconfirmed'));
  child.emit('close', null, 'SIGKILL');
  assert.equal(receipt.safeForNextCase, false); // sealed observation is a value, not a live mutable handle
});

test('identity: records existing promise.child fields and rejection once; no substitute probe or identity', async () => {
  for (const rejected of [false, true]) {
    const child = Object.assign(new EventEmitter(), { pid: 1234, killed: rejected, spawnfile: 'existing-probe', spawnargs: ['unchanged'] });
    const failure = Object.assign(Error('original error'), { code: 'ETIMEDOUT', signal: 'SIGTERM', killed: true, stdout: 'unknown', stderr: 'original stderr' });
    const value = { stdout: 'alive:123', stderr: '' };
    const promise = Object.assign(rejected ? Promise.reject(failure) : Promise.resolve(value), { child });
    promise.catch(() => {});
    let calls = 0;
    const options = { timeout: 5000, maxBuffer: 4096, windowsHide: true }, args = ['unchanged'];
    const s = createSession({ name: 'actual-result-shape' });
    const wrapped = observeExistingExec(s, (file, received, opts) => {
      calls++; assert.equal(file, 'existing-probe'); assert.equal(received, args); assert.equal(opts, options); return promise;
    });
    const returned = s.run(() => wrapped('existing-probe', args, options)); assert.equal(returned, promise);
    child.emit('exit', rejected ? null : 0, rejected ? 'SIGTERM' : null); child.emit('close', rejected ? null : 0, rejected ? 'SIGTERM' : null);
    if (rejected) await assert.rejects(returned, error => error === failure); else assert.equal(await returned, value);
    await Promise.resolve(); assert.equal(calls, 1);
    const rows = s.snapshot('child').rows;
    assert.equal(JSON.parse(rows.find(row => row.name === 'identity.child.exit').data).killed, rejected);
    const result = JSON.parse(rows.find(row => row.name === 'identity.exec.result').data);
    assert.equal(result.code, rejected ? 'ETIMEDOUT' : 0);
    assert.equal(rows.find(row => row.name === 'identity.exec.stdout').data, rejected ? 'unknown' : 'alive:123');
    assert.equal(s.snapshot('child').incomplete, false); s.dispose();
  }
});

test('literal adapters bind unchanged callback bodies and original bounds; neither callback is executed', async () => {
  const hashes = [];
  for (const target of targets) {
    const source = await readFile(target.path, 'utf8'), literal = literalCallback(source, target);
    assert.equal(literal.timeoutMs, 5000); assert.ok(literal.body.includes('expect(')); hashes.push({ ...target, ...literal, body: undefined });
  }
  assert.equal(hashes[0].sha256, 'c20c1cff852619e52197e6c9df656fa6154c3bad7c85aeb2a413c6b29732e71c');
  console.log(JSON.stringify({ control: 'literal-only-no-execution', hashes }));
});

test('browser candidate: same held press and original result/failure; trace and receipt precede original close', async () => {
  for (const failed of [false, true]) {
    const order = [], error = Error('original click timeout'), action = failed ? Promise.reject(error) : Promise.resolve('clicked');
    action.catch(() => {});
    const locator = { getByRole() { return locator; }, waitFor() { return Promise.resolve(); }, click(options) {
      assert.deepEqual(options, { delay: 1500 }); order.push('original-click'); return action;
    } };
    const originalClose = async () => { order.push('original-close'); return 'closed'; };
    const page = { context: () => ({ tracing: { start: async () => order.push('trace-start'), stop: async () => order.push('trace-stop') } }),
      exposeBinding: async () => {}, addInitScript: async () => {}, getByText: () => locator, getByTestId: () => locator,
      evaluate: async () => ({ drawing: true, rect: { x: 1, y: 2 } }), close: originalClose };
    const s = createSession({ name: 'fake-browser', sink: () => order.push('receipt') });
    const observed = await s.run(() => observeStartupPage(page, s, '.local/observer-admission'));
    await observed.getByText(/^Drawn with /).waitFor();
    const original = observed.getByTestId('firstmate-deck-decision-legend').getByRole('button', { name: 'Answer' }).click({ delay: 1500 });
    assert.equal(original, action);
    if (failed) await assert.rejects(original, value => value === error); else assert.equal(await original, 'clicked');
    assert.equal(await observed.close(), 'closed'); assert.equal(page.close, originalClose);
    assert.ok(order.indexOf('trace-stop') < order.indexOf('original-close')); assert.ok(order.indexOf('receipt') < order.indexOf('original-close'));
    assert.ok(s.snapshot('closed').rows.some(row => row.name === `browser.click.${failed ? 'failed' : 'complete'}`));
    assert.ok(s.snapshot('closed').rows.some(row => row.name === 'browser.waitFor.complete'));
  }
});

test('browser negative: delayed capture/sink errors do not replace original action or cleanup; down/up geometry is observational', async () => {
  const listeners = {}, events = [], closeResult = { original: 'closed' };
  let callback, init, initArg, binding, closeCalls = 0;
  const page = { context: () => ({ tracing: { start: () => new Promise(() => {}), stop: async () => { throw Error('trace sink failure'); } } }),
    exposeBinding: async (name, fn) => { binding = name; callback = fn; },
    addInitScript: async (fn, arg) => { init = fn; initArg = arg; }, close: async () => { closeCalls++; return closeResult; } };
  const s = createSession({ name: 'capture-failure', sink() { throw Error('receipt sink failure'); } });
  const observed = await s.run(() => observeStartupPage(page, s, '.local/observer-admission', { captureBudgetMs: 5 }));
  const documentBefore = globalThis.document, windowBefore = globalThis.window;
  globalThis.document = { body: { innerText: 'Drawn with WebGL' }, addEventListener: (name, fn) => { listeners[name] = fn; } };
  globalThis.window = { [binding]: value => { events.push(value); callback(null, value); return Promise.resolve(); } };
  try {
    init(initArg);
    for (const type of ['pointerdown', 'pointerup']) listeners[type]({ clientX: 4, clientY: 5,
      target: { closest: () => ({ getBoundingClientRect: () => ({ x: 1, y: 2, width: 3, height: 4 }) }) } });
  } finally {
    if (documentBefore === undefined) delete globalThis.document; else globalThis.document = documentBefore;
    if (windowBefore === undefined) delete globalThis.window; else globalThis.window = windowBefore;
  }
  assert.deepEqual(events.map(event => event.type), ['pointerdown', 'pointerup']); assert.equal(events[1].rect.height, 4);
  assert.equal(await observed.close(), closeResult); assert.equal(closeCalls, 1);
  assert.equal(s.snapshot('observer-failed').incomplete, true); assert.equal(s.snapshot('observer-failed').observerErrors, 3);
});
