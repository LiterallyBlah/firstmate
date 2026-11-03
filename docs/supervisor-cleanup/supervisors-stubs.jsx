/** Slice 3: the live-shaped project census, with the owner's two bound project Supervisors (Ariadne, Starpath). Reads only. */
import { useRpc as original } from '../smooth-pr6/live-stubs';
import { projects, homeId, clone } from '../smooth-pr2/data';
export * from '../smooth-pr6/live-stubs';
const bound = ['Ariadne', 'Starpath'];
for (const p of projects.projects) if (bound.includes(p.name)) Object.assign(p, { agentId: `${p.name.toLowerCase()}-session`, workspaceId: `ws-${p.name.toLowerCase()}`, sessions: 1, turns: 1, reason: null });
const list = { homeId, problems: [], rows: projects.projects.filter(p => bound.includes(p.name)).map(p => ({ scopeId: p.scopeId, kind: 'project', title: p.name, planId: null,
  state: 'active', agentId: p.agentId, epoch: 1, profile: { provider: 'codex/gpt-6.1-sol', modeId: 'full-access', thinkingOptionId: 'xhigh' },
  sessions: 1, turns: 1, limits: { supervisorSessions: 1, supervisorTurns: 8 }, lastFailure: null })) };
const watches = { homeId, watches: [{ name: 'pr-watch', definitionDigest: 'a'.repeat(64), assignment: null }], targets: [], owners: [], observer: { available: false, reason: 'Read-only adapter unqualified.' }, problems: [] };
const reads = { 'firstmate.supervisors.read': list, 'firstmate.watch.supervisors.read': watches };
const methods = new Map();
export function useRpc(contract) {
  if (!(contract.name in reads)) return original(contract);
  if (!methods.has(contract.name)) methods.set(contract.name, async input => { window.review.calls.push({ name: contract.name, input: clone(input) }); return clone(reads[contract.name]); });
  return methods.get(contract.name);
}
