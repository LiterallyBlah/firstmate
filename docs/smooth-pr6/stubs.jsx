import { useRpc as original } from '../smooth-pr5/stubs';
import { projects, homeId, uuid, params, clone } from '../smooth-pr2/data';
export * from '../smooth-pr5/stubs';
const methods = new Map(), requests = [];
const profile = { provider: 'fixture/model', modeId: 'full-access' }, budget = { agents: 3, turns: 20 }, limits = { supervisorSessions: 1, supervisorTurns: 8 };
const models = [{ provider: profile.provider, label: 'Available project model', modes: [{ id: 'full-access', label: 'Full access' }], thinking: [] }];
const sources = [{ path: 'data/project-orders.md', text: 'Keep track of Starpath and answer my project questions. Use only the reviewed permissions and limits. Do not create workers, execute plans or invoke Attach.', problem: null }];
const scenario = params.get('setup') || 'normal';
const rows = projects.projects;
let folderIssues = [];
rows.forEach((p, i) => Object.assign(p, { directory: i === 4 ? null : `C:/Projects/${p.name}`, hostId: i === 4 ? null : 'local', state: 'unadmitted',
  reason: i === 4 ? 'The project folder is unavailable. Choose its folder again before setup.' : 'Awaiting reviewed admission and allocation.', version: 0 }));
if (rows[2]) Object.assign(rows[2], { state: 'admitted', reason: null, version: 2, agentId: 'existing-mate', workspaceId: 'existing-workspace', sessions: 1, turns: 2, profile, limits });
if (scenario === 'missing-folder' || scenario === 'retained-folder') {
  Object.assign(rows[0], { directory: null, hostId: null, state: 'held', projectId: null, reason: 'Project directory is unavailable; identity was not guessed.' });
  folderIssues = [{ name: rows[0].name, location: `C:/Projects/${rows[0].name}`, rowDigest: 'b'.repeat(64), canReplace: scenario === 'missing-folder' }];
}
function snapshot() { return clone(projects); }
function review(choices) {
  const row = rows.find(p => p.name === choices.name);
  if (scenario === 'capacity') return { choices, review: null, reviewDigest: null, reasons: ["There isn't confirmed room for this mate while keeping FirstMate's reserved capacity. Review capacity in Help settings before creating it."] };
  if (row.directory === null) return { choices, review: null, reviewDigest: null, reasons: ['The project folder is unavailable. Choose its folder again before setup.'] };
  const r = { homeId, registryDigest: 'a'.repeat(64), generalAgentId: 'first-mate', projectId: row.projectId, name: row.name, projectVersion: 0, aliases: [],
    source: { id: uuid(501), version: 1, path: choices.sourcePath, lineStart: 1, lineEnd: 1, fileHash: 'b'.repeat(64), excerptHash: 'c'.repeat(64),
      provenance: { kind: 'plugin-ui-unverified', id: 'unauthenticated-plugin-call', source: 'project setup review (unverified)' }, supersedes: [] },
    profile: choices.profile, budget: choices.budget, limits: choices.limits, policyHash: 'd'.repeat(64), sourceVector: [{ kind: 'policy-source', id: uuid(501), version: 1, digest: 'e'.repeat(64) }],
    opening: `You are the persistent project mate for ${row.name}. Keep this independent workspace and session as the project's conversation and oversight context. Do not create workers or invoke Attach. Plan execution remains separate.`,
    capacity: { slots: 4, generalHeadroom: 1 }, spent: { sessions: 0, turns: 0 } };
  return { choices, review: r, reviewDigest: 'f'.repeat(64), reasons: [] };
}
function finish(input) {
  if (!requests.some(r => r.requestId === input.requestId)) requests.push(clone(input));
  const row = rows.find(p => p.projectId === input.review.projectId);
  Object.assign(row, { state: 'admitted', version: 2, agentId: 'new-project-mate', workspaceId: 'new-project-workspace', profile: input.review.profile,
    limits: input.review.limits, sessions: 1, turns: 1, uncertain: scenario === 'uncertain' ? 1 : 0,
    reason: scenario === 'uncertain' ? 'Provisioning incomplete; inspect and resume the recorded request.' : null });
  if (scenario === 'lost-reply' && !window.review.lost) { window.review.lost = true; throw Error('Connection lost after saving setup.'); }
  return snapshot();
}
if (scenario === 'lost-create') {
  const choices = { homeId, name: rows[0].name, profile, budget, limits, sourcePath: sources[0].path }, reviewed = review(choices);
  requests.push({ homeId, requestId: uuid(601), review: reviewed.review, reviewDigest: reviewed.reviewDigest });
  Object.assign(rows[0], { state: 'admitted', version: 2, agentId: 'reserved-project-mate', workspaceId: 'reserved-workspace', profile, limits, sessions: 1, turns: 1, uncertain: 1,
    reason: 'Provisioning incomplete; inspect and resume the recorded request.' });
}
export function useRpc(contract) {
  if (!contract.name.startsWith('firstmate.projects.setup.')) return original(contract);
  if (!methods.has(contract.name)) methods.set(contract.name, async input => {
    window.review.calls.push({ name: contract.name, input: clone(input) });
    if (contract.name.endsWith('.read')) return { snapshot: snapshot(), models, sources, problems: [], reviewed: [], folderIssues: clone(folderIssues) };
    if (contract.name.endsWith('.preview')) return review(input);
    if (contract.name.endsWith('.status')) return { snapshot: snapshot(), requests: clone(requests), recoverableCreates: scenario === 'lost-create' && rows[0].uncertain ? [uuid(601)] : [] };
    if (contract.name.endsWith('.commit')) return finish(input);
    if (contract.name.endsWith('.resume')) return finish(requests.find(r => r.requestId === input.requestId));
    if (contract.name.endsWith('.instructions')) { const path = `data/project-setup-${input.requestId}.md`; if (!sources.some(s => s.path === path)) sources.push({ path, text: input.text, problem: null }); return { path }; }
    if (contract.name.endsWith('.folder')) {
      if (input.replace) { Object.assign(rows[0], { projectId: uuid(602), directory: 'C:/Projects/Starpath-restored', hostId: 'local', state: 'unadmitted', reason: 'Awaiting reviewed admission and allocation.' }); folderIssues = []; }
      return snapshot();
    }
    throw Error('Unexpected fixture RPC: ' + contract.name);
  });
  return methods.get(contract.name);
}
