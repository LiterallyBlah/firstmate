import { snapshot, needs, maintenanceNeeds, threads, homeId, projectId, planId } from '../scoped-supervision/s05-ui/fixtures';
import { fleet } from '../board-list/fixtures';
export { homeId, projectId, planId, fleet };
export const params = new URLSearchParams(location.search), clone = value => JSON.parse(JSON.stringify(value));
export const scope = clone(snapshot);
const model = scope.scopes[2];
scope.scopes.push({ ...clone(model), id: 'remote', title: 'Remote reader', hostId: 'reader-host', target: { ...clone(model.target), scopeId: 'remote', agentId: 'remote-reader' } });
scope.scopes.push({ ...clone(model), id: 'routine', kind: 'maintenance', title: 'Daily checks', target: { ...clone(model.target), scopeId: 'routine', agentId: 'routine-reader' } });
export const directory = scope.scopes.map(s => ({ id: s.id, kind: s.kind, title: s.title, projectIds: ['general','routine'].includes(s.id) ? [] : [projectId], projectNames: ['general','routine'].includes(s.id) ? [] : ['Reader'], hostId: s.hostId, planId: s.planId }));
export const decisions = params.get('surface') === 'maintenance-answer' ? clone(maintenanceNeeds) : { ...clone(needs), scopeFiltersEnabled: true, scopeDirectory: directory };
if (!params.get('surface')?.includes('maintenance')) {
 const row = decisions.scopedDecisions[0], d = row.decision;
 row.captain = { format: 'firstmate.scoped-captain-decision/1', homeId, scope: { kind:'plan', id:planId }, origin:{kind:'plan',id:d.planId}, decisionId:d.id, revision:d.revision, subjectHash:d.subjectHash, title:d.title, question:d.question, options:d.options.map((o,i)=>({...o,number:i+1})), recommendation:'both', evidence:[{ref:'checked/reader-layout-review',digest:'a'.repeat(64)}], projectIds:[projectId], permittedActions:['answer'] };
}
if (params.has('partial')) { decisions.scopedComplete=false; decisions.scopedProblems=['Unknown scope quarantine retained: fixture source coverage gap.']; }
if (params.has('warning')) decisions.quarantined=[{line:12,taskId:null,key:null,hasHold:true,problem:'Unidentified task scope requires reconciliation.'}];
export const histories = new Map([...threads].map(([id,t])=>[id,clone(t)]));
window.pr8 = { calls:[], navigation:[], scope, decisions, histories };
