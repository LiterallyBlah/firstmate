/** Slice 6: the slice 3 census, its two project Supervisors (Ariadne, Starpath) bound or, with `retired`, retired. Reads only. */
import { useRpc as original } from './supervisors-stubs';
import { projects, homeId, clone, params } from '../smooth-pr2/data';
export * from './supervisors-stubs';
const bound = ['Ariadne', 'Starpath'], retired = params.has('retired'), hash = 'a'.repeat(64);
if (retired) for (const p of projects.projects) if (bound.includes(p.name)) p.reason = 'Supervisor retired; identity, spend and history retained. The project stays as context.';
const profile = { provider: 'codex/gpt-6.1-sol', modeId: 'full-access', thinkingOptionId: 'xhigh' };
function controls(scopeId) {
  const p = projects.projects.find(p => p.scopeId === scopeId), id = scopeId;
  const configuration = { id, scopeId: id, generation: 1, requested: profile, resolved: profile, catalogDigest: hash, policyDigest: hash,
    target: { homeId, hostId: 'local', scopeId: id, kind: 'project', planId: null, planHash: null }, limits: { supervisorSessions: 1, supervisorTurns: 8 }, effectiveEpoch: 1, provenance: 'client UI (unverified)' };
  return { homeId, scopeId: id, title: p?.name ?? 'project', ...(params.get('stage') === 'after' ? { kind: 'project' } : {}), planHash: null, policyDigest: hash,
    limits: configuration.limits, problems: [], catalog: [{ provider: profile.provider, label: 'Sol', modes: [{ id: 'full-access', label: 'Full access' }], thinking: [{ id: 'xhigh', label: 'Extra high' }] }],
    view: { scopeId: id, binding: { scopeId: id, epoch: 1, hostId: 'local', agentId: p?.agentId ?? 'session', workspaceId: p?.workspaceId ?? 'ws', profileDigest: hash, checkpointHash: hash,
      acknowledgedSeq: 0, heartbeatDue: null, state: 'active', configurationId: id }, bindingDigest: hash, controlId: null, replacementResume: null, state: 'active',
      configurations: [configuration], pending: null, pendingDigest: null, reservedOwnerInputs: [], sessions: 1, turns: 1,
      obligations: { uncertain: [], reserved: [], workers: [], decisions: [], sources: [], unlanded: [] },
      retirement: 'Retirement requires disposition of retained effects, workers, decisions, sources and unlanded artifacts. No workspace or history is deleted.' } };
}
const methods = new Map();
export function useRpc(contract) {
  if (contract.name === 'firstmate.supervisor.controls.read') {
    if (!methods.has(contract.name)) methods.set(contract.name, async input => { window.review.calls.push({ name: contract.name, input: clone(input) }); return controls(input.scopeId); });
    return methods.get(contract.name);
  }
  if (contract.name === 'firstmate.supervisors.read' && retired) {
    const read = original(contract);
    if (!methods.has(contract.name)) methods.set(contract.name, async input => { const list = await read(input); return { ...list, rows: list.rows.filter(r => !bound.includes(r.title)) }; });
    return methods.get(contract.name);
  }
  return original(contract);
}
