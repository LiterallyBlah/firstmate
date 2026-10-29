import { useRpc as original, usePaseo as basePaseo } from '../../docs/board-list/stubs';
import { fleet, entries } from '../../docs/board-list/fixtures';
import { clone,params,scope,projects,maintenance,workflow,decisions,upgraded,homeId } from './data';
export * from '../../docs/board-list/stubs';
const methods=new Map();
const native=basePaseo();
const paseo={...native,providers:{listAvailable:async()=>({providers:[{provider:'codex',available:true}]}),listModels:async()=>({models:[{id:'gpt-6.1-sol',label:'GPT 6.1 Sol',isSelectable:true}]}),listModes:async()=>({modes:[{id:'full-access',label:'Full access'}]})},agents:{ref:id=>({...native.agents.ref(id),refresh:async()=>({agent:fleet.mate?{...fleet.mate,pendingPermissions:[],archivedAt:null}:null}),timeline:{...native.agents.ref(id).timeline,refetch:async input=>{
 const before=input?.direction==='before';
 const base=await native.agents.ref(id).timeline.refetch(input);
 return {...base,direction:input?.direction||'tail',epoch:'fixture',reset:false,staleCursor:false,gap:false,window:{minSeq:1,maxSeq:54,nextSeq:55},startCursor:{epoch:'fixture',seq:before?1:11},endCursor:{epoch:'fixture',seq:54},hasOlder:params.has('long')&&!before,
  entries:before?Array.from({length:10},(_,i)=>({...entries[0],seqStart:i+1,seqEnd:i+1,item:{type:'user_message',text:`Earlier reader message ${i+1}`}})):base.entries};
 }}})}};
export const usePaseo=()=>paseo;
export function useRpc(contract){
 if(!methods.has(contract.name))methods.set(contract.name,async input=>{
  window.review.calls.push({name:contract.name,input});
  if(contract.name.startsWith('firstmate.deck.'))return fetch('/rpc/'+contract.name,{method:'POST',body:JSON.stringify(input||{})}).then(r=>r.json());
  if(params.has('startup')&&['firstmate.fleet.load','firstmate.needs-you.read'].includes(contract.name))return new Promise(()=>{});
  if(params.has('decision-pending')&&contract.name==='firstmate.needs-you.read')return new Promise(()=>{});
  if(params.has('failure')&&['firstmate.fleet.load','firstmate.needs-you.read'].includes(contract.name))throw new Error('Plugin request timed out (synthetic startup case)');
  switch(contract.name){
   case 'firstmate.config.read':return {resolvedHome:homeId,config:{home:homeId,mateAgentId:upgraded?'first-mate':'',mateSince:null,mateProvider:'',mateModeId:'',crewProvider:'',crewModeId:'',migration:null,previousMateIds:[]}};
   case 'firstmate.mate.candidates':return {home:homeId,agents:[]};
   case 'firstmate.scope.read':return {...clone(scope),uiEnabled:params.has('ui-only')||scope.uiEnabled,executionEnabled:!params.has('ui-only')&&scope.executionEnabled};
   case 'firstmate.projects.read':return clone(projects);
   case 'firstmate.maintenance.read':return clone(maintenance);
   case 'firstmate.workflow.read':return clone(workflow);
   case 'firstmate.needs-you.read':case 'firstmate.scope.needs':return clone(decisions);
   case 'firstmate.scope.conversation':return {key:input.scopeId,title:'Discussion',messages:[]};
   case 'firstmate.fleet.load':return clone(fleet);
   case 'firstmate.projects.memory':return {name:'Starpath',projectId:projects.projects[0].projectId,scopeId:projects.projects[0].scopeId,aliases:[],authority:'none',conventions:[],memory:[],proposals:[]};
   default:
    if(/\.((read|find|targets|list|compare|load|status))$/.test(contract.name))return original(contract)(input);
    throw new Error('Mutation or unexpected RPC refused by isolated review harness: '+contract.name);
  }
 });
 return methods.get(contract.name);
}
