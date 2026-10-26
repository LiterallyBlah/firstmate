// Only synthetic observer controls. Never loads FirstMate or an OS identity probe.
import { createSession } from './session.mjs';
const send = (kind, data) => process.send?.({ workerId: process.env.OBSERVER_WORKER_ID, kind, data });
send('case-entry');
const heartbeat = setInterval(() => send('heartbeat'), 10);
if (process.argv[2] === 'blocked-thread') {
  const started = performance.now();
  setTimeout(() => send('cooperative-signal', { requestedMs: 20, observedMs: performance.now() - started }), 20);
  while (performance.now() - started < 100) { /* deliberately delayed JS signal, not native I/O */ }
} else if (process.argv[2] === 'nonsettling') {
  const session = createSession({ name: 'synthetic-nonsettling' });
  session.run(() => session.call('synthetic.unresolved', () => new Promise(() => {})));
  send('heartbeat', session.snapshot('pending'));
} else {
  clearInterval(heartbeat); send('case-result', { result: 'original-result', cleanup: 'completed' });
  process.disconnect();
}
