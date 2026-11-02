import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { attentionTheme as theme } from "../test/attention-deck-fixture";
import type { WatchSupervisorSnapshot } from "../shared/watch-routing";
const calls = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: (r: {name:string}) => r.name.endsWith("act-ui") ? calls.write : calls.read }));
vi.mock("react-native", () => ({ Pressable: "Pressable", Text: "Text", View: "View" }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Modal: Object.assign(({children}:{children:ReactNode})=>children, {Content:"Content"}) }));
vi.mock("./workflow-plans", () => ({ workflowRequestId:()=>"00000000-0000-4000-8000-000000000009" }));
import { WatchSupervisorButton, WatchAssignmentReview } from "./watch-supervisors";
const id="00000000-0000-4000-8000-000000000001", hash="a".repeat(64);
const target={homeId:"home",hostId:"local" as const,name:"checks",definitionDigest:hash,scopeId:id,taskId:id,attemptId:id,planId:"trial",planHash:hash,
 planRevision:1,owner:{agentId:id,epoch:1,profileDigest:hash},policyDigest:hash};
const data:WatchSupervisorSnapshot={homeId:"home",watches:[{name:"checks",definitionDigest:hash,assignment:null}],targets:[target],owners:[{scopeId:id,profile:"codex/sol · full-access · high",remainingSessions:1,remainingTurns:7}],observer:{available:false,reason:"Read-only adapter unqualified; full-access is not read-only."},problems:[]};
let renderer:ReactTestRenderer|undefined;const cache=new QueryClient({defaultOptions:{queries:{retry:false}}});
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
afterEach(async()=>{await act(async()=>renderer?.unmount());renderer=undefined;cache.clear();vi.clearAllMocks();});
const button=(label:string)=>renderer!.root.find(n=>n.type==="Pressable" as never&&n.props.accessibilityLabel===label);
it.each([{}, {name:"checks"}, {planId:"trial"}])("A1/A11: shared entry %j is inert until opened and reads the same snapshot",async entry=>{
 calls.read.mockResolvedValue(data);await act(async()=>{renderer=create(createElement(QueryClientProvider,{client:cache},createElement(WatchSupervisorButton,{theme,...entry})));});
 expect(calls.read).not.toHaveBeenCalled();expect(calls.write).not.toHaveBeenCalled();
 await act(async()=>button("name" in entry?"Supervisor for checks":"Assign watch inputs").props.onPress());
 await vi.waitFor(async()=>{await act(async()=>{await new Promise(r=>setTimeout(r,0));});expect(button(`Review checks to trial · ${id}`)).toBeDefined();});
 expect(calls.read).toHaveBeenCalledWith({});expect(calls.write).not.toHaveBeenCalled();
});
it("A1/A11: review captures exact target and stale subject cannot submit",async()=>{
 const onAction=vi.fn(), view=(d:WatchSupervisorSnapshot)=>createElement(WatchAssignmentReview,{theme,data:d,name:"checks",onAction});
 await act(async()=>{renderer=create(view(data));});await act(async()=>button(`Review checks to trial · ${id}`).props.onPress());
 expect(onAction).not.toHaveBeenCalled();expect(button("Prepare reviewed watch assignment").props.disabled).toBe(false);
 await act(async()=>button("Prepare reviewed watch assignment").props.onPress());expect(onAction.mock.calls[0]![0].target).toEqual(target);
 await act(async()=>renderer!.update(view({...data,targets:[{...target,planHash:"b".repeat(64)}]})));
 expect(button("Prepare reviewed watch assignment").props.disabled).toBe(true);
 expect(button("Enable independent read-only observer unavailable").props.disabled).toBe(true);
});
it.each(["prepared", "committed", "paused"] as const)("A11: accepted %s route hides the completed prepare review while retaining exact controls", async stage => {
 const onAction=vi.fn(), view=(d:WatchSupervisorSnapshot)=>createElement(WatchAssignmentReview,{theme,data:d,name:"checks",onAction});
 await act(async()=>{renderer=create(view(data));});
 await act(async()=>button(`Review checks to trial · ${id}`).props.onPress());
 expect(button("Prepare reviewed watch assignment")).toBeDefined();
 const assignment={requestId:id,signature:hash,generation:1,stage,target,pending:[]};
 await act(async()=>renderer!.update(view({...data,watches:[{...data.watches[0]!,assignment,assignmentDigest:hash}]})));
 expect(renderer!.root.findAll(n=>n.type==="Pressable" as never&&n.props.accessibilityLabel==="Prepare reviewed watch assignment")).toHaveLength(0);
 expect(onAction).not.toHaveBeenCalled();
});
