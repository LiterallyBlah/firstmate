/** Fixed owner-bound callback entry only. Old runtime support flags/witness are unchanged. */
import {readFileSync,appendFileSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {threadId,isMainThread} from 'node:worker_threads';
import assert from 'node:assert/strict';
import {createCase,fileSender} from '../observer-wiring/protocol.mjs';
import {CASE,NONCE,SELECTION,REPO,SOURCE,sha,fixedConfiguration,locations} from './contract.mjs';
import {readJson,readBounded,saveNew,errorValue} from './io.mjs';
export function loadRuntime(path){
 assert.equal(resolve(path),locations().configuration);const config=fixedConfiguration(readJson(path));
 const pinsRaw=readBounded(join(SOURCE,'source-pins.json'));assert.equal(sha(pinsRaw),config.pinsSha256);const pins=JSON.parse(pinsRaw);
 assert.equal(pins.format,'firstmate.s02-mailbox-sources/1');
 for(const[name,hash]of Object.entries(pins.files))assert.equal(sha(readFileSync(resolve(REPO,name))),hash,'Changed runtime source '+name);
 const dispatch=readJson(locations().dispatch);assert.deepEqual(dispatch,{format:'firstmate.s02-mailbox-dispatch/1',executeOneMailbox:true,caseId:CASE,nonce:NONCE,
  pinsSha256:config.pinsSha256,controllerSha256:config.controllerSha256});
 const controller=readFileSync(join(SOURCE,'controller.mjs'));assert.equal(sha(controller),config.controllerSha256);
 assert.equal(controller.toString().match(/const PINS_SHA='([a-f0-9]{64})'/)?.[1],config.pinsSha256);
 const planRaw=readBounded(join(config.directory,'selection.json'));assert.equal(sha(planRaw),config.selectionSha256);const plan=JSON.parse(planRaw);
 assert.equal(plan.artifacts?.length,7);
 for(const artifact of plan.artifacts){const rel=relative(config.directory,artifact.path);assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel));assert.equal(sha(readBounded(artifact.path)),artifact.sha256,'Changed generated mailbox artifact');}
 return{config,pins};
}
export function ownerAssociation(config,root,child,actual,release){
 fixedConfiguration(config);assert.equal(release,'owned-workload-confirmed');
 for(const entry of [root,child]){assert.equal(entry.caseId,CASE);assert.equal(entry.nonce,NONCE);assert.equal(entry.scenario,'normal');assert.equal(entry.node,config.nodeVersion);assert.equal(entry.isMainThread,true);assert.equal(entry.threadId,0);assert.match(entry.instance,/^[a-f0-9-]{36}$/);}
 assert.equal(root.childPid,child.pid);assert.equal(child.ppid,root.pid);assert.notEqual(root.instance,child.instance);
 assert.equal(actual.ppid,child.pid);assert.notEqual(actual.pid,root.pid);assert.notEqual(actual.pid,child.pid);
 assert.equal(actual.node,config.nodeVersion);assert.equal(actual.isMainThread,true);assert.equal(actual.threadId,0);
 return{format:'firstmate.s02-mailbox-worker-owner/1',caseId:CASE,nonce:NONCE,pinsSha256:config.pinsSha256,rootPid:root.pid,rootInstance:root.instance,
  runnerPid:child.pid,runnerInstance:child.instance,workerPid:actual.pid,workerPpid:actual.ppid};
}
function selectedCapsule(path){
 const capsule=readJson(path),{config}=loadRuntime(capsule.configuration),target=SELECTION.find(t=>t.name===capsule.name);
 assert.ok(target);assert.equal(resolve(path),join(config.directory,'selected',target.name,'capsule.json'));
 assert.equal(capsule.ownerCaseId,CASE);assert.equal(capsule.ownerNonce,NONCE);assert.equal(capsule.ownerPinsSha256,config.pinsSha256);
 assert.equal(capsule.runtime,'s02-mailbox-owned/1');assert.equal(capsule.bodyHash,target.bodyHash);assert.equal(capsule.sourceHash,target.sourceSha256);
 const plan=readJson(join(config.directory,'selection.json'));assert.equal(plan.caseId,CASE);assert.equal(plan.nonce,NONCE);assert.equal(plan.pinsSha256,config.pinsSha256);
 assert.equal(sha(readBounded(join(config.directory,'selection.json'))),config.selectionSha256);
 const slot=plan.slots.find(s=>s.name===target.name);assert.deepEqual(slot,capsule);
 const file=plan.files.find(f=>f.name===target.name);assert.equal(sha(readFileSync(file.path)),file.sha256);
 return{capsule,config};
}
export function prepareWorkerSetup(path){
 const{capsule,config}=selectedCapsule(path);
 assert.equal(readBounded(join(config.directory,'release'),4096).toString(),'owned-workload-confirmed');
 process.env.TMP=process.env.TEMP=process.env.TMPDIR=capsule.ownedHomeRoot;
 process.env.FIRSTMATE_DIAGNOSTIC_HOME_ROOT=capsule.ownedHomeRoot;
 process.env.FIRSTMATE_DIAGNOSTIC_RETENTION=join(capsule.output,'retained-home.jsonl');
}
export function progressSummary(snapshot){
 const pending=snapshot.rows.filter(row=>row.state==='pending').length,latest=snapshot.pending.at(-1),chain=latest?.ancestors??[];
 return{kind:'bounded-latest-pending-chain/1',elapsedMs:snapshot.elapsedMs,retainedRows:snapshot.rows.length,pendingCount:pending,
  representedPending:latest?1:0,otherPendingCount:Math.max(0,pending-(latest?1:0)),chain:chain.slice(0,32).map(name=>String(name).slice(0,160)),
  chainNamesTruncated:chain.filter(name=>String(name).length>160).length,chainEntriesOmitted:Math.max(0,chain.length-32),
  dropped:snapshot.dropped,observerErrors:snapshot.observerErrors,fieldTruncations:snapshot.fieldTruncations,pendingEntriesDropped:snapshot.pendingEntriesDropped,ancestryTruncations:snapshot.ancestryTruncations};
}
export function openMailboxCase(path){
 const{capsule,config}=selectedCapsule(path),home=process.env.PASEO_HOME;
 const rel=home&&relative(capsule.ownedHomeRoot,home);assert.ok(home&&isAbsolute(home)&&rel&&!rel.startsWith('..')&&!isAbsolute(rel));
 const owner=ownerAssociation(config,readJson(join(config.directory,'root-entry.json'),4096),readJson(join(config.directory,'child-entry.json'),4096),
  {pid:process.pid,ppid:process.ppid,node:process.version,threadId,isMainThread},readBounded(join(config.directory,'release'),4096).toString());
 const sender=fileSender(capsule.external);let bytes=0;
 const bridge=createCase({capsule,home,send:frame=>{let bound={...frame,mailboxOwner:owner};if(frame.kind==='heartbeat'){
   try{bound={...bound,data:{...frame.data,progress:progressSummary(bridge.session.snapshot('liveness'))}};}catch(error){bridge.session.observerError(error);bound={...bound,data:{...frame.data,progressError:errorValue(error)}};}
  }bytes+=Buffer.byteLength(JSON.stringify(bound)+'\n');if(bytes>2097152)throw Error('External mailbox file bound');sender(bound);},
  sink:snapshot=>saveNew(join(capsule.output,'trace',snapshot.label+'.json'),snapshot)});
 const finalize=bridge.finalize;let finished=false;
 bridge.finalize=()=>{
  if(finished)return;finished=true;let status;
  try{status=finalize();}catch(error){bridge.session.observerError(error);status={finalizationError:errorValue(error)};}
  try{saveNew(join(capsule.output,'post-disposal-return.json'),{format:'firstmate.s02-mailbox-disposal/1',owner,status});}
  catch(error){bridge.session.observerError(error);} // missing/failed return file refuses externally; original callback result is preserved
  return status;
 };
 return bridge;
}
