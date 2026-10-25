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
// Distinct root-only gate: no child call is reachable. The owner terminates after the marker.
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
