import {useRpc as original} from '../smooth-pr2/stubs';
import {workflow,activation,params,homeId,uuid,clone} from '../smooth-pr2/data';
export * from '../smooth-pr2/stubs';
const scenario=params.get('case')||'default', plan=workflow.plans.find(p=>!p.definition.implicit);
window.review.target=plan.definition.id;
const backup={homeId,revision:0,backup:null,source:'default',requestId:null,problems:[]};
let preparation=null;
const receiptBase={format:'firstmate.migration-receipt/1',version:1,compatibility:1,homeId,frozenAt:'2026-10-29T12:00:00.000Z',
 source:{tip:{sequence:1,hash:'a'.repeat(64)},sourceHash:'a'.repeat(64),files:[]},
 imported:{indexHash:'a'.repeat(64),requests:[],attempts:[],budget:{agents:1,turns:1},handled:[],told:[],holds:[]},dependents:[],launches:[],
 inventory:{hash:'a'.repeat(64),dispositionIds:[]},projectionPreimage:{backlog:null,itemTags:null},sidecars:{freeze:'a'.repeat(64),prepared:'a'.repeat(64),committed:null},
 capacity:{sequenceAtFreeze:1,transactionsNeeded:12,ceiling:256,preparedMutations:4,commitMutations:3},aborted:null};
const methods=new Map();
export function useRpc(contract){
 if(!/^firstmate\.supervision\.(backup\.|plan-help\.|migrate)/.test(contract.name))return original(contract);
 if(!methods.has(contract.name))methods.set(contract.name,async input=>{
  window.review.calls.push({name:contract.name,input:clone(input)});
  if(contract.name.endsWith('backup.read'))return clone(backup);
  if(contract.name.endsWith('backup.set')){
   if(scenario==='invalid'&&!window.review.corrected)throw new Error('Choose a separate backup folder outside FirstMate’s home.');
   if(input.expectedRevision!==backup.revision)throw new Error('Backup settings changed. Refresh and review again.');
   Object.assign(backup,{revision:backup.revision+1,source:'saved',requestId:input.requestId,backup:clone(input.backup)});
   return clone(backup);
  }
  if(contract.name.endsWith('plan-help.evidence'))return {homeId,plan:plan.definition.id,reviewHash:'b'.repeat(64),folder:'data',entries:[{name:'rollback.md',path:'data/rollback.md',kind:'file'}],problems:[],inventory:{hash:'c'.repeat(64),summary:['0 pending or recorded deliveries checked.','No message will be resent.'],problems:[]},policy:{hash:'d'.repeat(64),sources:[{path:'data/orders.md',lines:'1–1',content:'Previously accepted project permissions.'}]},rollback:input.rollbackPath?{path:input.rollbackPath,hash:'e'.repeat(64),content:'Illustrative retained-build report. The real-RPC harness reads an actual confined file and verifies its digest.'}:null};
  if(contract.name.endsWith('plan-help.read'))return {homeId,plan:plan.definition.id,title:plan.definition.title,planHash:plan.hash,reviewHash:'b'.repeat(64),currentOwner:plan.owner==='firstmate'?'FirstMate':'Captain',projectId:uuid(1),scopeId:uuid(2),migrationId:uuid(3),supervisorId:uuid(4),budget:plan.definition.budget,spent:{agents:1,turns:1},backupRevision:backup.revision,sourcePaths:['data/orders.md'],preparation,canCorrectPreparation:false,problems:[...(!backup.backup?['Choose a separate backup folder and how long to keep its files below.']:[]),...(scenario==='held'?['Decisions haven’t all been checked. Refresh Needs you before handing over this plan.']:[])]};
  if(contract.name.endsWith('migrate')){
   if(scenario==='lost'&&!window.review.lost){window.review.lost=true;throw new Error('Synthetic lost handover reply');}
   if(input.op==='prepare'){
    preparation=clone(input);
    const receipt={id:uuid(3),planId:plan.definition.id,scopeId:uuid(2),state:'prepared',prerequisites:input.prerequisites,imported:{attempts:[],budget:{agents:1,turns:1}}};
    // Output is checked by the production schema, so use a real-shaped S07 receipt from its fixture.
    Object.assign(receipt,receiptBase,{id:uuid(3),planId:plan.definition.id,scopeId:uuid(2),prerequisites:input.prerequisites,state:'prepared'});
    activation.migrations=[receipt];
   }else if(input.op==='barrier')activation.migrations[0].state='barrier';
   else if(input.op==='commit'){
    activation.migrations[0].state='committed';
    activation.plans=[{plan:plan.definition.id,title:plan.definition.title,hash:plan.hash,scopeId:uuid(2),scopeVersion:2,supervisorId:uuid(4),canAttach:true,binding:null,opening:null}];
   }else if(input.op==='abort')activation.migrations[0].state='aborted';
   return clone(activation);
  }
 });
 return methods.get(contract.name);
}
