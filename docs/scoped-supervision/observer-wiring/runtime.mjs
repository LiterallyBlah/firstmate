/** Runtime capability boundary. No private Vitest fields, process-tree inference or override. */
export const RUNTIME_SUPPORT = Object.freeze({
  'fixed-synthetic-node': { supported: true, closure: 'close of the one fixed owned synthetic child; fixture always retained' },
  'vitest-forks': { supported: false, reason: 'Public cancellation/close is not independent confirmation of every worker/descendant on forced termination' },
  'powershell-exec': { supported: false, reason: 'Existing exec child handle is observable; descendant ownership/closure is not established' },
  chromium: { supported: false, reason: 'Page/context/browser close can be observed; browser process-tree closure after a stuck protocol is not established' },
});
export function requireRuntime(name) {
  const capability = RUNTIME_SUPPORT[name];
  if (!capability?.supported) throw Object.assign(Error(capability?.reason ?? 'Unknown runtime'), { code: 'UNSUPPORTED_OWNERSHIP', runtime: name });
  return capability;
}
