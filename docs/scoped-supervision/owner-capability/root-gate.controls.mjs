import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gateInput,refreshGate,TEST_SOURCE_SHA} from './root-gate-input.mjs';
import {interpretRootGate} from './root-gate-capture.mjs';
const result=input=>interpretRootGate(input,TEST_SOURCE_SHA);
const clone=v=>structuredClone(v);
test('complete root-only marker capture closes actual resources but never qualifies normal/reuse',()=>{
  const input=gateInput(),r=result(input);assert.deepEqual(r.reasons,[]);assert.equal(r.captureComplete,true);assert.equal(r.gateReached,true);
  assert.equal(r.gateVerdict,'marker-reached');assert.equal(r.discrimination,'inconclusive');assert.equal(r.ownedSetClosureConfirmed,true);
  assert.equal(r.safeForReuse,false);assert.equal(r.normalQualificationPassed,false);assert.equal(r.actualRuntimeQualified,false);assert.equal(r.anotherCaseAuthorized,false);
});
test('unexpected bound member before any marker is a useful refused observation, not a gate or normal child',()=>{
  const input=gateInput({extra:1,marker:false}),r=result(input);assert.deepEqual(r.reasons,[]);assert.equal(r.captureComplete,true);
  assert.equal(r.discrimination,'extra-member-observed-without-child-call');assert.equal(r.gateReached,false);assert.equal(r.gateVerdict,'refused-extra-member');
  assert.equal(r.ownedSetClosureConfirmed,true);assert.equal(r.safeForReuse,false);assert.equal(r.native.handleInventory.child.acquisition,'never-acquired');
});
function refuses(name,mutate,{extra=0,closure=false}={}){test(name,()=>{const input=gateInput({extra});mutate(input);refreshGate(input);const r=result(input);assert.equal(r.captureComplete,false);if(!closure)assert.equal(r.ownedSetClosureConfirmed,false);assert.equal(r.safeForReuse,false);assert.equal(r.normalQualificationPassed,false);});}
for(const [name,mutate] of [
  ['initial image failure',i=>{i.native.lifetimes[0].initial.queries.image={attempted:true,ok:false,win32Error:31};}],
  ['initial image deliberately missing',i=>{i.native.lifetimes[0].initial.queries.image={attempted:false};}],
  ['incomplete initial binding',i=>{i.native.lifetimes[0].bindingComplete=false;}],
  ['missing continuous owner',i=>{i.native.lifetimes[0].continuous=false;}],
  ['replacement latch',i=>{i.native.replacementDetected=true;}],
  ['changed initial creation after root event',i=>{i.native.lifetimes[0].initial.identity.creationFileTime='134374367593176526';}],
  ['reopened handle/reference',i=>{i.native.lifetimes[0].bindingRef.handle='0x999';}],
  ['reopened sequence',i=>{i.native.lifetimes[0].bindingRef.sequence=2;}],
  ['missing final sample',i=>{i.native.terminalSamples=[];}],
  ['subset-only final process rows',i=>{i.native.terminalEvidence.processes=[];}],
  ['total names an unseen lifetime',i=>{i.native.terminalEvidence.members.total=2;i.native.terminalSamples[0].members.total=2;}],
  ['observed member not acquired',i=>{i.native.gateSnapshot.pids.push(999);i.native.gateSnapshot.total=i.native.gateSnapshot.active=i.native.gateSnapshot.assigned=i.native.gateSnapshot.listed=2;}],
  ['incomplete inventory followed by good final',i=>{i.native.events.push({kind:'membership',data:{queryOk:false,accountingOk:false}});}],
  ['accounting-only missing process',i=>{i.native.events.push({kind:'membership',data:{...i.native.gateSnapshot,total:3}});}],
  ['failed acquisition',i=>{i.native.memberAcquisitions[0].acquisition='failed';}],
  ['acquisition omitted',i=>{i.native.memberAcquisitions=[];}],
  ['lifetime overflow',i=>{i.native.lifetimeOverflow=1;}],
  ['observation loss',i=>{i.native.observation.dropped=1;}],
  ['zero counter with retained errors',i=>{i.native.observation.errors=['actual failure'];}],
  ['process close failure',i=>{i.native.lifetimes[0].closed=false;}],
  ['resource close failure',i=>{i.native.handleInventory.job.disposition='close-failed';}],
  ['untracked resource closed on subset',i=>{i.native.handleInventory.unknown={acquisition:'acquired',disposition:'closed',handle:'0x999'};}],
  ['expected child fabricated',i=>{i.native.handleInventory.child={acquisition:'acquired',disposition:'closed',handle:'0x999'};}],
  ['required final wait still pending',i=>{i.native.lifetimes[0].terminal.wait.result=258;i.native.terminalEvidence.processes[0].wait.result=258;i.native.terminalSamples[0].processes[0].wait.result=258;}],
  ['terminal image skipped as success',i=>{i.native.lifetimes[0].terminal.queries.image.ok=true;}],
  ['fresh image fabricated from original',i=>{i.native.lifetimes[0].terminal.identity.image=i.nodePath;}],
  ['missing phase version',i=>{delete i.native.captureVersion;}],
  ['legacy version cannot pick omission policy',i=>{i.native.captureVersion=2;i.native.diagnosticVersion=1;}],
])refuses(name,mutate,{extra:['failed acquisition','acquisition omitted'].includes(name)?1:0});
const locations={
  'initial':n=>n.lifetimes[0].initial,'latest':n=>n.lifetimes[0].terminal,
  'current terminal':n=>n.terminalEvidence.processes[0], 'earlier sample':n=>{n.terminalSamples.unshift(clone(n.terminalSamples[0]));return n.terminalSamples[0].processes[0];},
  'event':n=>n.events.find(e=>e.kind==='handle-observation').data,'inventory':n=>n.handleInventory.root.observation,
};
for(const [name,locate]of Object.entries(locations))for(const key of ['wait','exit','pid','creation','membership','image'])refuses(`raw failure ${name} ${key} survives zero counter and later recovery`,i=>{
  const v=locate(i.native);if(['wait','exit'].includes(key))v[key]={ok:false,win32Error:6};else v.queries[key]={attempted:true,ok:false,win32Error:31};
});
test('earlier successful pending wait258 is allowed only with eventual same-lifetime closure',()=>{
  const input=gateInput();const pending=clone(input.native.terminalSamples[0]);pending.processes[0].wait.result=258;pending.processes[0].exit.code=259;input.native.terminalSamples.unshift(pending);refreshGate(input);
  assert.equal(result(input).captureComplete,true);assert.equal(result(input).ownedSetClosureConfirmed,true);
});
for(const [name,mutate]of [
  ['missing committed marker',i=>{i.rootPreSpawn=null;i.markerRaw=null;}],['partial is never a marker',i=>{i.rootPreSpawn=null;i.markerRaw=null;i.markerPartialExists=true;}],
  ['marker different raw bytes',i=>{i.markerRaw=Buffer.from('{}');}],['marker PID',i=>{i.rootPreSpawn.pid=999;i.markerRaw=Buffer.from(JSON.stringify(i.rootPreSpawn));}],
  ['marker nonce',i=>{i.rootPreSpawn.nonce='wrong';i.markerRaw=Buffer.from(JSON.stringify(i.rootPreSpawn));}],['marker too big',i=>{i.markerRaw=Buffer.alloc(4097);}],
  ['deadline not before resume',i=>{i.native.events=i.native.events.filter(e=>e.kind!=='deadline-armed');}],['deadline fired',i=>{i.native.deadlineFired=true;}],
  ['termination failed',i=>{i.native.terminateReturned=false;}],['original exception',i=>{i.native.error=i.native.originalFailure='InvalidOperationException: retained';}],
])refuses(name,mutate,{closure:true});
for(const key of ['dropped','errors','drained','closed'])test(`raw outer ${key} refuses final evidence`,()=>{
  const input=gateInput();input.outer.stdout[key]=['drained','closed'].includes(key)?false:1;const r=result(input);assert.equal(r.captureComplete,false);assert.equal(r.ownedSetClosureConfirmed,false);
});
test('a useful observed extra member cannot clear actual terminal failure or subset closure',()=>{
  const input=gateInput({extra:1,marker:false});input.native.lifetimes[1].terminal.queries.image={attempted:true,ok:false,win32Error:31};refreshGate(input);
  const r=result(input);assert.equal(r.discrimination,'extra-member-observed-without-child-call');assert.equal(r.captureComplete,false);assert.equal(r.ownedSetClosureConfirmed,false);assert.equal(r.safeForReuse,false);
});
test('maximum admitted eight lifetime/eight sample/64 event/stream/identity/error envelope fits file/frame/capture caps',()=>{
  const input=gateInput({extra:7,marker:false}),n=input.native;
  for(const l of n.lifetimes.slice(1))l.initial.identity.image='C:\\'+ '\u0800'.repeat(1021);
  for(const e of n.events.filter(e=>e.kind==='handle-observation'))e.data=clone(n.lifetimes.find(l=>l.bindingRef.role===e.data.role).initial);
  n.terminalSamples=Array.from({length:8},()=>clone(n.terminalEvidence));
  while(n.events.length<64)n.events.push({kind:'bounded-control',data:{note:'x'.repeat(300)}});
  for(const key of ['stdout','stderr']){const bytes=Buffer.alloc(65536,120);Object.assign(n.rootOutput[key],{bytes:bytes.length,retained:bytes.length,data:bytes.toString('base64')});}
  refreshGate(input);const r=result(input);assert.deepEqual(r.reasons,[]);assert.equal(r.captureComplete,true);
  assert.ok(input.helperFileRaw.length<=2097152);assert.ok(input.outer.stdout.bytes<=32768);assert.ok(Buffer.byteLength(JSON.stringify(r))<=2097152);
  n.observation={failures:8,dropped:0,errors:Array.from({length:8},()=> 'e'.repeat(300))};refreshGate(input);assert.ok(input.helperFileRaw.length<=2097152);assert.equal(result(input).captureComplete,false);
});
