import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createCase, createWitness, fileSender, sha } from './protocol.mjs';
import { runSynthetic } from './runner.mjs';
import { requireRuntime } from './runtime.mjs';
import { ownExistingExec, retainDiagnosticHome } from './client.mjs';
import { prepareSelected, identityPlugin, retainSetup, setupPlugin, sourceDigest } from './selected.mjs';
import { runOwnedStartup, startupCore } from './startup.mjs';

const root = resolve('.local/observer-wiring/controls'); mkdirSync(root, { recursive: true });
const pair = (options = {}) => {
  const capsule = { name: 'synthetic-unit', slotId: randomUUID(), sourceHead: 'd3b099587759d132761edd10ea8ca377fd608b2a', sourceHash: sha('synthetic'), bodyHash: sha('synthetic-body'), observerHashes: { unit: sha('observer') } };
  const frames = [], home = join(root, randomUUID());
  const witness = createWitness({ capsule, homeRoot: root, expectedPid: () => process.pid });
  const bridge = createCase({ capsule, home, send: frame => { frames.push(frame); witness.receive(frame); }, ...options });
  return { capsule, frames, bridge, witness, home };
};

test('correlated actual case, independent clocks, original promise/result/error and post-disposal final status', async () => {
  for (const rejected of [false, true]) {
    const p = pair(), error = Error('original'), value = { original: true };
    const work = rejected ? Promise.reject(error) : Promise.resolve(value); work.catch(() => {});
    assert.equal(p.bridge.run(() => work), work);
    if (rejected) await assert.rejects(work, caught => caught === error); else assert.equal(await work, value);
    const final = p.bridge.finalize(); assert.equal(final.observer.disposed, true);
    const receipt = p.witness.seal({ runtime: 'fixed-synthetic-node', directClosed: true });
    assert.equal(receipt.safeForReuse, true); assert.equal(receipt.outcome.state, rejected ? 'rejected' : 'fulfilled');
    assert.equal(receipt.worker.pid, process.pid); assert.ok(receipt.worker.instance);
    assert.equal(receipt.events[0].data.capsule.sourceHead, p.capsule.sourceHead);
    assert.ok(receipt.events.every(frame => Number.isFinite(frame.childAtMs) && Number.isFinite(frame.parentAtMs)));
    assert.equal(p.frames.at(-1).kind, 'case-final');
  }
});

test('promise observation never invokes a replaced then method or suppresses the original result', async () => {
  const p = pair(), value = { original: true }, promise = Promise.resolve(value);
  promise.then = () => { throw Error('Observer invoked replaced then'); };
  try {
    assert.equal(p.bridge.run(() => promise), promise);
    assert.equal(await promise, value);
  } finally { p.bridge.finalize(); }
});

for (const problem of ['sink', 'restore', 'truncated', 'channel']) test(`independent final status preserves original operation despite ${problem}`, async () => {
  const p = pair(problem === 'sink' ? { sink() { throw Error('sink failed'); } } : problem === 'channel' ? { send() { throw Error('separate channel failed'); } } : {});
  const subject = { method: () => 'original-result' };
  p.bridge.session.wrapMethods(subject, 'fixture', ['method']);
  assert.equal(p.bridge.run(() => {
    const value = subject.method();
    if (problem === 'restore') subject.method = () => 'other';
    if (problem === 'truncated') p.bridge.session.note('large', 'x'.repeat(2048));
    return value;
  }), 'original-result');
  const final = p.bridge.finalize(); assert.equal(final.outcome.state, 'fulfilled'); assert.equal(final.observer.incomplete, true);
  const receipt = p.witness.seal({ runtime: 'fixed-synthetic-node', directClosed: true });
  assert.equal(receipt.safeForReuse, false); assert.equal(receipt.captureAdmissible, false);
  if (problem !== 'channel') assert.equal(receipt.final.observer.disposed, true);
});

test('bad correlation/missing final never admits capture; complete is separate from drained', () => {
  const p = pair(); p.bridge.run(() => new Promise(() => {}));
  const final = p.bridge.finalize(); assert.equal(final.observer.incomplete, false); assert.ok(final.observer.pendingCount > 0);
  const receipt = p.witness.seal({ runtime: 'fixed-synthetic-node', directClosed: true });
  assert.equal(receipt.workDrained, false); assert.equal(receipt.safeForReuse, false);
  const other = createWitness({ capsule: p.capsule, homeRoot: root, expectedPid: () => process.pid });
  other.receive({ ...p.frames[0], capsuleHash: 'wrong-head-or-hash' });
  assert.ok(other.seal({ runtime: 'fixed-synthetic-node', directClosed: true }).problems.includes('correlation-mismatch'));
});

