import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {AttachConfirmation} from "../../client/supervision-activation";
import {SupervisorDetailView} from "../../client/supervisor-controls";
import {SupervisorProfileFields} from "../../client/supervisor-profile";
import {theme as dark} from "../board-list/theme";
const args=new URLSearchParams(location.search),scene=args.get("scene")??"attach",compact=innerWidth<600;
const light={colors:{...dark.colors,surface0:"#ffffff",surface1:"#f4f6f5",surface2:"#e8ecea",border:"#a8b5ad",foreground:"#17211b",foregroundMuted:"#4d5c53",accent:"#17603b",accentForeground:"#ffffff"}};
const theme=args.get("theme")==="light"?light:dark;
document.documentElement.style.setProperty("--surface",theme.colors.surface0);document.documentElement.style.setProperty("--ink",theme.colors.foreground);document.documentElement.style.setProperty("--border",theme.colors.border);
window.fixtureCalls=[];window.actions=[];
const id="00000000-0000-4000-8000-000000000001",request="00000000-0000-4000-8000-000000000002",hash="a".repeat(64);
const profile={provider:"codex/gpt-6.1-sol",modeId:"full-access",thinkingOptionId:"high"};
window.supervisorCatalog=[{provider:profile.provider,label:"Sol 6.1",modes:[{id:"full-access",label:"Full access"}],thinking:[{id:"high",label:"High"},{id:"xhigh",label:"Extra high"}]}];
const config={id:request,scopeId:id,generation:1,requested:profile,resolved:profile,catalogDigest:hash,policyDigest:hash,target:{homeId:"fixture-home",hostId:"local",scopeId:id,kind:"plan",planId:"local-export",planHash:hash},limits:{supervisorSessions:3,supervisorTurns:10},effectiveEpoch:1,provenance:"client UI (unverified)"};
const pending={...config,id:"00000000-0000-4000-8000-000000000003",generation:2,resolved:{...profile,thinkingOptionId:"xhigh"},effectiveEpoch:2};
const pendingScene=["pending","stale-proposal","undelivered"].includes(scene);
const data={homeId:"fixture-home",scopeId:id,title:"Finish the local export plan",planHash:hash,catalog:window.supervisorCatalog,policyDigest:hash,limits:config.limits,problems:scene==="stale-proposal"?["The reviewed catalog or plan changed. Withdraw this exact proposal to review again."]:scene==="stale"?["This host is offline. Reconnect and review the exact target again."]:[],view:{scopeId:id,binding:{scopeId:id,epoch:1,agentId:"00000000-0000-4000-8000-000000000004",hostId:"local",workspaceId:"synthetic-workspace",profileDigest:hash,checkpointHash:hash,acknowledgedSeq:0,heartbeatDue:null,state:"active",configurationId:request},reservedOwnerInputs:scene==="undelivered"?[{id:request,version:1,payloadDigest:hash,preview:"Keep this original queued checkpoint input. It has never been sent."}]:[],pendingDigest:hash,replacementResume:null,bindingDigest:hash,controlId:pendingScene?pending.id:scene==="paused"?request:null,state:pendingScene?"change-pending":scene==="paused"?"paused":scene==="uncertain"?"uncertain":"active",configurations:pendingScene?[config,pending]:[config],pending:pendingScene?pending:null,sessions:1,turns:3,obligations:{uncertain:scene==="uncertain"?["exact-unknown-send"]:[],reserved:scene==="undelivered"?[request]:[],workers:[],decisions:[],outbox:[],sources:[],unlanded:["export-build"]},retirement:"Retirement requires disposition of retained effects, workers, decisions, sources and unlanded artifacts. No workspace or history is deleted."}};
const plan={plan:"local-export",title:data.title,hash,scopeId:id,scopeVersion:1,supervisorId:"00000000-0000-4000-8000-000000000004",canAttach:true,binding:null,opening:null};
function App(){const [choice,choose]=useState(profile);return <main style={{padding:compact?10:24,background:theme.colors.surface0,color:theme.colors.foreground,minHeight:"100vh"}}>
{scene==="attach"?<AttachConfirmation theme={theme} compact={compact} homeId={data.homeId} plan={plan} stale={false} onClose={()=>window.actions.push("close")} onRead={()=>window.actions.push("read")} />:
scene==="observer"?<section style={{maxWidth:680,margin:"auto"}}><h2>Inspect backup checks</h2><SupervisorProfileFields theme={theme} compact={compact} catalog={window.supervisorCatalog} profile={choice} onChange={choose} observer/><p>Standalone watch observation remains unavailable on this execution-only profile. No inspector is created.</p></section>:
<section style={{maxWidth:680,margin:"auto"}}><SupervisorDetailView theme={theme} compact={compact} data={data} onAction={v=>window.actions.push(v)} onOpen={()=>window.actions.push("native-link")}/></section>}
</main>}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><App/></QueryClientProvider>);
