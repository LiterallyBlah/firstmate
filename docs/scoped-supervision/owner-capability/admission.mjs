/** Test-only receipt admission; native/local records are not authenticated peer evidence. */
export function sealOwnerCapture(input) {
  const data = structuredClone(input), problems = [];
  const require = (value, reason) => { if (!value && problems.length < 32) problems.push(reason); };
  const n = data.native, root = n?.root, child = n?.child;
  const membership = (value, expected, total) => value && value.assigned === expected.length && value.listed === expected.length &&
    value.active === expected.length && value.total === total && Array.isArray(value.pids) && value.pids.length === expected.length &&
    new Set(value.pids).size === expected.length && expected.every(pid => value.pids.includes(pid));
  const identity = value => value && Number.isSafeInteger(value.pid) && value.pid > 0 && /^0x[1-9a-f][0-9a-f]*$/i.test(value.handle) &&
    /^\d{16,20}$/.test(value.creationFileTime) && value.member === true && typeof value.image === 'string' &&
    value.image.toLowerCase() === data.nodePath?.toLowerCase();
  const events = n?.events ?? [], at = kind => events.findIndex(event => event.kind === kind);
  require(n?.error === null && n?.targetCreated === true && n?.targetResumed === true, 'missing-or-failed-native-case');
  require(identity(root) && identity(child) && root.pid !== child.pid && root.handle !== child.handle, 'missing-or-unstable-process-handles');
  require(at('owner-acquired') >= 0 && at('creation-owner-configured') > at('owner-acquired') &&
    at('suspended-root-owned') > at('creation-owner-configured') && at('root-resumed') > at('suspended-root-owned') &&
    at('root-and-descendant-bound') > at('root-resumed') && at('owned-set-closed') > at('root-and-descendant-bound'), 'missing-owner-before-execution');
  const owner = events.find(event => event.kind === 'owner-acquired')?.data;
  require(owner?.flags === 8192 && membership(owner?.members, [], 0), 'missing-kill-on-close-or-empty-owner');
  require(membership(n?.beforeResume, [root?.pid], 1) && membership(n?.liveMembers, [root?.pid, child?.pid], 2), 'missing-complete-live-membership');
  require(membership(n?.finalMembers, [], 2) && n?.rootWait === 0 && n?.childWait === 0, 'unconfirmed-owned-set-closure');
  require(['timerDrained', 'threadHandleClosed', 'childHandleClosed', 'rootHandleClosed', 'jobHandleClosed'].every(key => n?.cleanup?.[key] === true), 'incomplete-owner-disposal');
  require(data.outer?.closed === true && data.outer?.status === 0 && data.outer?.deadlineFired === false, 'missing-external-helper-close');
  const entry = (value, process) => value && value.pid === process?.pid && value.caseId === data.caseId && value.nonce === data.nonce &&
    value.scenario === data.scenario && value.node === data.nodeVersion && value.threadId === 0 && value.isMainThread === true &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.instance);
  require(entry(data.rootEntry, root) && entry(data.childEntry, child) && data.rootEntry?.childPid === child?.pid &&
    data.childEntry?.ppid === root?.pid && data.rootEntry?.ppid === owner?.helperPid, 'uncorrelated-actual-fixture-entry');
  require(at('deadline-armed') >= 0 && at('deadline-armed') < at('suspended-root-owned'), 'missing-independent-deadline');
  if (data.scenario === 'normal') {
    require(n?.deadlineFired === false && n?.terminateRequested === false && n?.rootExit === 0 && n?.childExit === 0 && at('normal-release') > at('root-and-descendant-bound'), 'normal-case-failed');
    require(data.rootResult?.childCode === 0 && data.rootResult?.childSignal === null && data.childResult?.fulfilled === true, 'missing-original-normal-outcome');
  } else if (data.scenario === 'blocked') {
    require(n?.deadlineFired === true && n?.terminateRequested === true && n?.terminateReturned === true && n?.terminationError === 0 &&
      n?.rootExit === 197 && n?.childExit === 197 && at('termination') > at('root-and-descendant-bound') &&
      events.find(event => event.kind === 'termination')?.data.reason === 'independent-parent-deadline', 'unconfirmed-deadline-termination');
    require(data.rootDelayedSignal === false && data.childDelayedSignal === false, 'blocked-case-delayed-signal-observed');
  } else require(false, 'unsupported-scenario');
  return structuredClone({ ...data, problems, ownedSetClosureConfirmed: membership(n?.finalMembers, [], 2) && n?.rootWait === 0 && n?.childWait === 0,
    safeForReuse: problems.length === 0, actualRuntimeQualified: false, retainFixture: true });
}
