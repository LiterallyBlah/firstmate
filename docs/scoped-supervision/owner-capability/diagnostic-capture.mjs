/** Pure admission of bounded diagnostic data; no process opening, enumeration or termination. */
export function diagnosticAssessment(input, native) {
  const reasons = [], require = (ok, reason) => { if (!ok) reasons.push(reason); };
  const rows = native?.diagnosticMembers, valid = Array.isArray(rows) && rows.length <= 8;
  require(native?.diagnosticVersion === 1 && valid && native.diagnosticOverflow === 0, 'diagnostic-inventory-missing-or-overflow');
  const observed = native?.observation?.dropped === 0 && native?.observation?.failures === 0 && native?.cleanup?.diagnosticHandlesClosed === true;
  require(observed, 'diagnostic-observation-or-cleanup-incomplete');
  const processIdentity = value => Number.isSafeInteger(value?.pid) && value.pid > 0 && /^\d{16,20}$/.test(value.creationFileTime) &&
    typeof value.image === 'string' && value.image.length > 0 && value.member === true;
  const queries = value => ['pid','creation','image','membership'].every(key => value?.queries?.[key]?.ok === true);
  let closed = valid && observed && native?.diagnosticVersion === 1 && native.diagnosticOverflow === 0;
  const pids = new Set(), handles = new Set();
  for (const row of valid ? rows : []) {
    const first = row.initial, last = row.terminal, inventory = native?.handleInventory?.[row.role];
    const bound = row.acquisition === 'acquired' && row.bindingComplete === true && processIdentity(first?.identity) && queries(first) &&
      row.pid === first.identity.pid && row.pid !== native?.root?.pid && first.wait?.ok === true && first.wait.result === 258 &&
      /^0x[1-9a-f][0-9a-f]*$/i.test(row.handle) && !pids.has(row.pid) && !handles.has(row.handle);
    require(bound, 'diagnostic-member-unbound-or-raced'); pids.add(row.pid); handles.add(row.handle);
    const settled = bound && processIdentity(last?.identity) && queries(last) && last.identity.pid === row.pid &&
      last.identity.creationFileTime === first.identity.creationFileTime && last.wait?.ok === true && last.wait.result === 0 &&
      last.exit?.ok === true && Number.isSafeInteger(last.exit.code) && last.exit.code >= 0 && last.exit.code <= 0xffffffff &&
      inventory?.acquisition === 'acquired' && inventory.handle === row.handle && inventory.disposition === 'closed';
    require(settled, 'diagnostic-terminal-or-disposal-unknown'); closed = closed && settled;
  }
  const root = native?.root, child = native?.child, marker = input.rootPreSpawn, entry = input.rootEntry, childEntry = input.childEntry;
  const owner = native?.events?.find(event => event.kind === 'owner-acquired')?.data;
  const provenance = value => value?.caseId === input.caseId && value.nonce === input.nonce && value.scenario === 'normal' && value.node === input.nodeVersion && value.threadId === 0 && value.isMainThread === true;
  const correlated = provenance(marker) && provenance(entry) && provenance(childEntry) && Buffer.byteLength(JSON.stringify(marker), 'utf8') <= 4096 && marker.format === 'firstmate.root-pre-spawn/1' && marker.stage === 'before-child-spawn' &&
    marker.pid === root?.pid && marker.ppid === owner?.helperPid && marker.childEntry === input.childScriptPath &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(marker.instance) && marker.instance === entry.instance &&
    entry.pid === root?.pid && entry.childPid === child?.pid && childEntry.pid === child?.pid && childEntry.ppid === root?.pid &&
    valid && rows.length === 1 && rows[0].pid === child?.pid && rows[0].initial?.identity?.creationFileTime === child?.creationFileTime &&
    rows[0].initial?.identity?.image?.toLowerCase() === child?.image?.toLowerCase();
  require(correlated, 'pre-spawn-and-live-child-correlation-incomplete');
  return { complete: reasons.length === 0, membersClosed: closed, reasons, origin: reasons.length === 0 ? 'correlated-fixed-fixture' : 'unresolved' };
}
