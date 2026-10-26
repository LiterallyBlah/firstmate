/** Read-only verification plus a new local receipt; no diagnostic execution. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, literalCallback, targets } from './adapters.mjs';
const base = '9234f208e97fd0b1643593bc37faa3f5b525ffdb', directory = 'docs/scoped-supervision/observer-admission/';
const local = '.local/observer-admission/';
const git = args => execFileSync('git', args, { maxBuffer: 16 * 1024 * 1024 }).toString().trim();
assert.equal(git(['branch', '--show-current']), 'fm/fm-ss-s02');
const files = {};
function retain(path) { files[path] = sha256(readFileSync(path)); }
for (const name of readdirSync(directory)) retain(directory + name);
const control = JSON.parse(readFileSync(local + 'control-run.json'));
assert.equal(control.status, 0); assert.equal(control.signal, null); assert.equal(control.error, null);
for (const [path, hash] of Object.entries(control.sources)) assert.equal(files[path], hash, `Executed observer changed: ${path}`);
const log = readFileSync(local + 'controls-final.log', 'utf8');
assert.match(log, /# tests 10\b/); assert.match(log, /# pass 10\b/); assert.match(log, /# fail 0\b/); assert.match(log, /# cancelled 0\b/);
assert.equal(readFileSync(local + 'controls-final.stderr', 'utf8'), '');
const changes = git(['diff', '--name-status', base]).split('\n').filter(Boolean);
assert.ok(changes.every(line => line.startsWith('A\t' + directory)), `Existing source changed: ${changes}`);
const originalBlobs = git(['ls-tree', '-r', '--name-only', base]).split('\n').length;
const callbacks = [];
for (const target of targets) {
  const original = execFileSync('git', ['show', `${base}:${target.path}`]).toString();
  const literal = literalCallback(original, target), name = target.path.includes('events') ? 'triage' : 'inbox';
  assert.equal(sha256(readFileSync(target.path)), sha256(original), 'Original source bytes changed');
  const prepared = readFileSync(`${local}prepared/${name}.candidate.ts.txt`, 'utf8');
  assert.ok(prepared.includes(`const originalCallback = async () => ${literal.body};`));
  callbacks.push({ ...target, bodySha256: literal.sha256, assertions: literal.body.split('\n').filter(line => line.includes('expect(')), executed: false });
}
const processSource = execFileSync('git', ['show', `${base}:server/supervision-process.ts`]).toString();
assert.equal(readFileSync(local + 'prepared/supervision-process.candidate.ts.txt', 'utf8').split('\n').slice(2).join('\n')
  .replace('const exec = observeExistingExec(identitySession, promisify(execFile));', 'const exec = promisify(execFile);'), processSource);
const childSource = execFileSync('git', ['show', `${base}:test/supervision-child.ts`]).toString();
assert.equal(readFileSync(local + 'prepared/supervision-child.candidate.ts.txt', 'utf8').split('\n').slice(1).join('\n')
  .replace('void identitySession.run(main).catch', 'void main().catch'), childSource);
const oldManifest = '.local/s02-triage/handoff-artifacts.json';
const prior = JSON.parse(readFileSync(oldManifest));
for (const [path, hash] of Object.entries(prior.files)) { assert.equal(sha256(readFileSync(path)), hash, `Prior evidence changed: ${path}`); retain(path); }
retain(oldManifest);
const review = 'C:/Users/micha/.paseo/plugin-data/firstmate/home/data/fm-ss-r02-triage/report.md'; retain(review);
for (const name of ['controls-attempt-1.log', 'typecheck-attempt-1.log', 'control-run.json', 'controls-final.log', 'controls-final.stderr', 'preparation.log', 'run-controls.mjs']) retain(local + name);
for (const name of readdirSync(local + 'prepared')) retain(join(local, 'prepared', name).replaceAll('\\', '/'));
assert.equal(readFileSync(local + 'typecheck-attempt-1.log', 'utf8'), '');
const receipt = { base, head: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']), timestamp: new Date().toISOString(),
  scope: 'LOCAL test-observer admission only', originalBlobsUnchanged: originalBlobs, callbacks,
  synthetic: { tests: 10, passed: 10, failed: 0, node: control.node, platform: control.platform, sourceBound: true },
  typecheck: { status: 0, log: local + 'typecheck-attempt-1.log', unchangedTypeScriptSources: true },
  qualificationExecuted: false, fullSuiteExecuted: false, browserExecuted: false, realIdentityProbeExecuted: false, published: false,
  priorArtifactsUnchanged: Object.keys(prior.files).length, files };
const output = local + 'sealed-receipt.json';
writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ output, sha256: sha256(readFileSync(output)), originalBlobsUnchanged: originalBlobs, tests: 10, passed: 10, sourceBound: true, published: false }));
