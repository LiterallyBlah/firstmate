// MC1-R1: normal-completion semantics only. Pure data; no native/helper/controller/workload import.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {memberInput,refreshMember,MEMBER_TEST_SHA} from './member-input.mjs';
import {interpretMemberNormal} from './member-capture.mjs';
const copy=structuredClone,assess=v=>interpretMemberNormal(refreshMember(v),MEMBER_TEST_SHA);
const reason='member-normal-completion-missing-nonempty-or-inconsistent';
const completion=n=>n.events.find(e=>e.kind==='normal-owned-set-empty');
const membership=raw=>({kind:'membership',data:copy(raw)});
function normalInput(pids=[]) {
  const v=memberInput(),n=v.native;
  n.lastNormalMembers={...n.lastNormalMembers,pids:[...pids],assigned:pids.length,listed:pids.length,active:pids.length};
  for(const e of n.events)if(['membership','normal-owned-set-empty'].includes(e.kind)&&e.data.phase==='success-terminal')e.data=copy(n.lastNormalMembers);
  n.events.splice(n.events.findIndex(e=>e.kind==='gate-handle-observation'),0,membership(n.terminalEvidence.members));
  return v;
}
const closureOnly=r=>{
  assert.equal(r.transport.complete,true);assert.equal(r.phase.complete,true);assert.equal(r.captureComplete,true);
  assert.equal(r.normalQualificationPassed,false);assert.equal(r.safeForReuse,false);assert.equal(r.ownedSetClosureConfirmed,true);
  assert.equal(r.actualRuntimeQualified,false);assert.equal(r.anotherCaseAuthorized,false);assert.ok(r.normalReasons.includes(reason));
};
test('MC1-R1 consistent nonempty normal-completion copies cannot borrow later empty terminal closure',()=>{
  closureOnly(assess(normalInput([102])));
});
test('MC1-R1 genuinely empty normal-completion snapshot and event qualify',()=>{
  const r=assess(normalInput());assert.deepEqual(r.normalReasons,[]);assert.equal(r.normalQualificationPassed,true);assert.equal(r.safeForReuse,true);assert.equal(r.ownedSetClosureConfirmed,true);
});
test('MC1-R1 legitimate nonempty normal timeout retains its original failure and eventual physical closure',()=>{
  const v=normalInput([102]),n=v.native;n.events=n.events.filter(e=>e.kind!=='normal-owned-set-empty');
  n.error=n.originalFailure='TimeoutException: normal closure incomplete';n.normalExited=false;n.terminateRequested=n.terminateReturned=true;v.outer.status=v.outer.exitStatus=2;
  const r=assess(v);closureOnly(r);assert.equal(r.native.originalFailure,'TimeoutException: normal closure incomplete');
});
test('MC1-R1 earlier nonempty pending normal queries remain valid before actual empty completion',()=>{
  const v=normalInput(),n=v.native,index=n.events.findIndex(e=>e.kind==='membership'&&e.data.phase==='success-terminal');
  const pending={...copy(n.lastNormalMembers),pids:[102],active:1,assigned:1,listed:1};n.events.splice(index,0,membership(pending));
  const r=assess(v);assert.equal(r.normalQualificationPassed,true);assert.equal(r.ownedSetClosureConfirmed,true);
});
test('MC1-R1 a summary flag and empty terminal query cannot replace the missing completion event',()=>{
  const v=normalInput();v.native.events=v.native.events.filter(e=>e.kind!=='normal-owned-set-empty');closureOnly(assess(v));
});
test('MC1-R1 a false normal-exited summary cannot be replaced by an empty event',()=>{
  const v=normalInput();v.native.normalExited=false;closureOnly(assess(v));
});
test('MC1-R1 the completion point must be unique even if both copies claim empty',()=>{
  const v=normalInput(),n=v.native,index=n.events.findIndex(e=>e.kind==='normal-owned-set-empty');n.events.splice(index+1,0,copy(n.events[index]));closureOnly(assess(v));
});
test('MC1-R1 an earlier empty event cannot hide a later nonempty completion claim',()=>{
  const v=normalInput(),n=v.native,index=n.events.findIndex(e=>e.kind==='normal-owned-set-empty');
  const pending={...copy(n.lastNormalMembers),pids:[102],active:1,assigned:1,listed:1};
  n.events.splice(index+1,0,{kind:'normal-owned-set-empty',data:pending},membership(n.lastNormalMembers));closureOnly(assess(v));
});
test('MC1-R1 a later empty event cannot hide an earlier nonempty completion claim',()=>{
  const v=normalInput(),n=v.native,index=n.events.findIndex(e=>e.kind==='normal-owned-set-empty');
  const pending={...copy(n.lastNormalMembers),pids:[102],active:1,assigned:1,listed:1};n.events.splice(index,0,{kind:'normal-owned-set-empty',data:pending});closureOnly(assess(v));
});
test('MC1-R1 empty event alone cannot override a nonempty last normal snapshot',()=>{
  const v=normalInput([102]),n=v.native,empty={...copy(n.lastNormalMembers),pids:[],active:0,assigned:0,listed:0};
  completion(n).data=empty;n.events.splice(n.events.findIndex(e=>e.kind==='normal-owned-set-empty')+1,0,membership(n.lastNormalMembers));closureOnly(assess(v));
});
test('MC1-R1 later terminal-phase data cannot stand in for the normal completion phase',()=>{
  const v=normalInput();completion(v.native).data.phase='terminal';closureOnly(assess(v));
});
for(const field of ['complete','queryOk','accountingOk'])test('MC1-R1 completion '+field+' is required independently of the normal-exited flag',()=>{
  const v=normalInput();completion(v.native).data[field]=false;const r=assess(v);assert.equal(r.normalQualificationPassed,false);assert.equal(r.safeForReuse,false);
  assert.equal(r.ownedSetClosureConfirmed,false);assert.ok(r.normalReasons.includes(reason));
});
test('MC1-R1 a completion query error cannot be erased by empty counters or later terminal success',()=>{
  const v=normalInput();completion(v.native).data.queryError=5;const r=assess(v);assert.equal(r.normalQualificationPassed,false);assert.equal(r.ownedSetClosureConfirmed,false);
});
