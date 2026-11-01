import {randomUUID} from "node:crypto";
import {join} from "node:path";
import {expect,it} from "vitest";
import {fixture} from "../test/fmu-review-runtime-fixture";
import {SupervisionSources} from "./supervision-sources";
import {WatchConfigStore} from "./watch-config";
import {pluginDir} from "./data-dir";
import {digest} from "./submissions";
import {watchPolicyDigest} from "./supervision-source-state";
import {cutoverGate} from "./supervision-gate";
import {expectedFor} from "./supervision-effects";
import {ruleRef} from "./plan-rules";
import * as fs from "node:fs/promises";
import {vi} from "vitest";
vi.mock("node:fs/promises", async importOriginal => {
 const actual = await importOriginal<typeof import("node:fs/promises")>();
 return {...actual,readFile:vi.fn(actual.readFile)};
});
it("R2-F5: stale watch owner must not prevent unrelated admitted worker dispatch on production tick",async()=>{
 const f=await fixture(true),a=f.scopes[0]!,b=f.scopes[1]!;
 try{
  await f.launch(a,a.nodes[0]!);const s=await f.store.read(),task=s.tasks.find(t=>t.ownerScopeId===a.id&&t.currentAttempt)!,owner=s.bindings.find(b=>b.scopeId===a.id)!;
  const target={homeId:s.homeId,hostId:"local" as const,name:"stale",definitionDigest:digest("definition"),scopeId:a.id,taskId:task.id,attemptId:task.currentAttempt!,planId:a.planId,
   planHash:s.plans.find(p=>p.scopeId===a.id)!.plan.hash,planRevision:s.plans.find(p=>p.scopeId===a.id)!.plan.revision,owner:{agentId:owner.agentId,epoch:owner.epoch,profileDigest:owner.profileDigest},policyDigest:watchPolicyDigest(s,a.id)};
  const sources=new SupervisionSources(f.store),requestId=randomUUID();await sources.bindWatch(target,requestId);
  const config=new WatchConfigStore(join(pluginDir(),"watch-config.json"));await config.change(c=>{c.assignments.stale={requestId,signature:digest(target),generation:1,stage:"committed",target,pending:[]};});
  await cutoverGate(f.home).watchRoute("stale",requestId,"committed");
  await sources.observeWatch({format:"firstmate.watch-fact/1",watch:"stale",definitionDigest:target.definitionDigest,subject:"checks",state:"healthy",evidence:"same evidence",observedAt:new Date().toISOString(),validUntil:new Date(Date.now()+3600000).toISOString(),deadline:null,coverage:"complete",policyDigest:target.policyDigest,unknownEffects:false});
  const current=await f.store.read(),binding=current.bindings.find(b=>b.scopeId===a.id)!,mutations=[{kind:"binding" as const,value:{...binding,state:"suspect" as const}}];
  await f.store.transact(expectedFor(current,mutations),randomUUID(),mutations);
  const id=await f.queue(b,"plan",{...await f.input(b,{op:"start",plan:b.planId,node:b.nodes[0]!}),planRules:ruleRef(f.records[1]!)});
  let error:unknown;try{await f.service.tick();}catch(e){error=e;}
  const after=await f.store.read(),attempt=after.attempts.find(a=>after.tasks.some(t=>t.id===a.taskId&&t.ownerScopeId===b.id));
  console.log("R2-F5",{error:String(error),reply:await f.result(id),worker:attempt?.worker,effects:after.effects.filter(e=>e.attemptId===attempt?.id).map(e=>({op:e.operation,state:e.state}))});
  expect.soft(attempt?.worker).toBeTruthy();expect.soft(error).toBeUndefined();
  // Counterfactual: retaining that same stale binding but pausing only its watch lets B progress.
  await config.change(c=>{c.assignments.stale!.stage="paused";});await cutoverGate(f.home).watchRoute("stale",requestId,"paused");
  await f.service.tick();const recovered=await f.store.read();
  const worker=recovered.attempts.find(a=>a.id===attempt!.id)?.worker;console.log("R2-F5-counterfactual",{worker});expect(worker).toBeTruthy();
 }finally{await f.service.stop();await f.runtime.stop();}
},60000);

