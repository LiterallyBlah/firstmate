/** Independent R2 probes. Synthetic isolated stores, no product edits or native provider. */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { s04Fixture } from "./supervision-s04-fixture";
import { now } from "./supervision-inbox-fixture";
import { SupervisionSources } from "../server/supervision-sources";
import { watchPolicyDigest } from "../server/supervision-source-state";
import { digest } from "../server/submissions";
import { updateFirstmateConfig } from "../server/config";
import { SupervisionRuntime } from "../server/supervision-runtime";
import { WatchSupervisors } from "../server/watch-supervisors";
import { cutoverGate } from "../server/supervision-gate";

async function fixture() {
 const f=await s04Fixture(),scope=await f.addScope(1,"plan",["build"]);
 await f.draft(scope,[{id:"build"}]);await f.launch(scope,"build");
 const s=await f.store.read(),task=s.tasks[0]!,b=s.bindings[0]!;
 const sources=new SupervisionSources(f.store,{now:()=>now});
 const target={homeId:s.homeId,hostId:"local" as const,name:"one",definitionDigest:digest("definition"),scopeId:scope.id,taskId:task.id,
 attemptId:task.currentAttempt!,planId:"plan",planHash:s.plans[0]!.plan.hash,planRevision:s.plans[0]!.plan.revision,
 owner:{agentId:b.agentId,epoch:b.epoch,profileDigest:b.profileDigest},policyDigest:watchPolicyDigest(s,scope.id)};
 const fact={format:"firstmate.watch-fact/1" as const,watch:"one",definitionDigest:target.definitionDigest,subject:"same-check",
 state:"healthy",evidence:"same exact evidence",observedAt:now.toISOString(),validUntil:new Date(now.getTime()+3600000).toISOString(),
 deadline:null,coverage:"complete" as const,policyDigest:target.policyDigest,unknownEffects:false};
 return {...f,scope,sources,target,fact};
}
it("R2 control: one source healthy/failure/healthy makes recovery actionable",async()=>{
 const f=await fixture();await f.sources.bindWatch(f.target,randomUUID());
 for(const state of ["healthy","failed","healthy"])await f.sources.observeWatch({...f.fact,state});
 const s=await f.store.read();expect(s.inbox.assignments.map(a=>a.state)).toEqual(["observed","assigned","assigned"]);
});
it("R2-F1: recovery reported by an overlapping watch must be actionable",async()=>{
 const f=await fixture();await f.sources.bindWatch(f.target,randomUUID());await f.sources.bindWatch({...f.target,name:"two"},randomUUID());
 await f.sources.observeWatch(f.fact);
 await f.sources.observeWatch({...f.fact,watch:"two",state:"failed"});
 await f.sources.observeWatch(f.fact);
 const s=await f.store.read();console.log("R2-F1",s.inbox.assignments.map(a=>({state:a.state,reason:a.reason})));
 expect(s.inbox.assignments.at(-1)?.state).toBe("assigned");
});
it("R2-F2: unchanged overlapping retained evidence cannot create fresh transitions on every clock pass",async()=>{
 const f=await fixture();await f.sources.bindWatch(f.target,randomUUID());await f.sources.bindWatch({...f.target,name:"two"},randomUUID());
 await f.sources.observeWatch(f.fact);await f.sources.observeWatch({...f.fact,watch:"two",state:"failed"});
 await f.sources.refreshWatches();const before=await f.store.read();
 await f.sources.refreshWatches();const after=await f.store.read();
 console.log("R2-F2",{before:before.sequence,after:after.sequence,eventsBefore:before.inbox.events.length,eventsAfter:after.inbox.events.length});
 expect(after.sequence).toBe(before.sequence);
});
it("R2 control: 100 identical healthy facts stay quiet before model admission",async()=>{
 const f=await fixture();await f.sources.bindWatch(f.target,randomUUID());await f.sources.observeWatch(f.fact);const s=await f.store.read();
 for(let i=0;i<100;i++)await f.sources.observeWatch({...f.fact,observedAt:new Date(now.getTime()+i).toISOString()});
 const end=await f.store.read();expect(end.sequence).toBe(s.sequence);expect(end.effects).toEqual(s.effects);expect(end.inbox.assignments.every(a=>a.state==="observed")).toBe(true);
});
it("R2-F3: actual app prepare request replays its accepted receipt after plan progress",async()=>{
 const f=await fixture();await mkdir(join(f.home,"watches"),{recursive:true});await writeFile(join(f.home,"watches","one"),"#!/usr/bin/env node\n// schedule: * * * * *\n");
 await updateFirstmateConfig({mateAgentId:""});await updateFirstmateConfig({home:f.home});await updateFirstmateConfig({mateAgentId:"general"});
 const runtime=new SupervisionRuntime(join(f.home,"runtime"),()=>f.store);await runtime.mutate(f.home,async()=>{});
 const service=new WatchSupervisors(runtime,{runner:{queued:async()=>[]},pendingInspections:async()=>[]} as never);
 const handlers=new Map<string,(input:any)=>Promise<any>>();service.register({handle:(rpc:{name:string},run:(input:any)=>Promise<any>)=>handlers.set(rpc.name,run)} as never);
 const read=()=>handlers.get("firstmate.watch.supervisors.read")!({}),act=(input:any)=>handlers.get("firstmate.watch.supervisors.act-ui")!(input);
 try{
  const s=await read(),request={op:"prepare",requestId:randomUUID(),expectedGeneration:0,target:s.targets.find((t:any)=>t.name==="one")};
  await act(request);await f.record(f.scope,"build","done");
  await expect(act(request)).resolves.toMatchObject({watches:[expect.objectContaining({assignment:expect.objectContaining({requestId:request.requestId})})]});
 }finally{await runtime.stop();}
});

