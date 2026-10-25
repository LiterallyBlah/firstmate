// Strictly synthetic local root; only one fixed descendant, no network or product imports.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { threadId, isMainThread } from 'node:worker_threads';
const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const save = (name, value) => { const file = join(config.directory, name); writeFileSync(file + '.partial', JSON.stringify(value)); renameSync(file + '.partial', file); };
const child = spawn(process.execPath, [config.childEntry, process.argv[2]], { stdio: 'ignore', windowsHide: true, shell: false });
child.once('error', error => { save('root-error.json', { message: error.message }); process.exitCode = 1; });
save('root-entry.json', { caseId: config.caseId, scenario: config.scenario, nonce: config.nonce, pid: process.pid, ppid: process.ppid,
  childPid: child.pid, instance: randomUUID(), node: process.version, threadId, isMainThread });
if (config.scenario === 'blocked') {
  setTimeout(() => save('root-delayed-signal.json', { fired: true }), 50);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
} else child.once('close', (code, signal) => { save('root-result.json', { childCode: code, childSignal: signal }); process.exitCode = code === 0 && signal === null ? 0 : 1; });