test('final-only channel failure is returned as incomplete; malformed final and real-runtime close stay inadmissible', () => {
  const frames = [];
  const p = pair({ send(frame) { if (frame.kind === 'case-final') throw Error('final channel failed'); frames.push(frame); } });
  p.bridge.run(() => 1); const final = p.bridge.finalize(); assert.equal(final.observer.incomplete, true); assert.equal(final.observer.channelErrors, 1);
  for (const frame of frames) p.witness.receive(frame);
  assert.equal(p.witness.seal({ runtime: 'fixed-synthetic-node', directClosed: true }).safeForReuse, false);
  const q = pair(); q.bridge.run(() => 1); q.bridge.finalize();
  for (const runtime of ['vitest-forks', 'powershell-exec', 'chromium']) {
    const witness = createWitness({ capsule: q.capsule, homeRoot: root, expectedPid: () => process.pid });
    for (const frame of q.frames) witness.receive(frame);
    const receipt = witness.seal({ runtime, directClosed: true }); assert.equal(receipt.supported, false); assert.equal(receipt.safeForReuse, false);
  }
  const invalid = createWitness({ capsule: q.capsule, homeRoot: root, expectedPid: () => process.pid });
  for (const frame of q.frames) invalid.receive(frame.kind === 'case-final' ? { ...frame, data: {} } : frame);
  assert.ok(invalid.seal({ runtime: 'fixed-synthetic-node', directClosed: true }).problems.includes('malformed-final-status'));
  const inconsistent = createWitness({ capsule: q.capsule, homeRoot: root, expectedPid: () => process.pid });
  for (const frame of q.frames) inconsistent.receive(frame.kind === 'case-final' ? { ...frame,
    data: { ...frame.data, observer: { ...frame.data.observer, fieldTruncations: 1, incomplete: false } } } : frame);
  assert.equal(inconsistent.seal({ runtime: 'fixed-synthetic-node', directClosed: true }).captureAdmissible, false);
});

test('framed external file retains split UTF-8 and refuses partial/missing capture', () => {
  const p = pair(), path = join(root, randomUUID() + '.jsonl');
  p.bridge.run(() => 1); p.bridge.finalize();
  const frames = p.frames.map(frame => ({ ...frame, extraObservation: 'é' }));
  const bytes = Buffer.from(frames.map(frame => JSON.stringify(frame)).join('\n') + '\n');
  const split = bytes.indexOf(Buffer.from('é')) + 1; assert.ok(split > 0);
  const reader = createWitness({ capsule: p.capsule, homeRoot: root, expectedPid: () => process.pid });
  writeFileSync(path, bytes.subarray(0, split)); reader.read(path); appendFileSync(path, bytes.subarray(split)); reader.read(path);
  const receipt = reader.seal({ runtime: 'fixed-synthetic-node', directClosed: true });
  assert.equal(receipt.captureAdmissible, true); assert.equal(receipt.events[0].extraObservation, 'é');
  const missing = createWitness({ capsule: p.capsule, homeRoot: root, expectedPid: () => process.pid });
  writeFileSync(path, bytes.subarray(0, 12)); missing.read(path);
  assert.ok(missing.seal({ runtime: 'fixed-synthetic-node', directClosed: true }).problems.includes('partial-external-frame'));
});

for (const scenario of ['fulfilled', 'rejected', 'blocked', 'nonsettling', 'missing-entry', 'missing-final', 'sink-failure', 'restoration-conflict', 'truncated']) {
  test(`owned fixed child: ${scenario}; closure, capture and outcome remain independent`, async () => {
    const receipt = await runSynthetic({ root, scenario });
    const positive = ['fulfilled', 'rejected'].includes(scenario);
    assert.equal(receipt.safeForReuse, positive); assert.equal(receipt.directClosed, true);
    assert.equal(receipt.retainFixture, true); assert.ok(existsSync(join(receipt.directory, 'homes/owned')));
    if (positive) assert.equal(receipt.outcome.state, scenario);
    if (['blocked', 'nonsettling'].includes(scenario)) {
      assert.equal(receipt.workDrained, false); assert.equal(receipt.terminationRequested, true);
      assert.ok(receipt.closureEvidence.some(row => row.kind === 'external-deadline'));
    }
    console.log(JSON.stringify({ scenario, directory: receipt.directory, safeForReuse: receipt.safeForReuse, problems: receipt.problems }));
  });
}

