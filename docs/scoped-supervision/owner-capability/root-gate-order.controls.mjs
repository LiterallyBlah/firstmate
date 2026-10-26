// Finite saved-data/source controls only; no executable/native entry is imported.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gateInput,refreshGate,TEST_SOURCE_SHA} from './root-gate-input.mjs';
import {interpretRootGate} from './root-gate-capture.mjs';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const result=i=>interpretRootGate(i,TEST_SOURCE_SHA);
function originalCounterexample(){
  const i=gateInput({extra:1,marker:true});
  i.native=JSON.parse(read('../../../.local/root-gate-rg1/red/counterexample-gate-order.json')).inputNative;
  refreshGate(i);return i;
}
test('RG1 original producer-shaped stale checkpoint cannot establish a post-marker gate',()=>{
  const r=result(originalCounterexample());
  assert.equal(r.transport.complete,true);assert.equal(r.phase.complete,true);
  assert.equal(r.gateReached,false);assert.equal(r.captureComplete,false);
  assert.equal(r.ownedSetClosureConfirmed,true);assert.equal(r.safeForReuse,false);
  assert.equal(r.postMarkerReadbackConfirmed,false);assert.equal(r.extraMemberObservationPhase,'terminal-only');
  assert.equal(r.discrimination,'inconclusive');
});
test('RG1 native loop observes marker before its one membership readback and retains association before refusal',()=>{
  const text=read('WindowsRootGate.cs'),loop=text.slice(text.indexOf('while (!owner.deadlineFired)'),text.indexOf('if (owner.deadlineFired) throw new TimeoutException("Root-gate marker deadline")'));
  assert.ok(loop.indexOf('File.Exists(')<loop.indexOf('owner.ProbeMembers('));
  assert.equal((loop.match(/owner\.(?:ProbeMembers|Members)\(/g)??[]).length,1);
  assert.ok(loop.indexOf('receipt["markerReadback"]')<loop.indexOf('if (!(bool)members["complete"])'));
  assert.ok(loop.indexOf('owner.Note("gate-marker-observed"')<loop.indexOf('owner.ProbeMembers('));
  assert.ok(loop.includes('markerObserved ? "gate-post-marker" : "gate-live"'));
  const old=read('../../../.local/root-gate-rg1/base-source/WindowsRootGate.cs');
  assert.equal(text.slice(text.indexOf('} catch (Exception ex)',text.indexOf('public static Dictionary'))),
    old.slice(old.indexOf('} catch (Exception ex)',old.indexOf('public static Dictionary'))),'original failure/cleanup/final capture unchanged');
});
const copy=v=>structuredClone(v);
function interleaving(postObservation,{extra=false,commitAfter='query'}={}){
  let marker=false,pids=[100],queries=0,checks=0;const trace=[];
  const commit=()=>{marker=true;if(extra)pids.push(101);trace.push('commit');};
  const check=()=>{const seen=marker;trace.push(`check:${seen}`);if(++checks===1&&commitAfter==='check')commit();return seen;};
  const query=()=>{const snapshot=[...pids];trace.push(`query:${snapshot.length}`);if(++queries===1&&commitAfter==='query')commit();return snapshot;};
  for(let iteration=0;iteration<2;iteration++){
    let seen,snapshot;if(postObservation){seen=check();snapshot=query();}else{snapshot=query();seen=check();}
    if(snapshot.length!==1)return{stop:'unexpected-member',seen,snapshot,queries,trace};
    if(seen)return{stop:'marker',seen,snapshot,queries,trace};
  }
  throw Error('Synthetic schedule did not settle');
}
function addEarlierCheck(i){
  const at=i.native.events.findIndex(e=>e.kind==='gate-marker-observed');
  i.native.events.splice(at,0,{kind:'membership',data:{...copy(i.native.beforeResume),phase:'gate-live'}});
  refreshGate(i);return i;
}
test('RG1 marker committed between checks requires the next iteration readback, not the earlier root-only query',()=>{
  // Pure schedule: first check misses marker; it commits before that query. Next check sees it, then reuses its one query.
  const scheduled=interleaving(true,{commitAfter:'check'});
  const i=addEarlierCheck(gateInput()),r=result(i);
  assert.deepEqual(scheduled.trace,['check:false','commit','query:1','check:true','query:1']);
  assert.equal(scheduled.queries,2);assert.equal(scheduled.stop,'marker');
  assert.equal(i.native.events.filter(e=>e.kind==='membership'&&e.data.phase.startsWith('gate-')).length,2);
  assert.equal(r.postMarkerReadbackConfirmed,true);assert.equal(r.gateReached,true);assert.equal(r.captureComplete,true);
});
test('RG1 extra appearing after the earlier check is captured by the genuine post-observation query',()=>{
  const i=addEarlierCheck(gateInput({extra:1,marker:true})),r=result(i);
  const old=interleaving(false,{extra:true}),corrected=interleaving(true,{extra:true});
  assert.equal(old.stop,'marker');assert.deepEqual(old.snapshot,[100]);
  assert.equal(corrected.stop,'unexpected-member');assert.deepEqual(corrected.snapshot,[100,101]);
  assert.equal(old.queries,1);assert.equal(corrected.queries,2);
  assert.equal(r.phase.complete,true);assert.equal(r.postMarkerReadbackConfirmed,true);
  assert.equal(r.gateReached,false);assert.equal(r.gateVerdict,'refused-extra-member');assert.equal(r.captureComplete,true);
  assert.equal(r.extraMemberObservationPhase,'post-marker-readback');assert.equal(r.discrimination,'extra-member-observed-without-child-call');
  assert.equal(r.ownedSetClosureConfirmed,true);assert.equal(r.safeForReuse,false);
});
test('RG1 extra between a missed marker check and its query is captured without claiming marker was already observed',()=>{
  const scheduled=interleaving(true,{extra:true,commitAfter:'check'});assert.equal(scheduled.stop,'unexpected-member');
  assert.equal(scheduled.seen,false);assert.deepEqual(scheduled.snapshot,[100,101]);assert.equal(scheduled.queries,1);
  const i=gateInput({extra:1,marker:false}),committed=gateInput();i.rootPreSpawn=committed.rootPreSpawn;i.markerRaw=committed.markerRaw;
  const r=result(i);assert.equal(r.captureComplete,true);assert.equal(r.gateReached,false);assert.equal(r.postMarkerReadbackConfirmed,false);
  assert.equal(r.extraMemberObservationPhase,'marker-not-yet-observed');assert.equal(r.gateVerdict,'refused-extra-member');
});
test('RG1 genuine post-marker root-only positive remains distinct from normal/reuse',()=>{
  const r=result(gateInput());assert.equal(r.postMarkerReadbackConfirmed,true);assert.equal(r.gateReached,true);
  assert.equal(r.captureComplete,true);assert.equal(r.extraMemberObservationPhase,'not-observed');assert.equal(r.ownedSetClosureConfirmed,true);
  for(const key of ['safeForReuse','normalQualificationPassed','actualRuntimeQualified','anotherCaseAuthorized'])assert.equal(r[key],false);
});
function laterOnly(){
  const i=gateInput({extra:1,marker:true}),n=i.native;
  n.gateSnapshot={...copy(n.beforeResume),phase:'gate-post-marker'};n.markerReadback.members=copy(n.gateSnapshot);n.stopReason='marker';
  const extra=n.events.find(e=>e.kind==='handle-observation'&&e.data.role==='gate-member-1');
  n.events=n.events.filter(e=>e!==extra);n.events.find(e=>e.kind==='membership'&&e.data.phase==='gate-post-marker').data=copy(n.gateSnapshot);
  const terminal={members:{...copy(n.gateSnapshot),phase:'terminal',total:2,active:2,listed:2,assigned:2,pids:[100,101]},processes:n.lifetimes.map(l=>copy(l.terminal))};
  n.terminalSamples.unshift(terminal);n.events.push({kind:'membership',data:copy(terminal.members)},extra,{kind:'membership',data:copy(n.terminalEvidence.members)});
  refreshGate(i);return i;
}
test('RG1 later-only extra keeps terminal-only phase and cannot be relabelled present at the marker readback',()=>{
  const i=laterOnly(),r=result(i);assert.equal(r.phase.complete,true);assert.equal(r.captureComplete,true);
  assert.equal(r.postMarkerReadbackConfirmed,true);assert.equal(r.gateReached,true);assert.equal(r.discrimination,'inconclusive');
  assert.equal(r.extraMemberObservationPhase,'terminal-only');assert.equal(r.ownedSetClosureConfirmed,true);assert.equal(r.safeForReuse,false);
  assert.deepEqual(r.native.markerReadback.members.pids,[100]);assert.deepEqual(r.native.terminalSamples[0].members.pids,[100,101]);
});
for(const [name,mutate]of[
  ['missing association',n=>{delete n.markerReadback;}],['reversed declared order',n=>{n.markerReadback.order='membership-before-marker';}],
  ['different associated inventory',n=>{n.markerReadback.members.total=2;}],['wrong marker name',n=>{n.markerReadback.marker='root-pre-spawn.json.partial';}],
  ['missing marker event',n=>{n.events=n.events.filter(e=>e.kind!=='gate-marker-observed');}],
  ['missing readback event',n=>{n.events=n.events.filter(e=>!(e.kind==='membership'&&e.data.phase==='gate-post-marker'));}],
  ['reversed event order',n=>{const a=n.events.findIndex(e=>e.kind==='gate-marker-observed');[n.events[a],n.events[a+1]]=[n.events[a+1],n.events[a]];}],
  ['duplicate marker event',n=>{n.events.push(copy(n.events.find(e=>e.kind==='gate-marker-observed')));}],
  ['duplicate readback event',n=>{n.events.push(copy(n.events.find(e=>e.kind==='membership'&&e.data.phase==='gate-post-marker')));}],
  ['earlier phase masquerades as post-marker readback',n=>{const e=n.events.find(e=>e.kind==='membership'&&e.data.phase==='gate-post-marker');n.gateSnapshot.phase='gate-live';n.markerReadback.members.phase='gate-live';e.data.phase='gate-live';}],
  ['event inventory differs from associated inventory',n=>{n.events.find(e=>e.kind==='membership'&&e.data.phase==='gate-post-marker').data=copy(n.beforeResume);}],
])test(`RG1 refuses ${name} without manufacturing gate order`,()=>{
  const i=gateInput();mutate(i.native);refreshGate(i);const r=result(i);
  assert.equal(r.postMarkerReadbackConfirmed,false);assert.equal(r.gateReached,false);assert.equal(r.captureComplete,false);assert.equal(r.safeForReuse,false);
});
test('RG1 incomplete post-observation query retains raw failure and cannot establish a gate or closure',()=>{
  const i=gateInput(),n=i.native;n.gateSnapshot.complete=false;n.gateSnapshot.queryOk=false;n.gateSnapshot.queryError=5;
  n.markerReadback.members=copy(n.gateSnapshot);n.events.find(e=>e.kind==='membership'&&e.data.phase==='gate-post-marker').data=copy(n.gateSnapshot);
  n.error=n.originalFailure='InvalidOperationException: Incomplete job membership';refreshGate(i);const r=result(i);
  assert.equal(r.postMarkerReadbackConfirmed,true);assert.equal(r.gateReached,false);assert.equal(r.captureComplete,false);assert.equal(r.ownedSetClosureConfirmed,false);
  assert.equal(r.native.gateSnapshot.queryError,5);assert.equal(r.native.originalFailure,'InvalidOperationException: Incomplete job membership');
});