it.each(["missing", "malformed", "budget"])("F5: %s retained watch failure stays held while unrelated production dispatch proceeds",async kind=>{
 const f=await fixture(true),a=f.scopes[0]!,b=f.scopes[1]!;
 const logged=vi.spyOn(console,"error").mockImplementation(()=>{});
 try{
  await f.launch(a,a.nodes[0]!);const s=await f.store.read(),task=s.tasks.find(t=>t.ownerScopeId===a.id&&t.currentAttempt)!,owner=s.bindings.find(b=>b.scopeId===a.id)!;
  const target={homeId:s.homeId,hostId:"local" as const,name:"adverse",definitionDigest:digest("definition"),scopeId:a.id,taskId:task.id,attemptId:task.currentAttempt!,planId:a.planId,
   planHash:s.plans.find(p=>p.scopeId===a.id)!.plan.hash,planRevision:s.plans.find(p=>p.scopeId===a.id)!.plan.revision,owner:{agentId:owner.agentId,epoch:owner.epoch,profileDigest:owner.profileDigest},policyDigest:watchPolicyDigest(s,a.id)};
  const sources=new SupervisionSources(f.store),requestId=randomUUID();await sources.bindWatch(target,requestId);
  const config=new WatchConfigStore(join(pluginDir(),"watch-config.json"));await config.change(c=>{c.assignments.adverse={requestId,signature:digest(target),generation:1,stage:"committed",target,pending:[]};});
  await cutoverGate(f.home).watchRoute("adverse",requestId,"committed");
  await sources.observeWatch({format:"firstmate.watch-fact/1",watch:"adverse",definitionDigest:target.definitionDigest,subject:"checks",state:"healthy",evidence:"exact evidence",observedAt:new Date().toISOString(),validUntil:new Date(Date.now()+3600000).toISOString(),deadline:null,coverage:"complete",policyDigest:target.policyDigest,unknownEffects:false});
  if(kind==="malformed")await sources.admit({kind:"watch",hostId:"local",agentId:null,scopeId:a.id,sourceName:"adverse",gaps:[],coverage:"unknown",
   stream:["retained-malformed"],subject:{watch:"adverse",watchDefinition:target.definitionDigest,taskId:task.id,attemptId:task.currentAttempt!,planId:a.planId},
   identity:"malformed",consequence:"malformed",payload:{unexpected:"well-formed journal blob, invalid watch contract"},critical:false,certainty:"reported"});
  if(kind==="budget")while((await f.store.read()).sequence<128){
   const current=await f.store.read(),rule=current.policyRules[0]!,mutations=[{kind:"policy-rule" as const,value:{...rule,version:rule.version+1}}];
   await f.store.transact(expectedFor(current,mutations),randomUUID(),mutations);
  }
  const event=(await f.store.read()).inbox.events.filter(e=>e.envelope.subject.watch==="adverse").at(-1)!,path=join(f.store.root,"blobs",event.envelope.payloadRef.slice(5));
  const originalRead=(await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).readFile;
  // A transient read failure at the watch consumer, not corruption of the global journal.
  // Removing a committed blob would correctly hold the entire store before tick admission.
  const readFault=kind==="missing"?vi.mocked(fs.readFile).mockImplementation(((...args: Parameters<typeof fs.readFile>)=>{
   if(args[0]===path&&new Error().stack?.includes("SupervisionSources.refreshWatches"))throw Object.assign(Error("retained watch payload unavailable"),{code:"ENOENT"});
   return originalRead(...args);
  }) as typeof fs.readFile):null;
  const id=await f.queue(b,"plan",{...await f.input(b,{op:"start",plan:b.planId,node:b.nodes[0]!}),planRules:ruleRef(f.records[1]!)});
  await expect(f.service.tick()).resolves.toBeUndefined();
  const after=await f.store.read(),attempt=after.attempts.find(a=>after.tasks.some(t=>t.id===a.taskId&&t.ownerScopeId===b.id));
  expect((await f.result(id)).ok).toBe(true);expect(attempt?.worker).toBeTruthy();
  const failure=logged.mock.calls.find(c=>c[0]==="[firstmate] watch refresh held:")?.[1];
  expect(failure).toMatchObject({name:"adverse",scopeId:a.id});expect(failure.error).toBeTruthy();
  if(kind==="budget")expect(failure.recordingError).toMatchObject({code:"HELD"});
  else expect(after.inbox.sources.find(source=>source.scopeId===a.id&&source.kind==="watch")?.gaps).toContain("stale");
  expect(after.inbox.events.filter(e=>e.envelope.subject.watch==="adverse")).toHaveLength(kind==="malformed"?2:1);
  readFault?.mockRestore();
 }finally{vi.mocked(fs.readFile).mockReset();logged.mockRestore();await f.service.stop();await f.runtime.stop();}
},60000);
