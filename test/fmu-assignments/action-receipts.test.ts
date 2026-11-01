import {randomUUID} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {expect,it} from "vitest";
import {s04Fixture} from "../supervision-s04-fixture";
import {updateFirstmateConfig} from "../../server/config";
import {SupervisionRuntime} from "../../server/supervision-runtime";
import {WatchSupervisors} from "../../server/watch-supervisors";
it("A1/A8: exact app action replay never reapplies an old unassign after resume; stale/concurrent controls refuse",async()=>{
 const f=await s04Fixture(),scope=await f.addScope(1,"plan",["build"]);
 await f.draft(scope,[{id:"build"}]);await f.launch(scope,"build");
 await mkdir(join(f.home,"watches"),{recursive:true});await writeFile(join(f.home,"watches","checks"),"#!/usr/bin/env node\n// schedule: * * * * *\n");
 await updateFirstmateConfig({home:f.home});await updateFirstmateConfig({mateAgentId:"general"});
 const runtime=new SupervisionRuntime(join(f.home,"runtime"),()=>f.store);await runtime.mutate(f.home,async()=>{});
 const service=new WatchSupervisors(runtime,{runner:{queued:async()=>[]},pendingInspections:async()=>[]} as never);
 const handlers=new Map<string,(input:any)=>Promise<any>>();
 service.register({handle:(rpc:{name:string},run:(input:any)=>Promise<any>)=>handlers.set(rpc.name,run)} as never);
 const read=()=>handlers.get("firstmate.watch.supervisors.read")!({}),act=(input:any)=>handlers.get("firstmate.watch.supervisors.act-ui")!(input);
 try{
  const before=await read(),prepared=await act({op:"prepare",requestId:randomUUID(),expectedGeneration:0,target:before.targets.find((t:any)=>t.name==="checks")});
  const input=(op:string,s:any)=>({op,requestId:randomUUID(),homeId:s.homeId,name:"checks",assignmentRequestId:s.watches[0].assignment.requestId,assignmentDigest:s.watches[0].assignmentDigest});
  const commit=input("commit",prepared),committed=await act(commit),unassign=input("unassign",committed),paused=await act(unassign);
  const resume=input("resume",paused),resumed=await act(resume);expect(resumed.watches[0].assignment.stage).toBe("committed");
  await act(unassign);await act(commit);expect((await read()).watches[0].assignment.stage).toBe("committed");
  await expect(act({...unassign,op:"resume"})).rejects.toThrow(/different|conflict/);
  await expect(act({...unassign,requestId:randomUUID()})).rejects.toThrow(/changed/);
  const competing=input("unassign",resumed),results=await Promise.allSettled([act(competing),act({...competing,requestId:randomUUID()})]);
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  expect((await f.store.read()).sources.bindings.filter(b=>b.kind==="watch")).toHaveLength(1);
 }finally{await runtime.stop();}
});
