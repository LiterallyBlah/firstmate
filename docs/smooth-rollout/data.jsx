import { fleet, entries } from '../../docs/board-list/fixtures';
import { snapshot, needs } from '../../docs/scoped-supervision/s05-ui/fixtures';
import { compactPlansFixture } from '../../test/compact-plans-fixture';
import { ProjectRuntimeSnapshotSchema } from '../../shared/project-runtime';
import { MaintenanceRuntimeSnapshotSchema } from '../../shared/maintenance-runtime';
import { ScopeSnapshotSchema } from '../../shared/supervision-rpc';
export const params = new URLSearchParams(location.search);
export const on = params.get('features') === 'on', upgraded = params.get('home') === 'upgraded';
export const configured = params.has('configured'), homeId = 'C:/fixture/FirstMate';
export const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const clone = x => structuredClone(x);
fleet.home = homeId; fleet.mate.title = 'FirstMate'; fleet.suggestions = [];
fleet.cards = upgraded ? fleet.cards.filter(c => c.column !== 'done').slice(0,7) : [];
fleet.watches = upgraded ? fleet.watches : [];
if (!upgraded) { fleet.mate = null; entries.splice(0); }
else entries.splice(0, entries.length, ...[
  ['user_message','Can you help me get the reader update ready?'],
  ['assistant_message','Yes. I’ll keep the work in a reviewed plan and let you know when I need a decision.'],
  ['user_message','Keep the current reader layout. Please check the phone view too.'],
  ['assistant_message','I’ve saved that direction. The reader review is ready for us to look at together.'],
].map(([type,text],i)=>({provider:'codex',item:{type,text},timestamp:'2026-10-29T09:00:00Z',seqStart:i+1,seqEnd:i+1,sourceSeqRanges:[],collapsed:[]})));
export const activation = {enabled:on,operatorEnabled:on,homeId,problems:[],audits:[],plans:[],migrations:[],dispositions:[]};
export const scope = ScopeSnapshotSchema.parse({...clone(snapshot),homeId,uiEnabled:on,executionEnabled:on,sequence:configured?23:0,freshness:configured?'current':'uninitialized',asOf:'2026-10-29T09:00:00.000Z',
  activation, projects:configured?clone(snapshot.projects):[],scopes:configured?clone(snapshot.scopes):[{...clone(snapshot.scopes[0]),goals:[],session:'unknown',observedAt:null,target:{homeId,scopeId:'general',agentId:upgraded?'first-mate':null,epoch:0,scopeVersion:0}}]});
scope.activation = activation;
for(const s of scope.scopes) s.target.homeId=homeId;
if(params.has('long')){
 const original=clone(entries);
 entries.splice(0,entries.length,...Array.from({length:40},(_,i)=>({...original[0],seqStart:i+11,seqEnd:i+11,item:{type:i%2?'assistant_message':'user_message',text:`Reader discussion ${i+11}. Keep this reading position and the existing conversation.`}})),...original.map((e,i)=>({...e,seqStart:i+51,seqEnd:i+51})));
 for(let i=15;i<19;i++)entries[i].item={type:'tool_call',name:'read_file',status:'completed',detail:{type:'read',filePath:`chapter-${i}.md`},input:{path:`chapter-${i}.md`},output:'Reader notes'};
}
const project=(name,n,extra={})=>({name,projectId:uuid(n),scopeId:uuid(n+20),hostId:'local',directory:`C:/Projects/${name}`,state:'unadmitted',reason:'Awaiting reviewed admission and allocation.',version:0,aliases:[],agentId:null,workspaceId:null,provisionRequestId:null,sessions:0,turns:0,uncertain:0,memoryPending:0,profile:null,limits:null,plans:[],...extra});
export const projects=ProjectRuntimeSnapshotSchema.parse({enabled:on,homeId,registryDigest:'a'.repeat(64),sequence:configured?527:0,hash:configured?'a'.repeat(64):null,freshness:configured?'current':'uninitialized',problems:[],general:{agentId:upgraded?'first-mate':null,scopeId:null,slots:4,headroom:1,providerAvailability:'unknown'},projects:upgraded?['Starpath','FirstMate','Reader','Writing','Archive','Remote storage'].map((n,i)=>project(n,i+1,configured&&i===0?{state:'admitted',reason:null,version:2,profile:{provider:'codex/gpt-6.1-sol',modeId:'full-access',thinkingOptionId:'xhigh'},limits:{supervisorSessions:1,supervisorTurns:12}}:{})):[]});
export const maintenance=MaintenanceRuntimeSnapshotSchema.parse({enabled:on,homeId,sequence:0,freshness:'uninitialized',lowerBound:false,problems:[],cleanup:{state:'held',reason:'G8',conditions:[]},jobs:[],occurrences:[],hosts:[],incidents:[],reservations:[],owners:[],deliveries:[],captainDecisions:[],decisions:[],outbox:[]});
export const workflow={homeId,version:'synthetic-upgrade',plans:upgraded?compactPlansFixture():[],subjects:{},now:[],comingUp:[],problems:[]};
workflow.subjects=Object.fromEntries(workflow.plans.map(p=>[p.definition.id,'b'.repeat(64)]));
export const decisions={...clone(needs),homeId,actionCount:configured?1:0,newCount:0,scopedDecisions:configured?clone(needs.scopedDecisions):[],scopedAnswersEnabled:on,scopeFiltersEnabled:on,scopedComplete:true,scopedHolds:[],scopedSequence:configured?23:0,
 scopeDirectory:on?scope.scopes.map(s=>({id:s.id,kind:s.kind,title:s.title,projectIds:[],projectNames:[],planId:s.planId,hostId:'local'})):[],freshness:{status:'fresh',asOf:Date.parse('2026-10-29T09:00:00Z'),checkedAt:Date.parse('2026-10-29T09:00:00Z'),problems:[]}};
window.review={on,upgraded,configured,scope,projects,maintenance,workflow,decisions,calls:[],navigation:[]};
