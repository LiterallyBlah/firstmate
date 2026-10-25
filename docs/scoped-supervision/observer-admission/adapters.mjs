/** Admission candidates only. Original callbacks are never rewritten. */
import { createHash } from 'node:crypto';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const targets = [
  { path: 'server/supervision-events.test.ts', title: 'explicitly resolves unknown-owner triage once exact registry evidence exists, retaining prior provenance' },
  { path: 'server/supervision-inbox.test.ts', title: 'pins exact request bytes; accepted replay survives later epoch replacement without new spend' },
];
export function literalCallback(source, { title }) {
  const marker = `  it(${JSON.stringify(title)}, async () => `;
  const start = source.indexOf(marker), end = source.indexOf('\n  });', start);
  if (start < 0 || end < start || source.indexOf(marker, start + 1) !== -1) throw Error('Ambiguous source callback');
  const body = source.slice(start + marker.length, end + 4);
  if (!body.startsWith('{') || !body.endsWith('}')) throw Error('Unexpected callback boundary');
  return { body, sha256: sha256(body), timeoutMs: 5000 };
}

export function installMailboxPhases(session, { SupervisionStore, SupervisionEvents, SupervisionInbox }) {
  session.wrapMethods(SupervisionStore.prototype, 'store', ['initialize', 'acquireCoordinator', 'coordinators', 'assertCoordinator',
    'publish', 'scan', 'apply', 'checkBlobs', 'commit', 'transact', 'read', 'putBlob']);
  session.wrapMethods(SupervisionEvents.prototype, 'events', ['admit', 'resolve']);
  session.wrapMethods(SupervisionInbox.prototype, 'inbox', ['prepare', 'beginSend', 'acknowledge', 'reoffer']);
}
export function filesystemPhases(session, actual) {
  const wrapped = { ...actual };
  for (const name of ['mkdir', 'readFile', 'readdir', 'stat', 'link', 'unlink', 'open']) {
    wrapped[name] = function (...args) {
      const result = session.call(`fs.${name}`, () => Reflect.apply(actual[name], actual, args));
      if (name === 'open') {
        // Original promise AND handle are returned. Side instrumentation still changes scheduling.
        void result.then(handle => {
          if (session.observing()) session.wrapMethods(handle, 'fs.handle', ['writeFile', 'sync', 'close']);
        }, () => {}).catch(error => session.observerError(error));
      }
      return result;
    };
  }
  return wrapped;
}

/** Records the RESULT of the existing promisified execFile call. Delegates once,
 * using the exact same command/arguments/options and same resolved/rejected value.
 * The future child-only bundler adapter must replace only promisify(execFile),
 * not supervisionProcessIdentity(), not the PID/start identity, not a second probe.
 */
export function observeExistingExec(session, exec) {
  return function (file, args, options) {
    const observe = work => { try { work(); } catch (error) { session.observerError(error); } };
    const output = (stdout, stderr) => {
      session.note('identity.exec.stdout', String(stdout ?? '').slice(0, 1024));
      session.note('identity.exec.stderr', String(stderr ?? '').slice(0, 1024));
      session.note('identity.exec.output-lengths', JSON.stringify({ stdout: String(stdout ?? '').length, stderr: String(stderr ?? '').length,
        truncated: String(stdout ?? '').length > 1024 || String(stderr ?? '').length > 1024 }));
    };
    const end = error => { session.note('identity.exec.result', JSON.stringify({
      code: error?.code ?? null, signal: error?.signal ?? null, killed: error?.killed ?? null,
      error: error ? String(error.message).slice(0, 300) : null,
      classification: 'exec-rejected-before-identity-classification',
    })); output(error?.stdout, error?.stderr); session.flush('identity-result'); };
    observe(() => session.note('identity.exec.start', JSON.stringify({ file, args, options })));
    let result;
    try { result = session.call('identity.exec', () => exec(file, args, options)); }
    catch (error) { observe(() => end(error)); throw error; }
    observe(() => {
      const child = result.child;
      if (!child) { session.observerError('Existing exec promise did not expose its actual child'); return; }
      session.note('identity.child.start', JSON.stringify({ pid: child.pid ?? null, spawnfile: child.spawnfile, spawnargs: child.spawnargs }));
      for (const event of ['exit', 'close']) child.once(event, (code, signal) => observe(() =>
        session.note(`identity.child.${event}`, JSON.stringify({ pid: child.pid ?? null, code, signal, killed: child.killed }))));
      child.once('error', error => observe(() => session.note('identity.child.error', JSON.stringify({
        code: error.code ?? null, signal: error.signal ?? null, killed: error.killed ?? child.killed, message: error.message,
      }))));
    });
    void result.then(value => {
      session.note('identity.exec.result', JSON.stringify({ code: 0, signal: null, killed: false,
        classification: /^alive:[0-9]+$/.test(String(value.stdout).trim()) ? 'alive-output' : String(value.stdout).trim() === 'dead' ? 'dead-output' : 'unknown-output' }));
      output(value.stdout, value.stderr);
      session.flush('identity-result');
    }, error => observe(() => end(error))).catch(error => session.observerError(error));
    return result;
  };
}
