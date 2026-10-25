/** Distinct root-only gate verdict. It never admits a normal workload. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { phaseAssessment } from './phase-capture.mjs';
import { membershipSnapshot, standardWiringComplete } from './capture.mjs';
const sha = b=>createHash('sha256').update(b).digest('hex');
export function rootGateTransport(input,sourceSha256) {
  const reasons=[], require=(ok,why)=>{if(!ok)reasons.push(why);}; let frame=null,file=null;
  const stream=(value,limit)=>{
    if(!value || value.encoding!=='base64' || value.drained!==true || value.closed!==true || value.dropped!==0 || value.errors!==0 ||
      !Number.isSafeInteger(value.bytes) || value.bytes<0 || value.retained!==value.bytes || value.bytes>limit || typeof value.data!=='string')return false;
    const bytes=Buffer.from(value.data,'base64');return bytes.length===value.bytes && bytes.toString('base64')===value.data;
  };
  try { if(!stream(input.outer?.stdout,32768))throw Error(); const bytes=Buffer.from(input.outer.stdout.data,'base64');
    if(!/^[^\r\n]+\r?\n$/.test(bytes.toString('utf8')))throw Error(); frame=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }catch{reasons.push('gate-final-frame-invalid');}
  try { if(!Buffer.isBuffer(input.helperFileRaw)||input.helperFileRaw.length>2097152)throw Error();file=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(input.helperFileRaw)); }
  catch{reasons.push('gate-raw-file-invalid');}
  const id=v=>v?.scenario==='root-gate' && v.caseId===input.caseId && v.nonce===input.nonce && v.sourceSha256===sourceSha256;
  require(frame?.format==='firstmate.root-gate-final/1' && file?.format==='firstmate.root-gate/1' && id(frame)&&id(file),'gate-envelope-identity');
  require(frame?.file?.name==='root-gate-helper.json' && frame.file.complete===true && Buffer.isBuffer(input.helperFileRaw) &&
    frame.file.bytes===input.helperFileRaw.length && frame.file.sha256===sha(input.helperFileRaw),'gate-file-digest-length-disposal');
  require(frame?.invocationError===null && frame?.recordingError===null && file?.invocationError===null && file?.recordingError===null,'gate-invocation-or-recording-error');
  const n=file?.nativeResult;
  require(n && frame?.originalFailure?.value===(n.originalFailure??null) && frame.originalFailure.truncated===n.originalFailureTruncated &&
    frame.originalFailure.state===(typeof n.originalFailure==='string'?'recorded':n.originalFailure===null?'none-recorded':'unavailable'),'gate-original-failure-disagreement');
  require(stream(input.outer?.stderr,65536) && input.outer.stderr.bytes===0 && input.outer?.exitObserved===true && Number.isInteger(input.outer.exitStatus) && input.outer.exitStatus===input.outer.status && input.outer.exitSignal===null &&
    input.outer.closed===true && input.outer.signal===null && input.outer.error===null && input.outer.deadlineFired===false,'gate-outer-final-incomplete');
  require(input.outer?.exitStatus===0,'gate-helper-exit-not-zero');
  require(input.outer?.observation?.dropped===0 && input.outer.observation.failures===0 && input.readErrors?.length===0,'gate-read-or-observation-loss');
  return {complete:reasons.length===0,integrityComplete:reasons.every(r=>r==='gate-helper-exit-not-zero'),reasons,frame,file};
}
export function interpretRootGate(input,sourceSha256) {
  const transport=rootGateTransport(input,sourceSha256),n=transport.file?.nativeResult,phase=phaseAssessment(input,n);
  const reasons=new Set(transport.reasons),require=(ok,why)=>{if(!ok)reasons.add(why);};
  require(input.scenario==='root-gate' && n?.scenario==='root-gate' && n?.expectedChild==='not-part-of-root-gate' && n?.childSpawnReachable===false,'root-only-scenario-contract');
  require(phase.complete,'gate-phase-capture-incomplete');
  const root=phase.rootBinding,marker=input.rootPreSpawn,owner=n?.events?.find(e=>e.kind==='owner-acquired')?.data;
  require(root?.image?.toLowerCase()===input.nodePath?.toLowerCase() && owner?.helperPid===input.outer?.helperPid,'gate-root-or-helper-identity');
  const fresh=membershipSnapshot(n?.freshOwner),before=membershipSnapshot(n?.beforeResume);
  require(fresh.complete && fresh.total===0 && fresh.active===0 && owner?.flags===8192 && n?.targetCreated===true,'gate-fresh-creation-owner-missing');
  require(before.complete && before.pids.includes(root?.pid),'gate-pre-resume-root-not-owned');
  const event=k=>n?.events?.findIndex(e=>e.kind===k)??-1;
  require(event('owner-acquired')>=0 && event('creation-owner-configured')>event('owner-acquired') && event('deadline-armed')>event('creation-owner-configured') &&
    (n?.targetResumed===true ? event('root-resumed')>event('deadline-armed') : n?.targetResumed===false && event('root-resumed')===-1),'gate-owner-or-deadline-order');
  require(equal(owner?.members,n?.freshOwner) && (!n?.targetResumed || before.total===1 && before.active===1 && before.pids[0]===root?.pid),'gate-owner-readback-or-resume-inconsistent');
  let markerMatches=false;
  try{markerMatches=Buffer.isBuffer(input.markerRaw) && input.markerRaw.length<=4096 && equal(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(input.markerRaw)),marker);}catch{}
  const markerValid=Boolean(markerMatches && marker && marker.format==='firstmate.root-pre-spawn/1' && marker.stage==='before-child-spawn' && marker.scenario==='root-gate' &&
    marker.caseId===input.caseId && marker.nonce===input.nonce && marker.pid===root?.pid && marker.ppid===owner?.helperPid && marker.node===input.nodeVersion && marker.threadId===0 &&
    marker.isMainThread===true && marker.childEntry===input.childScriptPath && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(marker.instance) &&
    Buffer.isBuffer(input.markerRaw) && input.markerRaw.length<=4096);
  const snapshot=membershipSnapshot(n?.gateSnapshot);
  const sourceRootBound=transport.integrityComplete && phase.rootBound===true && root?.image?.toLowerCase()===input.nodePath?.toLowerCase() &&
    owner?.helperPid===input.outer?.helperPid && owner?.flags===8192 && fresh.complete && fresh.total===0 && fresh.active===0 &&
    n?.targetCreated===true && n?.childSpawnReachable===false && n?.scenario==='root-gate';
  const extraObserved=sourceRootBound && phase.extraMemberBound && snapshot.complete && snapshot.pids.some(pid=>pid!==root?.pid && phase.boundPids.includes(pid));
  const gateReached=sourceRootBound && markerValid && n?.markerObservedBeforeStop===true && n?.stopReason==='marker' && n?.targetResumed===true &&
    before.total===1 && before.active===1 && snapshot.complete && snapshot.total===1 && snapshot.active===1 && snapshot.pids[0]===root?.pid;
  const refusedExtra=extraObserved && ((n?.stopReason==='unexpected-member' && n.targetResumed===true) ||
    (n?.stopReason==='unexpected-before-resume' && n.targetResumed===false && before.pids.some(pid=>pid!==root?.pid && phase.boundPids.includes(pid))));
  require(gateReached || refusedExtra,'gate-marker-or-captured-refusal-missing');
  require(n?.error===null && n?.originalFailure===null && n?.originalFailureTruncated===false && n?.deadlineFired===false,'gate-original-failure-or-deadline');
  require(n?.terminateRequested===true && n.terminateReturned===true && n.terminationError===0,'gate-owned-stop-unconfirmed');
  require(n?.lifetimes?.find(l=>l.bindingRef?.role==='root')?.terminal?.exit?.code===197,'gate-root-exit-not-owned-stop');
  const completeOutput=v=>Boolean(v && v.bytes===v.retained && v.bytes>=0 && v.bytes<=65536 && v.dropped===0 && v.errors===0 && v.drained===true && v.closed===true &&
    v.readDisposition==='closed' && v.writeDisposition==='closed' && v.encoding==='base64' && Buffer.from(v.data??'','base64').length===v.retained && Buffer.from(v.data??'','base64').toString('base64')===v.data);
  require(completeOutput(n?.rootOutput?.stdout)&&completeOutput(n?.rootOutput?.stderr),'gate-root-output-incomplete');
  const inventory=n?.handleInventory??{},acquired=Object.values(inventory).filter(v=>v.acquisition==='acquired');
  const allowed=new Set(['job','thread','stdin',...(n?.lifetimes??[]).map(l=>l.bindingRef?.role)]);
  const resources=['job','thread','stdin'].every(role=>inventory[role]?.acquisition==='acquired' && inventory[role].disposition==='closed') &&
    Object.entries(inventory).every(([role,v])=>allowed.has(role) || (role==='child' && v.acquisition==='never-acquired' && v.disposition==='not-attempted')) &&
    acquired.every(v=>v.disposition==='closed') && new Set(acquired.map(v=>v.handle)).size===acquired.length &&
    n?.cleanup?.timerDrained===true && n.cleanup.jobHandleClosed===true && n.cleanup.threadHandleClosed===true && n.stdinClosed===true;
  require(resources && standardWiringComplete(n?.standardWiring),'gate-resource-disposal-or-wiring-incomplete');
  const closure=transport.complete===true && phase.closed===true && resources===true && sourceRootBound===true && n?.expectedChild==='not-part-of-root-gate';
  const {helperFileRaw,markerRaw,...retained}=input;
  return {...retained,format:'firstmate.root-gate-capture/1',native:n??null,helperFinal:transport.frame,helperFile:transport.file,
    transport:{complete:transport.complete,reasons:transport.reasons},phase,reasons:[...reasons],captureComplete:reasons.size===0,
    gateReached,gateVerdict:gateReached?'marker-reached':refusedExtra?'refused-extra-member':'inconclusive',
    discrimination:extraObserved?'extra-member-observed-without-child-call':'inconclusive',
    ownedSetClosureConfirmed:closure,closureState:closure?'confirmed':'unknown',safeForReuse:false,
    normalQualificationPassed:false,actualRuntimeQualified:false,anotherCaseAuthorized:false,
    historicalClosures:['C2:failed/unknown','normal1:failed/unknown','normal2:failed/unknown']};
}
