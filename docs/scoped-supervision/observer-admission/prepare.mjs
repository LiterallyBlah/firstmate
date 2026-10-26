/** Preparation ONLY: emits source-bound candidates, never executes qualification. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, relative, join } from 'node:path';
import { targets, literalCallback, sha256 } from './adapters.mjs';

const base = '9234f208e97fd0b1643593bc37faa3f5b525ffdb';
const output = resolve('.local/observer-admission/prepared');
mkdirSync(output, { recursive: true });
const source = path => execFileSync('git', ['show', `${base}:${path}`], { maxBuffer: 8 * 1024 * 1024 }).toString();
const observer = '../../../docs/scoped-supervision/observer-admission/';
const records = [];
for (const target of targets) {
  const original = source(target.path), literal = literalCallback(original, target);
  let header = original.slice(0, original.indexOf('\ndescribe('))
    .replaceAll('from "../', 'from "../../../')
    .replaceAll('from "./', 'from "../../../server/');
  const name = target.path.includes('events') ? 'triage' : 'inbox';
  if (name === 'inbox') header = header.replace('describe, expect, it }', 'describe, expect, it, vi }');
  // The body is byte-identical. Only imports and the surrounding observer shell differ.
  const candidate = `// @ts-nocheck -- PREPARED ONLY; never included by default Vitest config.
${header}
${name === 'triage' ? "import { SupervisionInbox } from '../../../server/supervision-inbox';" : "import { SupervisionEvents } from '../../../server/supervision-events';"}
const { session, filesystemPhases, installMailboxPhases } = await vi.hoisted(async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { createSession } = await import('${observer}session.mjs');
  const adapters = await import('${observer}adapters.mjs');
  let directory;
  const session = createSession({ name: ${JSON.stringify(name)}, sink: receipt => {
    directory ??= '.local/observer-admission/cases/' + receipt.caseId;
    mkdirSync(directory, { recursive: true });
    writeFileSync(directory + '/' + receipt.label + '.json', JSON.stringify(receipt));
  } });
  return { session, ...adapters };
});
vi.mock('node:fs/promises', async importOriginal => filesystemPhases(session, await importOriginal()));
const originalCallback = async () => ${literal.body};
it(${JSON.stringify(target.title)}, context => {
  installMailboxPhases(session, { SupervisionStore, SupervisionEvents, SupervisionInbox });
  const deadline = () => { session.note('cooperative-signal', 'Not an exact native stall timestamp'); session.flush('deadline'); };
  context.signal.addEventListener('abort', deadline, { once: true });
  context.onTestFinished(() => {
    session.flush('finish-before-dispose'); session.dispose();
    context.signal.removeEventListener('abort', deadline);
  });
  return session.run(() => { session.flush('entry'); return originalCallback(); });
});
`;
  const path = join(output, `${name}.candidate.ts.txt`);
  writeFileSync(path, candidate);
  records.push({ ...target, sourceSha256: sha256(original), bodySha256: literal.sha256, timeoutMs: 5000,
    candidate: relative(process.cwd(), path).replaceAll('\\', '/'), candidateSha256: sha256(candidate), executed: false });
}
// Exact source overlays for a future CHILD-ONLY build. No product file is edited.
const processSource = source('server/supervision-process.ts');
const seam = 'const exec = promisify(execFile);';
if (processSource.split(seam).length !== 2) throw Error('Process seam changed');
const runtimePath = JSON.stringify(resolve('docs/scoped-supervision/observer-admission/identity-runtime.mjs').replaceAll('\\', '/'));
const adaptersPath = JSON.stringify(resolve('docs/scoped-supervision/observer-admission/adapters.mjs').replaceAll('\\', '/'));
const observedProcess = `import { identitySession } from ${runtimePath};\nimport { observeExistingExec } from ${adaptersPath};\n` +
  processSource.replace(seam, 'const exec = observeExistingExec(identitySession, promisify(execFile));');
writeFileSync(join(output, 'supervision-process.candidate.ts.txt'), observedProcess);
const childSource = source('test/supervision-child.ts'), childSeam = 'void main().catch';
if (childSource.split(childSeam).length !== 2) throw Error('Child entry seam changed');
const observedChild = `import { identitySession } from ${runtimePath};\n` +
  childSource.replace(childSeam, 'void identitySession.run(main).catch');
writeFileSync(join(output, 'supervision-child.candidate.ts.txt'), observedChild);
records.push({ path: 'server/supervision-process.ts', sourceSha256: sha256(processSource), candidateSha256: sha256(observedProcess), executed: false },
  { path: 'test/supervision-child.ts', sourceSha256: sha256(childSource), candidateSha256: sha256(observedChild), executed: false });
const manifest = { base, preparationOnly: true, records,
  defaults: { callbackTimeoutMs: 5000, browserActionTimeoutMs: 10000, heldPressDelayMs: 1500, workers: 2 },
  childBuildRequirement: 'Overlay transform at ORIGINAL module IDs, with source-bound absolute observer imports; never compile these text files as relocated modules.',
  remainingAdmission: 'Review candidates plus runner ownership/termination wiring before executing any real case.' };
writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest));