test('failed kill and unconfirmed exit stay blocked; late close cannot rewrite external receipt', async () => {
  let child, bridge;
  const receipt = await runSynthetic({ root, scenario: 'nonsettling', deadlineMs: 5, graceMs: 5, closeMs: 5,
    launch(_entry, [configPath]) {
      const config = JSON.parse(readFileSync(configPath));
      child = Object.assign(new EventEmitter(), { pid: process.pid, connected: true, kill: () => false,
        disconnect() { this.connected = false; }, unref() {}, send(_message, callback) { bridge.finalize('synthetic-abort'); callback(); } });
      bridge = createCase({ capsule: config.capsule, home: config.home, send: fileSender(config.external) });
      bridge.run(() => new Promise(() => {})); return child;
    } });
  assert.equal(receipt.directClosed, false); assert.equal(receipt.safeForReuse, false);
  assert.ok(receipt.closureEvidence.some(row => row.kind === 'kill-returned' && row.value === false));
  child.emit('close', null, 'SIGKILL'); assert.equal(receipt.directClosed, false);
});

test('real runtime capability preflight blocks before any browser/resource factory', async () => {
  for (const name of ['vitest-forks', 'powershell-exec', 'chromium']) assert.throws(() => requireRuntime(name), { code: 'UNSUPPORTED_OWNERSHIP' });
  let called = false;
  await assert.rejects(runOwnedStartup(() => { called = true; }, () => {}), { code: 'UNSUPPORTED_OWNERSHIP' }); assert.equal(called, false);
});

test('existing identity exec ownership delegates once and returns original promise', async () => {
  const p = pair(), child = Object.assign(new EventEmitter(), { pid: 1234 });
  const value = { stdout: 'unchanged' }, promise = Object.assign(Promise.resolve(value), { child });
  let calls = 0;
  const exec = ownExistingExec(p.bridge, (...args) => { calls++; assert.deepEqual(args, ['existing', ['same'], { timeout: 5000, maxBuffer: 4096 }]); return promise; });
  assert.equal(p.bridge.run(() => exec('existing', ['same'], { timeout: 5000, maxBuffer: 4096 })), promise);
  assert.equal(await promise, value); child.emit('close', 0, null); p.bridge.finalize();
  assert.equal(calls, 1); assert.equal(p.witness.seal({ runtime: 'fixed-synthetic-node', directClosed: true }).knownResourcesClosed, true);
});

test('selected setup and child transforms pin original module IDs; untouched callbacks/config limits', async () => {
  const output = join(root, 'prepared-' + randomUUID()), manifest = prepareSelected(output);
  assert.equal(manifest.workers, 2); assert.equal(manifest.originalCallbacksExecuted, false);
  for (const path of [...manifest.capsules, manifest.identity.capsulePath, ...manifest.startup.capsules]) {
    const capsule = JSON.parse(readFileSync(path));
    for (const [file, hash] of Object.entries(capsule.sourcePins)) assert.equal(sha(readFileSync(file)), hash, 'Raw checkout bytes must match their separate pin');
  }
  assert.equal(manifest.identity.executionSupported, false); assert.equal(manifest.startup.executionSupported, false);
  const startup = readFileSync(manifest.startup.entry, 'utf8');
  assert.ok(startup.indexOf("requireRuntime('chromium')") < startup.indexOf('await build('));
  assert.ok(startup.includes('page.setDefaultTimeout(10000)')); assert.ok(!startup.includes('await checkPolish('));
  for (const file of manifest.files) { assert.equal(sha(readFileSync(file.path)), file.hash); assert.ok(readFileSync(file.path, 'utf8').includes('return bridge.run(originalCallback)')); }
  const original = readFileSync('test/setup.ts', 'utf8'), transformed = retainSetup(original);
  assert.ok(transformed.includes('afterAll(() => retainDiagnosticHome(home));'));
  assert.equal(setupPlugin(process.cwd(), sourceDigest(original)).transform(original, resolve('test/setup.ts')).code, transformed);
  const processSource = readFileSync('server/supervision-process.ts', 'utf8'), childSource = readFileSync('test/supervision-child.ts', 'utf8');
  const plugin = identityPlugin({ root: process.cwd(), capsulePath: 'not-executed.json', processHash: sourceDigest(processSource), childHash: sourceDigest(childSource) });
  assert.equal(plugin.transform(processSource, resolve('elsewhere/supervision-process.ts')), undefined);
  assert.ok(plugin.transform(processSource, resolve('server/supervision-process.ts')).code.includes('ownExistingExec(bridge, promisify(execFile))'));
  assert.ok(plugin.transform(childSource, resolve('test/supervision-child.ts')).code.includes('void bridge.run(main).catch'));
  assert.throws(() => plugin.transform(processSource + '\n', resolve('server/supervision-process.ts')), /hash changed/);
  const lf = processSource.replaceAll('\r\n', '\n'), crlf = lf.replaceAll('\n', '\r\n');
  assert.equal(sourceDigest(lf), sourceDigest(crlf));
  assert.ok(plugin.transform(crlf, resolve('server/supervision-process.ts')).code.endsWith(crlf.replace('const exec = promisify(execFile);',
    'const exec = observeExistingExec(bridge.session, ownExistingExec(bridge, promisify(execFile)));')));
});

