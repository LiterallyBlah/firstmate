import { useRpc as base } from '../board-list/stubs';
import { clone,scope,decisions,histories,homeId,fleet } from './data';
export * from '../board-list/stubs';
const methods = new Map();
export function useRpc(contract) {
 if (!methods.has(contract.name)) methods.set(contract.name,async input=>{
  window.pr8.calls.push({name:contract.name,input:clone(input)});
  switch(contract.name) {
   case 'firstmate.scope.read': if(window.pr8.failRead)throw Error('Conversation read unavailable (fixture)'); return clone(scope);
   case 'firstmate.fleet.load': return {...clone(fleet),home:homeId};
   case 'firstmate.workflow.read': return {homeId,version:'1',plans:[],subjects:{},now:[],comingUp:[]};
   case 'firstmate.needs-you.read': case 'firstmate.scope.needs': return clone(decisions);
   case 'firstmate.scope.conversation': return clone(histories.get(input.scopeId)??{key:JSON.stringify(['firstmate.scope-conversation/1',homeId,input.scopeId,'main']),title:'Conversation',messages:[]});
   case 'firstmate.scope.discuss': {
    const thread=histories.get(input.route.target.scopeId)??{key:JSON.stringify(['firstmate.scope-conversation/1',homeId,input.route.target.scopeId,'main']),title:input.route.recipient,messages:[]};
    if(window.pr8.loseSend)throw Error('Lost send reply (fixture)');
    thread.messages.push({id:input.id,text:input.text,route:input.route,agentId:input.route.target.agentId??'created-helper',kind:'discuss',delivery:'sent',reply:null,createdAt:'2026-10-29T12:00:00Z'});
    histories.set(input.route.target.scopeId,thread);return {outcome:'recorded',thread:clone(thread)};
   }
   default: return base(contract)(input);
  }
 });
 return methods.get(contract.name);
}
