/** Sanitized shape of the captain's read-only 2026-10-29 registry/RPC census. */
import { useRpc as original } from '../smooth-pr2/stubs';
import { projects, homeId, uuid, clone } from '../smooth-pr2/data';
export * from '../smooth-pr2/stubs';
const profile = { provider: 'fixture/model', modeId: 'full-access' }, limits = { supervisorSessions: 1, supervisorTurns: 8 };
const template = projects.projects[0];
projects.sequence = 23; projects.hash = 'a'.repeat(64); projects.freshness = 'current';
projects.projects = ['Ariadne', 'firstmate', 'paseo', 'Starpath', 'Blahsec', 'blahsec-site', 'blahsec-business'].map((name, i) => ({ ...clone(template), name, projectId: uuid(i + 1), scopeId: uuid(i + 21), directory: i === 4 || i === 5 ? null : `C:/Projects/${name}`, registryLocation: i === 4 || i === 5 ? `ariadne-dev:/Projects/${name}` : `C:/Projects/${name}`, hostId: i === 4 || i === 5 ? null : 'local', state: i === 4 || i === 5 ? 'held' : i === 2 ? 'unadmitted' : 'admitted', version: i === 2 || i === 4 || i === 5 ? 0 : 2, reason: i === 4 || i === 5 ? 'A canonical local project directory is required; URLs and remote locations need explicit mapping.' : i === 2 ? 'Awaiting reviewed admission and allocation.' : null, profile: i === 2 || i === 4 || i === 5 ? null : profile, limits: i === 2 || i === 4 || i === 5 ? null : limits, plans: i === 0 ? Array.from({ length: 28 }, (_, n) => ({ id: `ariadne-${n}`, title: `Ariadne archived plan ${n + 1}`, state: 'Pending migration; project oversight only', projectIds: [uuid(1)], sponsorScopeId: null, ownerScopeId: null })) : [] }));
projects.associationWarnings = Array.from({ length: 60 }, (_, i) => `Plan older-${i + 1} has unresolved project or host membership; no ownership was guessed.`);
projects.problems = [...projects.associationWarnings];
for (const p of projects.projects) for (const plan of p.plans) plan.backend = 'legacy';
window.review.projects = projects;
const methods = new Map();
export function useRpc(contract) {
  if (!contract.name.startsWith('firstmate.projects.setup.')) return original(contract);
  if (!methods.has(contract.name)) methods.set(contract.name, async input => {
    window.review.calls.push({ name: contract.name, input: clone(input) });
    if (contract.name.endsWith('.read')) return { snapshot: clone(projects), models: [{ provider: profile.provider, label: 'Reviewed project model', modes: [{ id: 'full-access', label: 'Full access' }], thinking: [] }], sources: [{ path: 'data/project-orders.md', text: 'Use the reviewed permissions and limits. Do not create workers or invoke Attach.', problem: null }], reviewed: [], problems: [], folderIssues: [] };
    if (contract.name.endsWith('.status')) return { snapshot: clone(projects), requests: [], recoverableCreates: [] };
    throw Error('Native effect refused by read-only navigation harness: ' + contract.name);
  });
  return methods.get(contract.name);
}
