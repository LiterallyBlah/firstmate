/** No command runs an original qualification. Preflight refuses unsupported ownership. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { prepareSelected } from './selected.mjs';
import { RUNTIME_SUPPORT, requireRuntime } from './runtime.mjs';
import { runSynthetic } from './runner.mjs';
const command = process.argv[2], root = resolve('.local/observer-wiring');
if (command === 'prepare') {
  const output = join(root, 'prepared', randomUUID());
  console.log(JSON.stringify({ output, ...prepareSelected(output) }));
} else if (command === 'preflight') {
  const path = join(root, 'preflight', randomUUID()); mkdirSync(path, { recursive: true });
  const name = process.argv[3];
  let result;
  try { requireRuntime(name); result = { runtime: name, supported: true }; }
  catch (error) { result = { runtime: name, supported: false, reason: error.message, code: error.code, retainFixture: true }; process.exitCode = 2; }
  writeFileSync(join(path, 'receipt.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ path, ...result }));
} else if (command === 'synthetic') {
  const result = await runSynthetic({ root: join(root, 'synthetic-cli'), scenario: process.argv[3] ?? 'fulfilled' });
  console.log(JSON.stringify({ directory: result.directory, captureAdmissible: result.captureAdmissible, safeForReuse: result.safeForReuse }));
} else if (command === 'support') console.log(JSON.stringify(RUNTIME_SUPPORT));
else throw Error('Expected prepare, preflight <runtime>, synthetic <scenario>, or support; no real-run command is installed');
