/** Fixed synthetic source only; never imports product, Vitest, PowerShell or Playwright. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createCase, fileSender } from './protocol.mjs';
const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (config.scenario === 'missing-entry') process.exit(0);
const send = fileSender(config.external);
const bridge = createCase({ capsule: config.capsule, home: config.home, send, heartbeatMs: 10,
  sink: snapshot => {
    if (config.scenario === 'sink-failure') throw Error('Synthetic observer sink failure');
    writeFileSync(config.trace, JSON.stringify(snapshot));
  } });
const signal = () => { bridge.session.note('cooperative-signal', 'callback observation, not kernel stall'); bridge.finalize('cooperative-deadline'); };
process.on('message', message => { if (message === 'diagnostic-abort') signal(); });
let work;
try {
  work = bridge.run(() => {
    if (config.scenario === 'blocked') {
      setTimeout(signal, 20);
      const begin = performance.now(); while (performance.now() - begin < 100) { /* synthetic JS block */ }
    }
    if (['blocked', 'nonsettling'].includes(config.scenario)) return new Promise(() => {});
    if (config.scenario === 'truncated') bridge.session.note('synthetic-large-field', 'x'.repeat(2048));
    if (config.scenario === 'restoration-conflict') {
      const subject = { method: () => 1 }; bridge.session.wrapMethods(subject, 'fixture', ['method']); subject.method = () => 2;
    }
    if (config.scenario === 'rejected') return Promise.reject(Error('Original synthetic failure'));
    return Promise.resolve('original-result');
  });
  await work;
} catch { /* The original rejection is separately retained in the case-result frame. */ }
if (config.scenario !== 'missing-final') bridge.finalize();
else bridge.session.dispose();
// Process exit independently closes the fixed child; it never certifies other runtimes.
process.exit(config.scenario === 'rejected' ? 1 : 0);
