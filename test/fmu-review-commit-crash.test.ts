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
it("R2-F4: accepted app commit replay must finish the config-to-gate crash boundary",async()=>{
 const f=await fixture();await mkdir(join(f.home,"watches"),{recursive:true});await writeFile(join(f.home,"watches","one"),"#!/usr/bin/env node\n// schedule: * * * * *\n");
 await updateFirstmateConfig({mateAgentId:""});await updateFirstmateConfig({home:f.home});await updateFirstmateConfig({mateAgentId:"general"});
 const runtime=new SupervisionRuntime(join(f.home,"runtime"),()=>f.store);await runtime.mutate(f.home,async()=>{});
 const service=new WatchSupervisors(runtime,{runner:{queued:async()=>[]},pendingInspections:async()=>[]} as never);
 const handlers=new Map<string,(input:any)=>Promise<any>>();service.register({handle:(rpc:{name:string},run:(input:any)=>Promise<any>)=>handlers.set(rpc.name,run)} as never);
 const read=()=>handlers.get("firstmate.watch.supervisors.read")!({}),act=(input:any)=>handlers.get("firstmate.watch.supervisors.act-ui")!(input);
 const gate=cutoverGate(f.home),original=gate.watchRoute.bind(gate);let fail=true;
 const spy=vi.spyOn(gate,"watchRoute").mockImplementation(async(...args)=>{if(args[2]==="committed"&&fail){fail=false;throw Error("synthetic crash after config receipt before gate commit");}return original(...args);});
 try{
  const s=await read(),prepared=await act({op:"prepare",requestId:randomUUID(),expectedGeneration:0,target:s.targets.find((t:any)=>t.name==="one")});
  const request={op:"commit",requestId:randomUUID(),homeId:s.homeId,name:"one",assignmentRequestId:prepared.watches[0].assignment.requestId,assignmentDigest:prepared.watches[0].assignmentDigest};
  await expect(act(request)).rejects.toThrow("synthetic crash");spy.mockRestore();
  // Fresh app handler, same persisted files, replay original request after a lost reply.
  new WatchSupervisors(runtime,{runner:{queued:async()=>[]},pendingInspections:async()=>[]} as never).register({handle:(rpc:{name:string},run:(input:any)=>Promise<any>)=>handlers.set(rpc.name,run)} as never);
  const replay=await act(request);console.log("R2-F4",{shown:replay.watches[0].assignment.stage,transport:(await gate.readWatchRoute("one"))?.stage,problems:replay.problems});
  expect((await gate.readWatchRoute("one"))?.stage).toBe("committed");
 }finally{spy.mockRestore();await runtime.stop();}
});

