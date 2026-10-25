import { fork } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createWitness, sha } from './protocol.mjs';
import { requireRuntime } from './runtime.mjs';

const entry = fileURLToPath(new URL('./synthetic-worker.mjs', import.meta.url));
const scenarios = ['fulfilled', 'rejected', 'blocked', 'nonsettling', 'missing-entry', 'missing-final', 'sink-failure', 'restoration-conflict', 'truncated'];
export async function runSynthetic({ root, scenario, deadlineMs = 40, graceMs = 150, startupMs = 2000, closeMs = 1000, launch = fork }) {
  requireRuntime('fixed-synthetic-node');
  if (!scenarios.includes(scenario)) throw Error('Unknown fixed synthetic scenario');
  const directory = resolve(root, randomUUID()), homes = join(directory, 'homes'), home = join(homes, 'owned');
  mkdirSync(home, { recursive: true });
  const external = join(directory, 'external.jsonl'), configFile = join(directory, 'worker.json');
  writeFileSync(external, '', { flag: 'wx' });
  const capsule = { slotId: randomUUID(), name: scenario, sourceHead: 'd3b099587759d132761edd10ea8ca377fd608b2a',
    sourceHash: sha(readFileSync(entry)), bodyHash: sha(readFileSync(entry)), observerHashes: Object.fromEntries(['protocol.mjs', 'runner.mjs', 'runtime.mjs', '../observer-admission/session.mjs'].map(name =>
      [name, sha(readFileSync(new URL(name, import.meta.url)))])), ownedHomeRoot: homes, callbackLimitMs: deadlineMs };
  writeFileSync(configFile, JSON.stringify({ scenario, capsule, home, external, trace: join(directory, 'trace.json') }));
  const evidence = []; let child, closed = false, entryAt, timer, killAt, abortSent = false, done = false;
  const witness = createWitness({ capsule, homeRoot: homes, expectedPid: () => child?.pid });
  const start = performance.now();
  const note = (kind, data = {}) => { if (evidence.length < 32) evidence.push({ kind, parentAtMs: performance.now(), ...data }); };
  return await new Promise(resolveResult => {
    const finish = () => {
      if (done) return; done = true; clearInterval(timer); witness.read(external);
      const result = witness.seal({ runtime: 'fixed-synthetic-node', directClosed: closed, terminationRequested: killAt !== undefined, closureEvidence: evidence });
      writeFileSync(join(directory, 'parent-receipt.json'), JSON.stringify(result, null, 2));
      resolveResult({ directory, ...result });
    };
    child = launch(entry, [configFile], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { ...process.env, PASEO_HOME: home, FIRSTMATE_RECEIPT_JOURNAL: '0', FIRSTMATE_ATTENTION_OBSERVE: '0', FIRSTMATE_NEEDS_YOU: '0' } });
    note('owned-child-created', { pid: child.pid ?? null });
    child.once('error', error => note('child-error', { message: error.message.slice(0, 300) }));
    child.once('close', (code, signal) => { closed = true; note('child-close', { code, signal }); finish(); });
    timer = setInterval(() => {
      witness.read(external);
      const now = performance.now();
      if (witness.hasEntry() && entryAt === undefined) entryAt = now;
      if (!abortSent && entryAt !== undefined && now - entryAt >= deadlineMs) {
        abortSent = true; note('external-deadline');
        try { child.send('diagnostic-abort', error => { if (error) note('abort-send-error', { message: error.message }); }); }
        catch (error) { note('abort-send-error', { message: error.message }); }
      }
      if (killAt === undefined && ((entryAt === undefined && now - start >= startupMs) || (entryAt !== undefined && now - entryAt >= deadlineMs + graceMs))) {
        killAt = now; note('termination-request');
        try { note('kill-returned', { value: child.kill('SIGKILL') }); } catch (error) { note('kill-error', { message: error.message }); }
      }
      if (killAt !== undefined && now - killAt >= closeMs) {
        note('termination-unconfirmed');
        try { if (child.connected) child.disconnect(); child.unref(); } catch { /* No confirmed close => admission remains blocked. */ }
        finish();
      }
    }, 10);
  });
}