test('original-module identity plugin bundles a tiny synthetic source through supported rolldown API without execution', async () => {
  const fixture = join(root, 'bundle-' + randomUUID()); mkdirSync(join(fixture, 'server'), { recursive: true }); mkdirSync(join(fixture, 'test'));
  const processSource = `import {execFile} from 'node:child_process'; import {promisify} from 'node:util';\nconst exec = promisify(execFile);\nexport const unused = exec;\n`;
  const childSource = `import {unused} from '../server/supervision-process';\nasync function main(){return unused;}\nvoid main().catch(()=>{});\n`;
  writeFileSync(join(fixture, 'server/supervision-process.ts'), processSource); writeFileSync(join(fixture, 'test/supervision-child.ts'), childSource);
  const { rolldown } = await import('rolldown');
  const build = await rolldown({ input: join(fixture, 'test/supervision-child.ts'), platform: 'node', plugins: [identityPlugin({ root: fixture,
    capsulePath: join(fixture, 'not-executed.json'), processHash: sha(processSource), childHash: sha(childSource) })] });
  try {
    const result = await build.generate({ format: 'cjs' });
    assert.ok(result.output[0].code.includes('UNSUPPORTED_OWNERSHIP')); assert.ok(result.output[0].code.includes('sharedIdentityCase'));
    writeFileSync(join(fixture, 'synthetic-build.cjs'), result.output[0].code);
  } finally { await build.close(); }
});

test('retained setup refuses cleanup outside its owned root and preserves the original isolated home', async () => {
  const home = join(root, randomUUID()), path = join(root, randomUUID() + '.jsonl'); mkdirSync(home);
  const before = [process.env.FIRSTMATE_DIAGNOSTIC_HOME_ROOT, process.env.FIRSTMATE_DIAGNOSTIC_RETENTION];
  process.env.FIRSTMATE_DIAGNOSTIC_HOME_ROOT = root; process.env.FIRSTMATE_DIAGNOSTIC_RETENTION = path;
  try { await retainDiagnosticHome(home); assert.ok(existsSync(home)); assert.throws(() => retainDiagnosticHome(resolve(root, '..')), /Unbound/); }
  finally {
    for (const [index, key] of ['FIRSTMATE_DIAGNOSTIC_HOME_ROOT', 'FIRSTMATE_DIAGNOSTIC_RETENTION'].entries()) {
      if (before[index] === undefined) delete process.env[key]; else process.env[key] = before[index];
    }
  }
});

test('startup wiring uses fresh cases, trace before page/context close and original failure without a real browser', async () => {
  for (const failed of [false, true]) {
    const slots = [], order = [], originalError = Error('original fake action failure');
    const pageAt = async (_query, _width, prepare) => {
      const context = Object.assign(new EventEmitter(), { tracing: { start: async () => order.push('trace-start'), stop: async () => order.push('trace-stop') },
        close: async () => { order.push('context-close'); context.emit('close'); } });
      const page = Object.assign(new EventEmitter(), { context: () => context, exposeBinding: async () => {}, addInitScript: async () => {},
        close: async () => { order.push('page-close'); page.emit('close'); return 'native-close'; } });
      await prepare(page); return page;
    };
    const createSlot = () => { const p = pair(); const slot = { ...p, output: root }; slots.push(slot); return slot; };
    const check = async pageAt => {
      for (let index = 0; index < 2; index++) { const page = await pageAt('deck', 1440, async () => {});
        try { if (failed && index === 1) throw originalError; } finally { assert.equal(await page.close(), 'native-close'); } }
      return 'original-helper-result';
    };
    const result = startupCore(pageAt, createSlot, check);
    if (failed) await assert.rejects(result, error => error === originalError); else assert.equal(await result, 'original-helper-result');
    assert.equal(slots.length, 2); assert.notEqual(slots[0].bridge.session.identity.caseId, slots[1].bridge.session.identity.caseId);
    for (const slot of slots) { assert.equal(slot.frames.at(-1).kind, 'case-final'); assert.equal(slot.frames.at(-1).data.observer.disposed, true); assert.equal(slot.contextClosed, true); }
    assert.ok(order.indexOf('trace-stop') < order.indexOf('page-close')); assert.ok(order.indexOf('page-close') < order.indexOf('context-close'));
  }
});
