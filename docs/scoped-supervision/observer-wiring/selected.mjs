/** Dedicated source-bound diagnostics. Preparation/build only; real runtimes remain gated. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { targets, literalCallback } from '../observer-admission/adapters.mjs';
import { sha } from './protocol.mjs';
const sourceHead = 'd3b099587759d132761edd10ea8ca377fd608b2a';
const here = fileURLToPath(new URL('.', import.meta.url));
const modulePath = name => resolve(here, name).replaceAll('\\', '/');
const quote = name => JSON.stringify(modulePath(name));
const frozen = path => execFileSync('git', ['show', `${sourceHead}:${path}`]).toString();
// Git source identity and physical checkout bytes are different, explicit pins.
export const sourceDigest = code => sha(code.replaceAll('\r\n', '\n'));
function originalPin(root, path) {
  const bytes = readFileSync(resolve(root, path));
  if (sourceDigest(bytes.toString()) !== sourceDigest(frozen(path))) throw Error('Original source content changed');
  return sha(bytes);
}
function replaceOnce(source, from, to) { if (source.split(from).length !== 2) throw Error('Pinned seam changed'); return source.replace(from, to); }

export function retainSetup(source) {
  return `import { retainDiagnosticHome } from ${quote('client.mjs')};\n` + replaceOnce(source,
    'afterAll(() => rm(home, { recursive: true, force: true }));', 'afterAll(() => retainDiagnosticHome(home));');
}
export function setupPlugin(root, expectedHash) {
  const target = resolve(root, 'test/setup.ts');
  return { name: 'firstmate-diagnostic-retained-home', transform(code, id) {
    if (resolve(id.split('?')[0]) !== target) return;
    if (sourceDigest(code) !== expectedHash) throw Error('Original setup hash changed');
    return { code: retainSetup(code), map: null };
  } };
}
export function identityPlugin({ root, capsulePath, processHash, childHash }) {
  const processPath = resolve(root, 'server/supervision-process.ts'), childPath = resolve(root, 'test/supervision-child.ts');
  const importBridge = `import { ownExistingExec } from ${quote('client.mjs')};\nimport { sharedIdentityCase } from ${quote('shared-identity.mjs')};\nimport { observeExistingExec } from ${quote('../observer-admission/adapters.mjs')};\nconst bridge = sharedIdentityCase(${JSON.stringify(capsulePath)});\n`;
  return { name: 'firstmate-child-only-identity-observer', transform(code, id) {
    const path = resolve(id.split('?')[0]);
    if (path === processPath) {
      if (sourceDigest(code) !== processHash) throw Error('Original process source hash changed');
      return { code: importBridge + replaceOnce(code, 'const exec = promisify(execFile);',
        'const exec = observeExistingExec(bridge.session, ownExistingExec(bridge, promisify(execFile)));'), map: null };
    }
    if (path === childPath) {
      if (sourceDigest(code) !== childHash) throw Error('Original child source hash changed');
      // The child and process module must share one bridge via the capsule-keyed runtime below.
      return { code: `import { sharedIdentityCase } from ${quote('shared-identity.mjs')};\nconst bridge = sharedIdentityCase(${JSON.stringify(capsulePath)});\nprocess.once('exit', () => bridge.finalize('child-exit'));\n` +
        replaceOnce(code, 'void main().catch', 'void bridge.run(main).catch'), map: null };
    }
  } };
}

export function prepareSelected(output, root = process.cwd()) {
  output = resolve(output); root = resolve(root); mkdirSync(output, { recursive: true });
  const observerNames = [...readdirSync(here).filter(name => name.endsWith('.mjs') && !name.endsWith('.controls.mjs')),
    '../observer-admission/session.mjs', '../observer-admission/adapters.mjs', '../observer-admission/browser.mjs'];
  const pins = Object.fromEntries(observerNames.map(name => [modulePath(name), sha(readFileSync(modulePath(name)))]));
  const manifest = { sourceHead, preparationOnly: true, workers: 2, originalCallbacksExecuted: false, files: [], capsules: [], identity: null, startup: null };
  for (const target of targets) {
    const source = frozen(target.path), literal = literalCallback(source, target), name = target.path.includes('events') ? 'triage' : 'inbox';
    if (sha(readFileSync(resolve(root, target.path))) !== sha(source)) throw Error('Current callback source differs from frozen source');
    const header = source.slice(0, source.indexOf('\ndescribe(')).replace(/from "(\.\.?\/[^\"]+)"/g, (_all, specifier) =>
      `from ${JSON.stringify(resolve(root, 'server', specifier).replaceAll('\\', '/'))}`).replace('describe, expect, it }', 'describe, expect, it, vi }');
    const directory = join(output, name); mkdirSync(join(directory, 'homes'), { recursive: true });
    const capsulePath = join(directory, 'capsule.json'), external = join(directory, 'external.jsonl'); writeFileSync(external, '', { flag: 'wx' });
    const capsule = { slotId: randomUUID(), name, runtime: 'vitest-forks', sourceHead, sourceHash: sha(source), bodyHash: literal.sha256,
      observerHashes: pins, sourcePins: { ...pins, [resolve(root, target.path)]: sha(source) }, ownedHomeRoot: join(directory, 'homes'), output: directory, external,
      callbackLimitMs: 5000 };
    writeFileSync(capsulePath, JSON.stringify(capsule, null, 2)); manifest.capsules.push(capsulePath);
    const candidate = `// @ts-nocheck -- dedicated diagnostic file, never default-suite included.
${header}
${name === 'triage' ? `import { SupervisionInbox } from ${JSON.stringify(resolve(root, 'server/supervision-inbox'))};` : `import { SupervisionEvents } from ${JSON.stringify(resolve(root, 'server/supervision-events'))};`}
import { openSelectedCase } from ${quote('client.mjs')};
const { state, filesystemPhases, installMailboxPhases } = await vi.hoisted(async () => {
  const adapters = await import(${quote('../observer-admission/adapters.mjs')});
  return { state: { current: null, fs: null, actual: null }, ...adapters };
});
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal(); state.actual = actual;
  return { ...actual, ...Object.fromEntries(['mkdir','readFile','readdir','stat','link','unlink','open'].map(name => [name,
    (...args) => state.current ? state.fs[name](...args) : Reflect.apply(actual[name], actual, args)])) };
});
const originalCallback = async () => ${literal.body};
it(${JSON.stringify(target.title)}, context => {
  const bridge = openSelectedCase(${JSON.stringify(capsulePath)});
  state.current = bridge; state.fs = filesystemPhases(bridge.session, state.actual);
  installMailboxPhases(bridge.session, { SupervisionStore, SupervisionEvents, SupervisionInbox });
  const signal = () => { bridge.session.note('cooperative-signal'); bridge.flush('deadline'); };
  context.signal.addEventListener('abort', signal, { once: true });
  context.onTestFinished(() => { bridge.finalize(); state.current = null; context.signal.removeEventListener('abort', signal); });
  return bridge.run(originalCallback);
});
`;
    const path = join(directory, `${name}.test.ts`); writeFileSync(path, candidate); manifest.files.push({ path, hash: sha(candidate), bodyHash: literal.sha256 });
  }
  const setupHash = sha(frozen('test/setup.ts'));
  const setupPath = join(output, 'selected-setup.mjs');
  const setupCases = Object.fromEntries(manifest.files.map((file, index) => [resolve(file.path).replaceAll('\\', '/'), manifest.capsules[index]]));
  const selectedSetup = `import {expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {requireRuntime} from ${quote('runtime.mjs')};
requireRuntime('vitest-forks');
const cases=${JSON.stringify(setupCases)};
const selected=cases[resolve(expect.getState().testPath).replaceAll('\\\\','/')];
if(!selected)throw Error('Unselected diagnostic file');
const capsule=JSON.parse(readFileSync(selected));
process.env.TMP=capsule.ownedHomeRoot;process.env.TEMP=capsule.ownedHomeRoot;process.env.TMPDIR=capsule.ownedHomeRoot;
process.env.FIRSTMATE_DIAGNOSTIC_HOME_ROOT=capsule.ownedHomeRoot;
process.env.FIRSTMATE_DIAGNOSTIC_RETENTION=capsule.output+'/retained-home.jsonl';
await import(${JSON.stringify(pathToFileURL(resolve(root, 'test/setup.ts')).href)});
`;
  writeFileSync(setupPath, selectedSetup);
  const config = `import {defineConfig} from 'vitest/config';
import {setupPlugin} from ${quote('selected.mjs')};
import {requireRuntime} from ${quote('runtime.mjs')};
requireRuntime('vitest-forks');
export default defineConfig({plugins:[setupPlugin(${JSON.stringify(root)},${JSON.stringify(setupHash)})],test:{
include:${JSON.stringify(manifest.files.map(file => file.path))},exclude:[],setupFiles:[${JSON.stringify(setupPath)}],maxWorkers:2,isolate:true,watch:false}});
`;
  writeFileSync(join(output, 'vitest.config.mjs'), config);
  const identityDirectory = join(output, 'identity'); mkdirSync(join(identityDirectory, 'homes'), { recursive: true });
  const processSource = frozen('server/supervision-process.ts'), childSource = frozen('test/supervision-child.ts');
  const identityCapsulePath = join(identityDirectory, 'capsule.json'), identityExternal = join(identityDirectory, 'external.jsonl');
  writeFileSync(identityExternal, '', { flag: 'wx' });
  const identityCapsule = { slotId: randomUUID(), name: 'existing-identity-child', runtime: 'powershell-exec', sourceHead,
    sourceHash: sha(processSource), bodyHash: sha(childSource), observerHashes: pins,
    sourcePins: { ...pins, [resolve(root, 'server/supervision-process.ts')]: originalPin(root, 'server/supervision-process.ts'), [resolve(root, 'test/supervision-child.ts')]: originalPin(root, 'test/supervision-child.ts') },
    ownedHomeRoot: join(identityDirectory, 'homes'), output: identityDirectory, external: identityExternal, subprocessLimitMs: 5000, maxBuffer: 4096 };
  writeFileSync(identityCapsulePath, JSON.stringify(identityCapsule, null, 2));
  const identityOptions = { root, capsulePath: identityCapsulePath, processHash: sha(processSource), childHash: sha(childSource) };
  const identityBuild = `import {rolldown} from 'rolldown';
import {identityPlugin} from ${JSON.stringify(pathToFileURL(modulePath('selected.mjs')).href)};
const build=await rolldown({input:${JSON.stringify(resolve(root, 'test/supervision-child.ts'))},platform:'node',plugins:[identityPlugin(${JSON.stringify(identityOptions)})]});
try{await build.write({file:${JSON.stringify(join(identityDirectory, 'child.cjs'))},format:'cjs'});}finally{await build.close();}
`;
  writeFileSync(join(identityDirectory, 'build.mjs'), identityBuild);
  manifest.identity = { directory: identityDirectory, capsulePath: identityCapsulePath, build: join(identityDirectory, 'build.mjs'),
    originalModuleIds: [resolve(root, 'server/supervision-process.ts'), resolve(root, 'test/supervision-child.ts')], executionSupported: false };

  // A selected startup harness retains the original bootstrap/pageAt and original helper.
  // Guard runs before the bootstrap creates its server/browser. No other render checks run.
  const render = frozen('docs/needs-you/render.mjs');
  const boundary = 'try {\n  const startup = await checkDeckStartup(pageAt);';
  if (render.split(boundary).length !== 2) throw Error('Original startup harness boundary changed');
  let prefix = render.slice(0, render.indexOf(boundary));
  prefix = prefix.replace(/from "(\.\/?[^\"]+)"/g, (_all, specifier) => `from ${JSON.stringify(pathToFileURL(resolve(root, 'docs/needs-you', specifier)).href)}`);
  prefix = replaceOnce(prefix, 'const here = dirname(fileURLToPath(import.meta.url)),\n  root = resolve(here, "../..");',
    `const here = ${JSON.stringify(resolve(root, 'docs/needs-you'))},\n  root = ${JSON.stringify(root)};`);
  const startupDirectory = join(output, 'startup'); mkdirSync(startupDirectory, { recursive: true });
  prefix = replaceOnce(prefix, 'const generated = join(here, ".generated");', `const generated = ${JSON.stringify(join(startupDirectory, '.generated'))};`);
  prefix = replaceOnce(prefix, 'output = join(root, ".local/needs-you-drawer");', `output = ${JSON.stringify(startupDirectory)};`);
  const startupCapsules = [];
  for (const name of ['delayed', 'settled']) {
    const directory = join(startupDirectory, name); mkdirSync(join(directory, 'homes'), { recursive: true });
    const capsulePath = join(directory, 'capsule.json'), external = join(directory, 'external.jsonl'); writeFileSync(external, '', { flag: 'wx' });
    const helper = frozen('docs/needs-you/deck-startup-checks.mjs');
    writeFileSync(capsulePath, JSON.stringify({ slotId: randomUUID(), name, runtime: 'chromium', sourceHead,
      sourceHash: sha(render), bodyHash: sha(helper), observerHashes: pins, sourcePins: { ...pins,
        [resolve(root, 'docs/needs-you/deck-startup-checks.mjs')]: originalPin(root, 'docs/needs-you/deck-startup-checks.mjs'), [resolve(root, 'docs/needs-you/render.mjs')]: originalPin(root, 'docs/needs-you/render.mjs'),
        [resolve(root, 'docs/needs-you/panel-return-check.mjs')]: originalPin(root, 'docs/needs-you/panel-return-check.mjs') },
      ownedHomeRoot: join(directory, 'homes'), output: directory, external, actionLimitMs: 10000, heldPressMs: 1500 }, null, 2));
    startupCapsules.push(capsulePath);
  }
  const startupEntry = `import {requireRuntime} from ${JSON.stringify(pathToFileURL(modulePath('runtime.mjs')).href)};
import {startupCore} from ${JSON.stringify(pathToFileURL(modulePath('startup.mjs')).href)};
import {openSelectedCase} from ${JSON.stringify(pathToFileURL(modulePath('client.mjs')).href)};
import {mkdirSync,readFileSync} from 'node:fs';
requireRuntime('chromium');
${prefix}
const capsules=${JSON.stringify(startupCapsules)};
try { const startup=await startupCore(pageAt,index=>{const capsule=JSON.parse(readFileSync(capsules[index]));const home=join(capsule.ownedHomeRoot,'owned');mkdirSync(home,{recursive:true});process.env.PASEO_HOME=home;const bridge=openSelectedCase(capsules[index]);return{bridge,output:capsule.output};});
assert.deepEqual(errors,[]);await writeFile(${JSON.stringify(join(startupDirectory, 'results.json'))},JSON.stringify({startup,errors}));
} finally {await browser.close();await new Promise(done=>server.close(done));}
`;
  const startupEntryPath = join(startupDirectory, 'startup.mjs'); writeFileSync(startupEntryPath, startupEntry);
  manifest.startup = { entry: startupEntryPath, capsules: startupCapsules, executionSupported: false, originalHelperHash: sha(frozen('docs/needs-you/deck-startup-checks.mjs')) };
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}
