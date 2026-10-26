// Synthetic in-memory v4 evidence. Never imports/executes workload, controller, native helper or DLL.
import {createHash} from 'node:crypto';
import {gateInput} from './root-gate-input.mjs';
export const MEMBER_TEST_SHA='d'.repeat(64);
const copy=structuredClone,hash=b=>createHash('sha256').update(b).digest('hex');
export function refreshMember(input) {
  const file={format:'firstmate.member-normal/1',scenario:'normal',caseId:input.caseId,nonce:input.nonce,sourceSha256:MEMBER_TEST_SHA,
    nativeResult:input.native,invocationError:null,recordingError:null};
  input.helperFileRaw=Buffer.from(JSON.stringify(file));
  const frame={format:'firstmate.member-normal-final/1',scenario:'normal',caseId:input.caseId,nonce:input.nonce,sourceSha256:MEMBER_TEST_SHA,
    file:{name:'member-normal-helper.json',complete:true,bytes:input.helperFileRaw.length,sha256:hash(input.helperFileRaw)},
    invocationError:null,recordingError:null,originalFailure:{state:input.native.originalFailure===null?'none-recorded':'recorded',
      value:input.native.originalFailure,truncated:input.native.originalFailureTruncated}};
  const raw=Buffer.from(JSON.stringify(frame)+'\n');input.outer.stdout={bytes:raw.length,retained:raw.length,dropped:0,errors:0,drained:true,closed:true,encoding:'base64',data:raw.toString('base64')};
  return input;
}
export function commitMember(input) {
  for(const[name,field,rawField]of [['root-pre-spawn.json','rootPreSpawn','markerRaw'],['root-entry.json','rootEntry','rootEntryRaw'],['child-entry.json','childEntry','childEntryRaw']]) {
    input[rawField]=Buffer.from(JSON.stringify(input[field]));
    input.native.committedEntries[name]={rawBase64:input[rawField].toString('base64'),value:copy(input[field])};
  }
  return input;
}
export function memberInput({extras=1}={}) {
  // Reuse only the tiny data factory's generic lifetime shapes, not its root-gate receipt/transport or policy.
  const input=gateInput({extra:extras+1,marker:false}),n=input.native;
  input.scenario='normal';input.entryPartialsPresent=false;
  input.caseId='0d258e54-3bbe-4e10-9edf-f2b55736941a';input.nonce='4637b177-3c51-495f-9095-d79181118466';
  const lives=n.lifetimes;
  lives[1].initial.identity.image=input.nodePath;
  for(const life of lives)life.terminal.exit.code=0;
  const before=n.beforeResume,live={...copy(n.gateSnapshot),phase:'normal-live'},final=copy(n.terminalEvidence);
  for(const row of final.processes)row.exit.code=0;
  n.scenario='normal';n.contract='required-workload-and-owned-set/1';n.captureVersion=4;n.diagnosticVersion=3;
  for(const key of ['expectedChild','childSpawnReachable','stopReason','markerObservedBeforeStop','markerReadback','gateSnapshot'])delete n[key];
  n.liveMembers=live;n.lastNormalMembers={...copy(final.members),phase:'success-terminal'};n.normalExited=true;
  n.terminalEvidence=final;n.terminalSamples=[copy(final)];n.lastObservation=copy(final.members);n.terminateRequested=false;n.terminateReturned=false;
  for(const life of lives)n.handleInventory[life.bindingRef.role].observation=copy(life.terminal);
  n.workloadBindings={root:copy(lives[0].bindingRef),expectedChild:copy(lives[1].bindingRef)};
  n.events=[{kind:'membership',data:copy(n.freshOwner)},{kind:'owner-acquired',data:{helperPid:50,flags:8192,members:copy(n.freshOwner)}},
    {kind:'creation-owner-configured',data:{attribute:'PROC_THREAD_ATTRIBUTE_JOB_LIST'}},{kind:'deadline-armed',data:{durationMs:5000}},
    {kind:'handle-observation',data:copy(lives[0].initial)},{kind:'membership',data:copy(before)},
    {kind:'suspended-root-owned',data:copy(lives[0].bindingRef)},{kind:'root-resumed',data:{previousSuspendCount:1}},
    {kind:'membership',data:copy(live)},...lives.slice(1).map(l=>({kind:'handle-observation',data:copy(l.initial)})),
    {kind:'required-workload-bound',data:{bindings:copy(n.workloadBindings),members:copy(live)}},
    {kind:'normal-release',data:{workloadBindings:copy(n.workloadBindings)}},{kind:'membership',data:copy(n.lastNormalMembers)},
    {kind:'normal-owned-set-empty',data:copy(n.lastNormalMembers)},...lives.map(l=>({kind:'gate-handle-observation',data:copy(l.terminal)}))];
  n.committedEntries={};
  const entry=(pid,ppid,instance)=>({scenario:'normal',caseId:input.caseId,nonce:input.nonce,pid,ppid,instance,node:input.nodeVersion,threadId:0,isMainThread:true});
  input.rootEntry={...entry(100,50,'ec22fa66-63ba-4a11-a9c8-4396f1f216d9'),childPid:101};
  input.childEntry=entry(101,100,'fc22fa66-63ba-4a11-a9c8-4396f1f216d9');
  input.rootPreSpawn={...entry(100,50,input.rootEntry.instance),format:'firstmate.root-pre-spawn/1',stage:'before-child-spawn',childEntry:input.childScriptPath};
  input.rootResult={childCode:0,childSignal:null};input.childResult={fulfilled:true};
  input.childOutput=copy(n.rootOutput);
  commitMember(input);return refreshMember(input);
}
