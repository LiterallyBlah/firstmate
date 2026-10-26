/** Pure v4 normal admission: required workload roles are distinct from the complete bounded owned set. */
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {memberPhaseAssessment,retainedResourceErrorsAbsent} from './member-phase.mjs';
import {membershipSnapshot,standardWiringComplete,outputComplete} from './capture.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const uuid=v=>typeof v==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export function memberTransport(input,sourceSha256) {
  const reasons=[],require=(ok,why)=>{if(!ok)reasons.push(why);};let frame=null,file=null;
  const stream=(v,limit)=>outputComplete(v) && v.encoding==='base64' && typeof v.data==='string' && v.bytes<=limit &&
    Buffer.from(v.data,'base64').length===v.bytes && Buffer.from(v.data,'base64').toString('base64')===v.data;
  try {if(!stream(input.outer?.stdout,32768))throw Error();const raw=Buffer.from(input.outer.stdout.data,'base64');
    if(!/^[^\r\n]+\r?\n$/.test(raw.toString('utf8')))throw Error();frame=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{reasons.push('member-final-frame-invalid');}
  try {if(!Buffer.isBuffer(input.helperFileRaw)||input.helperFileRaw.length===0||input.helperFileRaw.length>2097152)throw Error();
    file=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(input.helperFileRaw));}catch{reasons.push('member-raw-file-invalid');}
  const id=v=>v?.scenario==='normal' && v.caseId===input.caseId && v.nonce===input.nonce && v.sourceSha256===sourceSha256;
  require(uuid(input.caseId)&&uuid(input.nonce)&&input.caseId!==input.nonce,'member-case-identity');
  require(frame?.format==='firstmate.member-normal-final/1'&&file?.format==='firstmate.member-normal/1'&&id(frame)&&id(file),'member-envelope-identity');
  require(frame?.file?.name==='member-normal-helper.json'&&frame.file.complete===true&&Buffer.isBuffer(input.helperFileRaw)&&
    frame.file.bytes===input.helperFileRaw.length&&frame.file.sha256===sha(input.helperFileRaw),'member-file-digest-length-disposal');
  require(frame?.invocationError===null&&frame?.recordingError===null&&file?.invocationError===null&&file?.recordingError===null,'member-invocation-recording-error');
  const n=file?.nativeResult;
  require(n&&frame?.originalFailure?.value===(n.originalFailure??null)&&frame.originalFailure.truncated===n.originalFailureTruncated&&
    frame.originalFailure.state===(typeof n.originalFailure==='string'?'recorded':n.originalFailure===null?'none-recorded':'unavailable'),'member-original-failure-disagreement');
  require(stream(input.outer?.stderr,65536)&&input.outer.stderr.bytes===0&&input.outer?.error===null&&input.outer.exitObserved===true&&
    input.outer.closed===true&&input.outer.exitSignal===null&&input.outer.signal===null&&input.outer.exitStatus===input.outer.status&&
    input.outer.status===(n?.error===null?0:2)&&input.outer.deadlineFired===false,'member-helper-final-incomplete');
  require(input.outer?.observation?.dropped===0&&input.outer.observation.failures===0&&input.outer.observation.errors?.length===0&&
    Array.isArray(input.readErrors)&&input.readErrors.length===0,'member-observation-or-read-loss');
  return {complete:reasons.length===0,reasons,frame,file};
}
export function interpretMemberNormal(input,sourceSha256) {
  const transport=memberTransport(input,sourceSha256),n=transport.file?.nativeResult,phase=memberPhaseAssessment(input,n);
  const captureReasons=new Set(transport.reasons),requireCapture=(ok,why)=>{if(!ok)captureReasons.add(why);};
  requireCapture(input.scenario==='normal'&&phase.complete,'member-normal-contract-or-phase-incomplete');
  const lives=n?.lifetimes??[],root=lives.find(l=>l.bindingRef?.role==='root'),rootId=root?.initial?.identity;
  const owner=n?.events?.find(e=>e.kind==='owner-acquired')?.data,fresh=membershipSnapshot(n?.freshOwner),before=membershipSnapshot(n?.beforeResume);
  const event=k=>n?.events?.findIndex(e=>e.kind===k)??-1;
  const sourceBound=transport.complete&&phase.rootBound&&rootId?.image===input.nodePath&&Number.isSafeInteger(input.outer?.helperPid)&&input.outer.helperPid>0&&
    owner?.helperPid===input.outer.helperPid&&owner?.flags===8192&&equal(owner?.members,n?.freshOwner)&&fresh.complete&&fresh.total===0&&fresh.active===0&&
    before.complete&&before.pids.includes(rootId?.pid)&&n?.targetCreated===true&&event('owner-acquired')>=0&&
    event('creation-owner-configured')>event('owner-acquired')&&event('deadline-armed')>event('creation-owner-configured')&&
    event('suspended-root-owned')>event('deadline-armed')&&event('root-resumed')>event('suspended-root-owned')&&
    n?.events?.find(e=>e.kind==='deadline-armed')?.data?.durationMs===5000&&n?.targetResumed===true;
  requireCapture(sourceBound,'member-source-root-owner-or-deadline-order');
  const inventory=n?.handleInventory??{},allowed=new Set(['job','thread','stdin',...lives.map(l=>l.bindingRef?.role)]);
  const acquired=Object.values(inventory).filter(v=>v.acquisition==='acquired');
  const resources=['job','thread','stdin'].every(role=>inventory[role]?.acquisition==='acquired'&&inventory[role].disposition==='closed')&&
    Object.entries(inventory).every(([role,v])=>allowed.has(role)||(role==='child'&&v.acquisition==='never-acquired'&&v.disposition==='not-attempted'))&&
    acquired.every(v=>v.disposition==='closed')&&new Set(acquired.map(v=>v.handle)).size===acquired.length&&n?.cleanup?.timerDrained===true&&
    n?.cleanup?.jobHandleClosed===true&&n?.cleanup?.threadHandleClosed===true&&n?.stdinClosed===true&&standardWiringComplete(n?.standardWiring)&&retainedResourceErrorsAbsent(n);
  requireCapture(resources,'member-resource-disposal-or-wiring-incomplete');
  const encodedOutput=v=>outputComplete(v)&&v.encoding==='base64'&&
    typeof v.data==='string'&&Buffer.from(v.data,'base64').length===v.retained&&Buffer.from(v.data,'base64').toString('base64')===v.data;
  const nativeOutput=v=>encodedOutput(v)&&v.readDisposition==='closed'&&v.writeDisposition==='closed';
  const rootOutputComplete=nativeOutput(n?.rootOutput?.stdout)&&nativeOutput(n?.rootOutput?.stderr);
  requireCapture(rootOutputComplete,'member-root-output-incomplete');
  const closure=Boolean(sourceBound&&phase.closed&&resources&&rootOutputComplete);
  const normalReasons=new Set(captureReasons),requireNormal=(ok,why)=>{if(!ok)normalReasons.add(why);};
  requireNormal(!n?.events?.some(e=>e.kind==='offending-membership'),'retained-offending-membership');
  const rawCommit=(name,raw,parsed)=>{
    try {const native=n?.committedEntries?.[name];return Buffer.isBuffer(raw)&&raw.length>0&&raw.length<=4096&&
      equal(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),parsed)&&native?.rawBase64===raw.toString('base64')&&equal(native.value,parsed);}
    catch{return false;}
  };
  const parent=input.rootEntry,child=input.childEntry,pre=input.rootPreSpawn;
  const entry=(v,pid)=>v?.caseId===input.caseId&&v.nonce===input.nonce&&v.scenario==='normal'&&v.pid===pid&&v.node===input.nodeVersion&&
    v.threadId===0&&v.isMainThread===true&&uuid(v.instance);
  const childLife=lives.find(l=>l.initial?.identity?.pid===child?.pid),childId=childLife?.initial?.identity;
  const bindings=n?.workloadBindings;
  const requiredRoles=entry(parent,rootId?.pid)&&entry(child,childId?.pid)&&entry(pre,rootId?.pid)&&childLife!==root&&childId?.image===input.nodePath&&
    childId?.pid!==rootId?.pid&&parent?.childPid===childId?.pid&&child?.ppid===rootId?.pid&&parent?.ppid===owner?.helperPid&&pre?.ppid===parent?.ppid&&
    pre?.instance===parent?.instance&&parent?.instance!==child?.instance&&pre?.format==='firstmate.root-pre-spawn/1'&&pre.stage==='before-child-spawn'&&
    pre.childEntry===input.childScriptPath&&equal(bindings?.root,root?.bindingRef)&&equal(bindings?.expectedChild,childLife?.bindingRef)&&
    phase.boundPids.includes(childId?.pid)&&rawCommit('root-pre-spawn.json',input.markerRaw,pre)&&rawCommit('root-entry.json',input.rootEntryRaw,parent)&&
    rawCommit('child-entry.json',input.childEntryRaw,child)&&input.entryPartialsPresent===false;
  requireNormal(requiredRoles,'required-committed-root-or-expected-child-unbound');
  const boundEvent=n?.events?.find(e=>e.kind==='required-workload-bound'),releaseEvent=n?.events?.find(e=>e.kind==='normal-release');
  requireNormal(event('required-workload-bound')>event('root-resumed')&&event('normal-release')>event('required-workload-bound')&&
    event('normal-owned-set-empty')>event('normal-release')&&equal(boundEvent?.data?.bindings,bindings)&&equal(boundEvent?.data?.members,n?.liveMembers)&&
    boundEvent?.data?.members?.pids?.includes(rootId?.pid)&&boundEvent?.data?.members?.pids?.includes(childId?.pid)&&
    equal(releaseEvent?.data?.workloadBindings,bindings),'member-workload-release-order-or-binding');
  requireNormal(n?.error===null&&n?.originalFailure===null&&n?.originalFailureTruncated===false&&n?.deadlineFired===false&&
    n?.terminateRequested===false&&n?.normalExited===true&&root?.terminal?.exit?.code===0&&childLife?.terminal?.exit?.code===0,'member-normal-outcome-or-deadline');
  requireNormal(input.rootResult?.childCode===0&&input.rootResult.childSignal===null&&input.childResult?.fulfilled===true,'member-original-results-incomplete');
  requireNormal(encodedOutput(input.childOutput?.stdout)&&encodedOutput(input.childOutput?.stderr),'member-child-output-incomplete');
  requireNormal(closure,'member-owned-set-closure-unknown');
  const passed=normalReasons.size===0;
  const {helperFileRaw,markerRaw,rootEntryRaw,childEntryRaw,...retained}=input;
  return {...retained,format:'firstmate.member-normal-capture/1',native:n??null,helperFile:transport.file,helperFinal:transport.frame,
    transport:{complete:transport.complete,reasons:transport.reasons},phase,captureComplete:captureReasons.size===0,captureReasons:[...captureReasons],
    requiredWorkloadRolesConfirmed:Boolean(requiredRoles),normalReasons:[...normalReasons],normalQualificationPassed:passed,
    ownedSetClosureConfirmed:closure,closureState:closure?'confirmed':'unknown',safeForReuse:passed,
    actualRuntimeQualified:false,anotherCaseAuthorized:false,historicalClosures:['C2:failed/unknown','normal1:failed/unknown','normal2:failed/unknown']};
}
