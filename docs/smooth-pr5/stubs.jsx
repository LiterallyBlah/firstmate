/** Isolated host RPCs. Every write is synthetic and recorded. No live home is accessed. */
import { useRpc as original } from '../smooth-pr2/stubs';
import { FEATURES_OFF, FeatureReadResultSchema } from '../../shared/feature-settings';
import { params, homeId, clone } from '../smooth-pr2/data';
export * from '../smooth-pr2/stubs';
const scenario = params.get('case') || 'default';
const requested = { ...FEATURES_OFF };
if (['pilot', 'off-review'].includes(scenario)) Object.keys(requested).forEach(k => { requested[k] = true; });
if (scenario === 'partial') requested.scopeExecution = true;
const state = window.review.features = FeatureReadResultSchema.parse({ homeId, revision: 0,
  source: ['pilot', 'partial', 'off-review'].includes(scenario) ? 'legacy-environment' : 'default', state: 'ready',
  requested, effective: { ...requested, ...(scenario === 'partial' ? { scopeExecution: false } : {}) }, capacity: { slots: 4, generalHeadroom: 1 },
  policy: null, problems: [], dependencyRefusals: scenario === 'partial' ? [{ capability: 'scopeExecution', code: 'DEPENDENCY_DISABLED', reason: 'Enable conversation controls before sending contextual messages.' }] : [],
  runtimeEnforced: true, writesAvailable: true, inventory: { complete: false, coverage: ['scoped-bindings', 'scoped-effects'], sequence: 0,
    active: scenario === 'off-review' ? 2 : 0, pending: scenario === 'off-review' ? 3 : 0, uncertain: scenario === 'off-review' ? 2 : 0,
    problems: ['Legacy deliveries and native sessions have not been checked.'] }, pause: null });
if (scenario === 'held') Object.assign(state, { state: 'held', revision: null, capacity: null, writesAvailable: false, problems: ['Saved policy hash mismatch.'] });
const methods = new Map(), receipts = new Map();
export function useRpc(contract) {
  if (!contract.name.startsWith('firstmate.features.')) return original(contract);
  if (!methods.has(contract.name)) methods.set(contract.name, async input => {
    window.review.calls.push({ name: contract.name, input: clone(input) });
    if (contract.name.endsWith('.read')) {
      if (scenario === 'read-error' || window.review.readError) throw new Error('Synthetic permission failure reading settings');
      if (input.home !== homeId) throw new Error("FirstMate's home changed. Refresh before reading settings.");
      return clone(state);
    }
    if (scenario === 'save-failure' && !window.review.failed) { window.review.failed = true; throw new Error('Permission denied saving settings. Check access, then review again.'); }
    if (receipts.has(input.requestId)) {
      const previous = receipts.get(input.requestId);
      if (JSON.stringify(input) !== JSON.stringify(previous.input)) throw new Error('Request body changed');
      return clone(previous.result);
    }
    if (input.expectedRevision !== state.revision) throw new Error('Feature settings changed. Refresh and review them before saving.');
    const policy = { format: 'firstmate.feature-policy/1', homeId, revision: input.expectedRevision + 1, ...clone(input.change),
      updated: { kind: 'plugin-ui-unverified', source: 'firstmate.features.set', requestId: input.requestId, at: '2026-10-29T14:00:00.000Z' } };
    const result = { homeId, requestId: input.requestId, policy };
    Object.assign(state, { policy, revision: policy.revision, source: 'saved', requested: policy.requested, effective: { ...policy.requested }, capacity: policy.capacity, dependencyRefusals: [] });
    receipts.set(input.requestId, { input: clone(input), result });
    if (scenario === 'lost-reply' && !window.review.failed) { window.review.failed = true; throw new Error('Synthetic lost response after saving'); }
    return clone(result);
  });
  return methods.get(contract.name);
}
