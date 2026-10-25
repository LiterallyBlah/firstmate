import { readFileSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { createCase, fileSender, sha } from './protocol.mjs';
import { requireRuntime } from './runtime.mjs';

export function openSelectedCase(capsulePath) {
  const capsule = JSON.parse(readFileSync(capsulePath, 'utf8'));
  if (!['vitest-forks', 'powershell-exec', 'chromium'].includes(capsule.runtime)) throw Object.assign(Error('Selected case requires its real runtime ownership gate'), { code: 'UNSUPPORTED_OWNERSHIP' });
  requireRuntime(capsule.runtime); // no environment switch/override for unsupported ownership
  for (const [path, hash] of Object.entries(capsule.sourcePins)) {
    if (sha(readFileSync(path)) !== hash) throw Error(`Source pin changed: ${path}`);
  }
  const home = process.env.PASEO_HOME;
  const rel = home && relative(capsule.ownedHomeRoot, home);
  if (!home || !isAbsolute(home) || !rel || rel.startsWith('..') || isAbsolute(rel)) throw Error('Missing confined isolated home');
  const output = join(capsule.output, 'trace'); mkdirSync(output, { recursive: true });
  return createCase({ capsule, home, send: fileSender(capsule.external), sink: receipt => {
    writeFileSync(join(output, receipt.label + '.json'), JSON.stringify(receipt));
  } });
}
export function ownExistingExec(bridge, exec) {
  return function (...args) {
    const result = Reflect.apply(exec, this, args);
    try { bridge.registerChild(result.child, 'existing-identity-exec'); }
    catch (error) { bridge.session.observerError(error); }
    return result;
  };
}
export function retainDiagnosticHome(home) {
  const root = process.env.FIRSTMATE_DIAGNOSTIC_HOME_ROOT, output = process.env.FIRSTMATE_DIAGNOSTIC_RETENTION;
  const rel = root && relative(resolve(root), resolve(home));
  if (!root || !output || !isAbsolute(root) || !isAbsolute(home) || !rel || rel.startsWith('..') || isAbsolute(rel)) throw Error('Unbound diagnostic cleanup');
  appendFileSync(output, JSON.stringify({ home, decision: 'retain', reason: 'No cleanup/reuse before independent closure admission',
    requestedOptions: { recursive: true, force: true } }) + '\n');
  return Promise.resolve(); // the deliberate fixture-retention seam; never deletes even on success
}
