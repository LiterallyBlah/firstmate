/** Explicit, one-shot test-only capability command. Never imported by product code. */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { release } from 'node:os';
import assert from 'node:assert/strict';
import { sealOwnerCapture } from './admission.mjs';
import { recorder } from './capture.mjs';
const mode = process.argv[2], root = resolve('.local/owner-capability');
throw Object.assign(Error('OWNER_CAPTURE_REVIEW_HOLD: static preparation only; previous closure unresolved'), { code: 'OWNER_CAPTURE_REVIEW_HOLD' });
assert.ok(['preflight', 'normal', 'blocked'].includes(mode), 'Select only preflight, normal or blocked');
assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64');
assert.equal(createHash('sha256').update(readFileSync('docs/scoped-supervision/observer-wiring/protocol.mjs')).digest('hex'),
  '0af200f0cc6eff8ac333600eef21e3f527764ea7262cc508b869c82102f4d181', 'Accepted witness is immutable');
const sourceDirectory = fileURLToPath(new URL('.', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const files = readdirSync(sourceDirectory).filter(name => /\.(?:cs|mjs|ps1)$/.test(name));
const sourceHashes = Object.fromEntries(files.map(name => [name, sha(readFileSync(join(sourceDirectory, name)))]));
const load = file => JSON.parse(readFileSync(file, 'utf8'));
if (mode !== 'preflight') {
  const preflight = load(join(root, 'atomic-preflight/native-receipt.json'));
  assert.equal(preflight.available, true); assert.equal(preflight.targetCreated, false);
  const command = load(join(root, 'atomic-preflight/command.json'));
  assert.equal(command.status, 0); assert.deepEqual(command.sourceHashes, sourceHashes, 'Preflight must bind exact owner/fixture code');
  const controls = load(join(root, 'admission-controls.json'));
  assert.equal(controls.status, 0); assert.equal(controls.failed, 0);
  assert.equal(controls.sourceHashes['admission.mjs'], sourceHashes['admission.mjs']);
  assert.equal(controls.sourceHashes['admission.controls.mjs'], sourceHashes['admission.controls.mjs']);
}
if (mode === 'blocked') assert.equal(load(join(root, 'normal/capture.json')).safeForReuse, true, 'Normal owner qualification must pass first');
const directory = join(root, mode === 'preflight' ? 'atomic-preflight' : mode);
mkdirSync(directory); // existence is the persistent one-attempt budget guard; never remove on failure
mkdirSync(join(directory, 'source'));
for (const file of files) copyFileSync(join(sourceDirectory, file), join(directory, 'source', file));
const save = (name, value) => writeFileSync(join(directory, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const configuration = { caseId: randomUUID(), nonce: randomUUID(), scenario: mode, directory,
  childEntry: join(sourceDirectory, 'child.mjs'), nodePath: process.execPath, nodeVersion: process.version };
const configPath = join(directory, 'configuration.json'); save('configuration.json', configuration);
const command = ['-NoProfile', '-NonInteractive', '-File', join(sourceDirectory, 'invoke.ps1'), '-Mode', mode,
  '-OutputDirectory', directory, '-NodePath', process.execPath, '-Configuration', configPath];
const helper = spawn('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', command, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const journal = recorder(), buffers = { stdout: '', stderr: '' }, losses = { stdout: 0, stderr: 0 };
const outputErrors = { stdout: 0, stderr: 0 };
const started = performance.now(); let deadlineFired = false, closed = false, status = null, signal = null, error = null;
const note = (kind, data) => journal.note(kind, { atMs: performance.now() - started, ...data });
note('helper-created', { pid: helper.pid });
for (const key of ['stdout', 'stderr']) helper[key].on('data', value => {
  const text = value.toString('utf8'), room = Math.max(0, 65536 - buffers[key].length);
  buffers[key] += text.slice(0, room); losses[key] += Math.max(0, text.length - room);
});
for (const key of ['stdout', 'stderr']) helper[key].on('error', caught => { outputErrors[key]++; note('helper-output-error', { stream: key, error: String(caught.message).slice(0, 300) }); });
await new Promise(resolveDone => {
  let grace;
  const timer = setTimeout(() => {
    deadlineFired = true; note('outer-deadline', { helperPid: helper.pid });
    const returned = helper.kill(); note('kill-only-owned-helper', { returned });
    grace = setTimeout(() => { note('helper-close-unconfirmed', {}); helper.unref(); helper.stdout.unref?.(); helper.stderr.unref?.(); resolveDone(); }, 3000);
  }, 15000);
  helper.once('error', caught => { error = caught.message; note('helper-error', { message: error }); });
  helper.once('close', (code, why) => { closed = true; status = code; signal = why; note('helper-closed', { code, signal: why }); clearTimeout(timer); clearTimeout(grace); resolveDone(); });
});
save('stdout', buffers.stdout); save('stderr', buffers.stderr);
const outer = { closed, status, signal, error, deadlineFired, outputLoss: losses, outputErrors, observation: journal.snapshot() };
save('command.json', { command, sourceHashes, node: process.version, nodeBinarySha256: sha(readFileSync(process.execPath)), platform: process.platform,
  architecture: process.arch, windowsRelease: release(), status, signal, error, ...outer });
const nativePath = join(directory, 'native-receipt.json');
if (mode === 'preflight') {
  assert.equal(closed, true); assert.equal(status, 0, buffers.stderr); assert.equal(load(nativePath).available, true);
  console.log(JSON.stringify({ mode, directory, available: true, targetCreated: false }));
} else {
  const optional = file => existsSync(join(directory, file)) ? load(join(directory, file)) : null;
  const capture = sealOwnerCapture({ ...configuration, sourceHashes, outer, native: existsSync(nativePath) ? load(nativePath) : null,
    rootEntry: optional('root-entry.json'), childEntry: optional('child-entry.json'), rootResult: optional('root-result.json'), childResult: optional('child-result.json'),
    childOutput: optional('child-output.json'),
    rootDelayedSignal: existsSync(join(directory, 'root-delayed-signal.json')), childDelayedSignal: existsSync(join(directory, 'child-delayed-signal.json')) });
  if (Object.values(losses).some(value => value > 0)) { capture.problems.push('outer-output-truncated'); capture.safeForReuse = false; }
  save('capture.json', capture);
  console.log(JSON.stringify({ mode, directory, safeForReuse: capture.safeForReuse, problems: capture.problems, root: capture.native?.root?.pid,
    child: capture.native?.child?.pid, finalMembers: capture.native?.finalMembers }));
  if (!capture.safeForReuse) process.exitCode = 2;
}
