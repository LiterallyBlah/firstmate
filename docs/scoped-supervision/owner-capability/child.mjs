// Fixed synthetic descendant. It never launches other work.
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { threadId, isMainThread } from 'node:worker_threads';
const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const save = (name, value) => { const file = join(config.directory, name); writeFileSync(file + '.partial', JSON.stringify(value)); renameSync(file + '.partial', file); };
save('child-entry.json', { caseId: config.caseId, scenario: config.scenario, nonce: config.nonce, pid: process.pid, ppid: process.ppid,
  instance: randomUUID(), node: process.version, threadId, isMainThread });
if (config.scenario === 'blocked') {
  setTimeout(() => save('child-delayed-signal.json', { fired: true }), 50);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
} else {
  const poll = setInterval(() => { if (existsSync(join(config.directory, 'release'))) { clearInterval(poll); save('child-result.json', { fulfilled: true }); } }, 10);
}
