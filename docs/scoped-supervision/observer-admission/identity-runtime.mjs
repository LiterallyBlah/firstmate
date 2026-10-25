/** CHILD-ONLY candidate runtime. Not imported by product code or any shipped entry. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { createSession } from './session.mjs';
const root = resolve('.local/observer-admission/identity');
export const identitySession = createSession({ name: 'existing-child-identity', sink(receipt) {
  const directory = resolve(root, receipt.caseId);
  if (!directory.startsWith(root + sep)) throw Error('Observer path escaped root');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${receipt.label}.json`), JSON.stringify(receipt));
} });
// Synchronous best-effort retained evidence; sink errors never change exit code/stderr.
process.once('exit', () => { identitySession.flush('child-exit'); identitySession.dispose(); });
