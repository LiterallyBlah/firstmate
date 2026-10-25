/** External parent-clock witness, only for a dedicated fixture child. No PID takeover. */
import { fork } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';

export async function runContainedWorker({ entry, args = [], deadlineMs, graceMs = 100, startupMs = 2000, exitWaitMs = 2000, env = {}, launch = fork }) {
  const started = performance.now(), workerId = randomUUID(), events = [];
  const receipt = { workerId, pid: null, deadlineMs, graceMs, events, dropped: 0, observerIncomplete: false,
    stdout: '', stderr: '', outputDropped: 0, terminationRequested: false, terminationConfirmed: false, safeForNextCase: false };
  const note = (kind, data = {}) => {
    if (events.length < 128) events.push({ kind, at: performance.now() - started, ...data });
    else { receipt.dropped++; receipt.observerIncomplete = true; }
  };
  const child = launch(entry, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, ...env, OBSERVER_WORKER_ID: workerId } });
  receipt.pid = child.pid ?? null;
  note('spawn', { pid: receipt.pid });
  let deadline, termination, exitWait, completed = false;
  const timers = () => { clearTimeout(startup); clearTimeout(deadline); clearTimeout(termination); clearTimeout(exitWait); };
  function terminate(reason) {
    if (receipt.terminationRequested || completed) return;
    receipt.terminationRequested = true;
    note('termination-request', { reason, connected: child.connected, exitCode: child.exitCode, signalCode: child.signalCode });
    // kill() returning true is only a request, NOT confirmation of exit/drain.
    try { receipt.killReturned = child.kill('SIGKILL'); }
    catch (error) { note('termination-error', { message: error.message.slice(0, 300) }); }
    exitWait = setTimeout(() => {
      note('termination-unconfirmed'); timers();
      // Keep admission closed. Detach only our own failed fixture's handles so
      // this helper can return evidence; no next case may run in this envelope.
      child.stdout?.destroy(); child.stderr?.destroy();
      try { if (child.connected) child.disconnect(); child.unref(); }
      catch (error) { note('detach-error', { message: error.message.slice(0, 300) }); }
      finish();
    }, exitWaitMs);
  }
  const startup = setTimeout(() => terminate('no-case-entry'), startupMs);
  let finish;
  const done = new Promise(resolve => { finish = () => resolve(structuredClone(receipt)); });
  for (const stream of ['stdout', 'stderr']) child[stream].on('data', bytes => {
    const value = String(bytes), room = 4096 - receipt[stream].length;
    receipt[stream] += value.slice(0, Math.max(0, room));
    receipt.outputDropped += Math.max(0, value.length - room);
    if (value.length > room) receipt.observerIncomplete = true;
  });
  child.on('message', message => {
    if (message?.workerId !== workerId) { note('foreign-message-rejected'); return; }
    if (message.kind === 'case-entry' && !deadline) {
      clearTimeout(startup); note('case-entry');
      deadline = setTimeout(() => {
        note('external-deadline', { connected: child.connected, exitCode: child.exitCode, signalCode: child.signalCode });
        termination = setTimeout(() => terminate('external-deadline'), graceMs);
      }, deadlineMs);
    } else if (['heartbeat', 'cooperative-signal', 'case-result'].includes(message.kind)) {
      const data = JSON.stringify(message.data ?? null);
      if (data.length > 4096) receipt.observerIncomplete = true;
      note(message.kind, { data: data.slice(0, 4096), dataTruncated: data.length > 4096 });
    }
  });
  child.once('error', error => { note('child-error', { code: error.code ?? null, message: error.message.slice(0, 300) }); });
  child.once('close', (code, signal) => {
    completed = true; timers(); receipt.code = code; receipt.signal = signal;
    receipt.terminationConfirmed = receipt.terminationRequested;
    receipt.safeForNextCase = true;
    note('close', { code, signal }); finish();
  });
  return done;
}
