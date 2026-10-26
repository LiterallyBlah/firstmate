/** Pure versioned composition. Native physical closure never comes from product success flags. */
import {isDeepStrictEqual as equal} from 'node:util';
import {resolve,join} from 'node:path';
import {createWitness} from '../observer-wiring/protocol.mjs';
import {interpretMemberNormal} from '../owner-capability/member-capture.mjs';
import {CASE,NONCE,SELECTION,sha} from './contract.mjs';
import {errorValue} from './io.mjs';
const pathId=value=>typeof value==='string'?resolve(value).replaceAll('\\','/').toLowerCase():null;
export function jsonLines(bytes,limit=2097152){
 if(!Buffer.isBuffer(bytes)||bytes.length===0||bytes.length>limit)throw Error('Missing/bounded line file');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(!text.endsWith('\n'))throw Error('Partial line file');
 const rows=text.slice(0,-1).split('\n');if(rows.length>256||rows.some(r=>Buffer.byteLength(r)>16384))throw Error('Line bound');return rows.map(r=>JSON.parse(r));
}
export function checkTestResults(plan,report,lifecycle){
 const reasons=new Set(),need=(value,why)=>{if(!value)reasons.add(why);};
 need(report?.success===true&&report.numTotalTests===2&&report.numPassedTests===2&&report.numFailedTests===0&&report.numPendingTests===0&&report.numTodoTests===0&&
  report.numTotalTestSuites===2&&report.numPassedTestSuites===2&&report.numFailedTestSuites===0&&report.numPendingTestSuites===0,'exact-two-original-tests-not-passed');
 need(lifecycle?.format==='firstmate.s02-mailbox-runner/1'&&lifecycle.caseId===CASE&&lifecycle.nonce===NONCE&&lifecycle.startState==='fulfilled'&&lifecycle.closeState==='fulfilled'&&
  lifecycle.originalError===null&&lifecycle.closeError===null&&lifecycle.reportReadError===null&&lifecycle.exitCode===0&&lifecycle.exitCodeError===null&&Array.isArray(lifecycle.recordingErrors)&&lifecycle.recordingErrors.length===0,'runner-lifecycle-or-original-error');
 const observed=lifecycle?.reporter,rows=observed?.rows,end=observed?.end;
 need(observed?.lost===0&&observed.errors?.length===0&&rows?.length===4&&end?.reason==='passed'&&end.unhandledCount===0&&end.modules?.length===2,'reporter-missing-lost-or-framework-error');
 need(report?.testResults?.length===2,'unexpected-test-module');
 for(const file of plan?.files??[]){
  const matches=report?.testResults?.filter(r=>pathId(r.name)===pathId(file.path))??[];
  const assertions=matches[0]?.assertionResults;
  need(matches.length===1&&matches[0].status==='passed'&&matches[0].message===''&&assertions?.length===1&&assertions[0].title===file.title&&assertions[0].fullName===file.title&&
   equal(assertions[0].ancestorTitles,[])&&assertions[0].status==='passed'&&equal(assertions[0].failureMessages,[]),'test-result-selection-or-outcome');
  const ready=rows?.filter(r=>r.kind==='ready'&&pathId(r.moduleId)===pathId(file.path))??[],result=rows?.filter(r=>r.kind==='result'&&pathId(r.moduleId)===pathId(file.path))??[];
  need(ready.length===1&&result.length===1&&ready[0].name===file.title&&ready[0].fullName===file.title&&result[0].name===file.title&&result[0].fullName===file.title&&
   rows.indexOf(ready[0])<rows.indexOf(result[0])&&result[0].state==='passed'&&result[0].retryCount===0&&result[0].repeatCount===0&&result[0].flaky===false,'test-not-exactly-once-or-retried');
  const modules=end?.modules?.filter(r=>pathId(r.moduleId)===pathId(file.path))??[];
  need(modules.length===1&&modules[0].errors===0&&equal(modules[0].tests,[file.title]),'module-collection-or-setup-errors');
 }
 return[...reasons];
}
export function assessProduct(member,input,product,expectedPlan){
 const reasons=new Set(),need=(ok,why)=>{if(!ok)reasons.add(why);};const slots=[];
 need(input.caseId===CASE&&input.nonce===NONCE,'product-case-stale');
 need(product?.readErrors?.count===0&&equal(product.readErrors.errors,[]),'product-file-read-or-bound-error');
 const plan=product?.plan;
 need(equal(plan,expectedPlan)&&plan?.format==='firstmate.s02-mailbox-selection/1'&&plan.caseId===CASE&&plan.nonce===NONCE&&plan.pinsSha256===input.pinsSha256&&plan.files?.length===2&&plan.slots?.length===2,'selection-manifest-changed-or-incomplete');
  for(const target of SELECTION){const files=plan?.files?.filter(f=>f.name===target.name)??[];
  need(files.length===1&&['name','path','title','sourceSha256','bodyHash','expectations'].filter(k=>k!=='path').every(k=>files[0][k]===target[k]),'original-callback-body-or-assertions-changed');
  need(files.length===1&&product.generatedArtifacts?.[files[0].path]===files[0].sha256,'generated-callback-file-changed');
 }
 need(plan?.artifacts?.length===7&&new Set(plan.artifacts.map(a=>a.path)).size===7&&plan.artifacts.every(a=>product.generatedArtifacts?.[a.path]===a.sha256),'generated-setup-config-or-capsule-changed');
 need(Buffer.isBuffer(product?.selectionRaw)&&product.selectionRaw.length<=2097152&&sha(product.selectionRaw)===input.selectionSha256&&equal(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(product.selectionRaw)),plan),'selection-file-digest-mismatch');
 need(Buffer.isBuffer(product?.reportRaw)&&product.reportRaw.length<=2097152&&equal(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(product.reportRaw)),product.report)&&sha(product.reportRaw)===product.runner?.reportSha256,'test-report-digest-or-value-mismatch');
 need(product?.runnerError===null&&input.childResult?.format==='firstmate.s02-mailbox-child/1'&&input.childResult.caseId===CASE&&input.childResult.nonce===NONCE&&
  input.childResult.reportSha256===product.runner?.reportSha256&&!('originalError' in input.childResult),'original-child-error-or-report-mismatch');
 for(const reason of checkTestResults(plan,product?.report,product?.runner))reasons.add(reason);
 need(member.normalQualificationPassed===true,'native-normal-workload-not-complete');
 need(member.ownedSetClosureConfirmed===true,'native-physical-closure-not-confirmed');
 const native=member.native,lives=native?.lifetimes??[],root=input.rootEntry,runner=input.childEntry;
 const nativeEvents=native?.events??[],armed=nativeEvents.find(e=>e.kind==='deadline-armed'),completed=nativeEvents.filter(e=>e.kind==='normal-owned-set-empty');
 need(Array.isArray(nativeEvents)&&nativeEvents.every((e,i)=>Number.isFinite(e.atMs)&&e.atMs>=0&&(!i||e.atMs>=nativeEvents[i-1].atMs))&&armed?.data?.durationMs===5000&&completed.length===1&&
  completed[0].atMs>=armed.atMs&&completed[0].atMs-armed.atMs<=5000,'observed-native-budget-not-met');
 for(const target of SELECTION){try{
  const capsule=plan.slots.find(s=>s.name===target.name),data=product.slots[target.name];
  need(equal(data.capsule,capsule),'callback-capsule-file-changed');
  need(capsule.ownerCaseId===CASE&&capsule.ownerNonce===NONCE&&capsule.ownerPinsSha256===input.pinsSha256&&capsule.bodyHash===target.bodyHash&&capsule.sourceHash===target.sourceSha256&&capsule.runtime==='s02-mailbox-owned/1'&&capsule.callbackLimitMs===5000,'callback-capsule-source-or-owner');
  const frames=jsonLines(data.externalRaw),entry=frames.find(f=>f.kind==='case-entry');
  const pid=entry?.actualWorker?.pid,life=lives.find(l=>l.initial?.identity?.pid===pid);
  need(Boolean(life&&life.bindingComplete===true&&life.continuous===true&&life.initial.identity.image===input.nodePath&&pid!==root?.pid&&pid!==runner?.pid),'callback-worker-has-no-immutable-owned-lifetime');
  const owner={format:'firstmate.s02-mailbox-worker-owner/1',caseId:CASE,nonce:NONCE,pinsSha256:input.pinsSha256,rootPid:root?.pid,rootInstance:root?.instance,
   runnerPid:runner?.pid,runnerInstance:runner?.instance,workerPid:pid,workerPpid:runner?.pid};
  need(frames.every((f,i)=>equal(f.mailboxOwner,owner)&&(!i||f.childAtMs>=frames[i-1].childAtMs)),'callback-owner-parent-or-clock-mismatch');
  let previousProgress=-1;
  need(frames.filter(f=>f.kind==='heartbeat').every(f=>{const p=f.data?.progress,monotone=Number.isFinite(p?.elapsedMs)&&p.elapsedMs>=previousProgress;if(monotone)previousProgress=p.elapsedMs;return !f.data?.progressError&&p?.kind==='bounded-latest-pending-chain/1'&&monotone&&p.elapsedMs>=0&&
   Number.isSafeInteger(p.retainedRows)&&p.retainedRows>=0&&p.retainedRows<=8000&&Number.isSafeInteger(p.pendingCount)&&p.pendingCount>=0&&p.pendingCount<=p.retainedRows&&
   p.representedPending===(p.pendingCount>0?1:0)&&p.otherPendingCount===p.pendingCount-p.representedPending&&Array.isArray(p.chain)&&p.chain.length<=32&&(p.pendingCount>0?p.chain.length>0:p.chain.length===0)&&p.chain.every(s=>typeof s==='string'&&s.length<=160)&&
   ['chainNamesTruncated','chainEntriesOmitted','dropped','observerErrors','fieldTruncations','pendingEntriesDropped','ancestryTruncations'].every(k=>p[k]===0);}), 'callback-liveness-summary-missing-or-lossy');
  need(frames[0]?.kind==='case-entry'&&frames.at(-1)?.kind==='case-final','callback-missing-or-late-final');
  const witness=createWitness({capsule,homeRoot:capsule.ownedHomeRoot,expectedPid:()=>life?.initial?.identity?.pid});
  for(const frame of frames)witness.receive(frame);
  // The old witness intentionally reports runtime unsupported. Only the independent member reader supplies closure.
  const proof=witness.seal({runtime:'vitest-forks',directClosed:member.ownedSetClosureConfirmed});
  need(proof.captureAdmissible&&proof.workDrained&&proof.knownResourcesClosed&&proof.outcome.state==='fulfilled','callback-observer-or-original-result-incomplete');
  need(data.returned?.format==='firstmate.s02-mailbox-disposal/1'&&equal(data.returned.owner,owner)&&!('finalizationError' in (data.returned.status??{}))&&equal(data.returned.status?.outcome,proof.final?.outcome)&&
   equal(data.returned.status?.observer,proof.final?.observer),'post-disposal-return-missing-or-inconsistent');
  const snapshot=data.snapshot,final=proof.final?.observer;
  need(snapshot?.caseId===proof.caseId&&snapshot.workerId===proof.sessionWorkerId&&snapshot.name===capsule.name&&snapshot.label==='post-dispose'&&snapshot.disposed===true&&snapshot.active===false&&snapshot.incomplete===false&&
   ['dropped','fieldTruncations','observerErrors','pendingEntriesDropped','ancestryTruncations'].every(k=>snapshot[k]===0&&snapshot[k]===final?.[k])&&equal(snapshot.errors,[])&&equal(snapshot.pending,[])&&
   Array.isArray(snapshot.rows)&&snapshot.rows.length<=8000&&snapshot.rows.every(r=>r.state!=='pending')&&final?.pendingCount===0,'post-disposal-snapshot-missing-or-lossy');
  const retained=jsonLines(data.retentionRaw);need(retained.length===1&&retained[0].home===proof.events[0]?.home&&retained[0].decision==='retain'&&equal(retained[0].requestedOptions,{recursive:true,force:true}),'isolated-home-retention-not-confirmed');
  slots.push({name:target.name,caseId:proof.caseId,worker:proof.worker,sessionWorkerId:proof.sessionWorkerId,memberBinding:life?.bindingRef??null,owner,frameCount:frames.length,
   externalSha256:sha(data.externalRaw),captureAdmissible:proof.captureAdmissible,workDrained:proof.workDrained,knownResourcesClosed:proof.knownResourcesClosed,
   witnessRuntimeSupported:proof.supported,outcome:proof.outcome,final:proof.final});
 }catch(error){need(false,'callback-receipt-invalid:'+target.name);}}
 need(slots.length===2&&['caseId','sessionWorkerId'].every(key=>new Set(slots.map(s=>s[key])).size===2)&&new Set(slots.map(s=>s.worker?.instance)).size===2,'callback-identities-not-fresh');
 return{normalProductSuccess:reasons.size===0,reasons:[...reasons],slots};
}
export function interpretMailbox(input,product,plan,nativeSha){
 let member,nativeReaderError=null;try{member=interpretMemberNormal(input,nativeSha);}catch(error){nativeReaderError=errorValue(error);member={normalQualificationPassed:false,ownedSetClosureConfirmed:false,closureState:'unknown',native:null,historicalClosures:['C2:failed/unknown','normal1:failed/unknown','normal2:failed/unknown']};}let assessment;
 try{assessment=assessProduct(member,input,product,plan);}catch{assessment={normalProductSuccess:false,reasons:['malformed-product-evidence'],slots:[]};}
 return{format:'firstmate.s02-mailbox-capture/1',caseId:input.caseId,nonce:input.nonce,pinsSha256:input.pinsSha256,member,nativeReaderError,
  product:assessment,normalProductSuccess:assessment.normalProductSuccess,ownedSetClosureConfirmed:member.ownedSetClosureConfirmed,closureState:member.closureState,
  actualRuntimeQualified:false,anotherCaseAuthorized:false,historicalClosures:member.historicalClosures};
}
