// Strictly synthetic local root; only one fixed descendant, no network or product imports.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { threadId, isMainThread } from 'node:worker_threads';
import { observeOutput } from './capture.mjs';
const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const save = (name, value) => { const file = join(config.directory, name); writeFileSync(file + '.partial', JSON.stringify(value)); renameSync(file + '.partial', file); };
const instance = randomUUID();
const marker = { format: 'firstmate.root-pre-spawn/1', stage: 'before-child-spawn', caseId: config.caseId, scenario: config.scenario,
  nonce: config.nonce, pid: process.pid, ppid: process.ppid, instance, node: process.version, threadId, isMainThread, childEntry: config.childEntry };
if (Buffer.byteLength(JSON.stringify(marker), 'utf8') > 4096) throw Error('Pre-spawn marker exceeds 4096 bytes');
save('root-pre-spawn.json', marker);
const child = spawn(process.execPath, [config.childEntry, process.argv[2]], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false });
const childStdout = observeOutput(child.stdout), childStderr = observeOutput(child.stderr);
child.once('close', () => {
  try { save('child-output.json', { stdout: childStdout.snapshot(), stderr: childStderr.snapshot() }); }
  catch { try { save('child-output-error.json', { incomplete: true }); } catch {} }
}); // blocked root may never run this; missing child drain remains unknown, never inferred from root output
child.once('error', error => { save('root-error.json', { message: error.message }); process.exitCode = 1; });
save('root-entry.json', { caseId: config.caseId, scenario: config.scenario, nonce: config.nonce, pid: process.pid, ppid: process.ppid,
  childPid: child.pid, instance, node: process.version, threadId, isMainThread });
if (config.scenario === 'blocked') {
  setTimeout(() => save('root-delayed-signal.json', { fired: true }), 50);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
} else child.once('close', (code, signal) => { save('root-result.json', { childCode: code, childSignal: signal }); process.exitCode = code === 0 && signal === null ? 0 : 1; });
