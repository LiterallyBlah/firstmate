/** Synthetic host only. Mutation receipts never leave this browser. */
import { useRpc as original } from '../smooth-pr5/stubs';
import { clone, homeId, maintenance, params } from '../smooth-pr2/data';
export * from '../smooth-pr5/stubs';
const methods = new Map();
let quietReadCount = 0;
if (params.get('case') === 'saved') { window.review.features.requested.maintenance = true; window.review.features.effective.maintenance = true; }
if (params.has('drawer-diagnostics')) {
  window.review.features.requested.maintenance = true; window.review.features.effective.maintenance = true;
  maintenance.cleanup = { state: 'held', reason: 'G8: automatic cleanup is held; no qualified no-follow executor or reviewed installed-version reader evidence.', conditions: [
    ...['realpath','E1','E2','E3'].map(id => ({ id, satisfied: true, reasons: [] })),
    { id: 'no-follow-delete', satisfied: false, reasons: ['No qualified no-follow executor.'] },
    { id: 'live-readers', satisfied: false, reasons: ['No reviewed installed-version reader evidence.'] },
    { id: 'N7', satisfied: false, reasons: ['Not acknowledged at the advisory gate.'] },
    { id: 'receiver', satisfied: false, reasons: ['Receiver acknowledgement unavailable.'] },
  ] };
}
if (params.get('features') === 'ui-only') {
  window.review.scope.uiEnabled = true; window.review.scope.executionEnabled = false;
  window.review.features.requested.scopeUi = true; window.review.features.effective.scopeUi = true;
}
export function useRpc(contract) {
  if (params.has('quiet-refresh') && contract.name === 'firstmate.needs-you.read') {
    if (!methods.has(contract.name)) methods.set(contract.name, async input => {
      window.review.calls.push({ name: contract.name, input: clone(input) });
      quietReadCount++;
      const mode = params.get('quiet-refresh');
      if (quietReadCount > 1 && mode === 'background') return new Promise(() => {});
      if (quietReadCount > 1 && mode === 'failed') throw new Error('Synthetic failed decision refresh');
      return { ...clone(window.review.decisions), actionCount: 7, newCount: 0, requests: [], parked: [], quarantined: [],
        scopedComplete: true, scopedProblems: [], planProblems: [],
        freshness: { status: quietReadCount > 1 && mode === 'stale' ? 'stale' : 'fresh', asOf: Date.parse('2026-10-29T18:10:00Z'), checkedAt: Date.now(), problems: [] } };
    });
    return methods.get(contract.name);
  }
  if (!contract.name.startsWith('firstmate.maintenance.') && !contract.name.startsWith('firstmate.introduction.')) return original(contract);
  if (!methods.has(contract.name)) methods.set(contract.name, async input => {
    window.review.calls.push({ name: contract.name, input: clone(input) });
    if (contract.name === 'firstmate.maintenance.read') {
      if (params.has('delay-routine')) return new Promise((_resolve, reject) => {
        (window.review.pendingRoutineReads ??= []).push(reject);
      });
      const data = { ...clone(maintenance), enabled: window.review.features.effective.maintenance };
      if (params.get('case') === 'held') Object.assign(data, { freshness: 'held', problems: ['Fixture: saved work hash mismatch.'] });
      if (params.get('case') === 'offline') throw Error('Offline fixture');
      if (params.get('case') === 'saved') data.owners = [{ scopeId: '00000000-0000-4000-8000-000000000002', state: 'dormant', agentId: 'reserved-checks', epoch: 1, sessions: 1, turns: 1, uncertain: 1, opening: 'uncertain',
        admission: { homeId, requestId: '00000000-0000-4000-8000-000000000001', scopeId: '00000000-0000-4000-8000-000000000002', name: 'Storage checks', profile: { provider: 'codex/gpt-6.1-sol', modeId: 'full-access' }, limits: { supervisorSessions: 1, supervisorTurns: 20 } } }];
      return data;
    }
    if (contract.name === 'firstmate.maintenance.timers') return { homeId, capturedAt: '2026-10-29T12:00:00Z', fingerprint: 'a'.repeat(64), complete: false, problems: ['Fixture: native timer coverage is incomplete.'],
      hashes: { config: 'a'.repeat(64), timers: 'a'.repeat(64), coverage: 'a'.repeat(64) }, initiative: { managed: [], nativeReminders: [], disposition: 'held-reconciliation' },
      rows: [{ id: 'storage-probe', kind: 'script-watch', name: 'Storage probe', schedule: '15 3 * * *', zone: 'Europe/London', enabled: false, owner: 'unknown', disposition: 'needs review', jobId: null }] };
    if (contract.name === 'firstmate.introduction.read') return { homeId: input.homeId, version: 1, state: window.review.dismissed ? 'dismissed' : 'available' };
    if (contract.name === 'firstmate.introduction.dismiss') { window.review.dismissed = true; return { homeId: input.homeId, version: 1, state: 'dismissed' }; }
    throw Error('Unexpected routine mutation in preview: ' + contract.name);
  });
  return methods.get(contract.name);
}
