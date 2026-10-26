// MC1/MC2: finite source/data tests only. No controller/helper/workload/native import or execution.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {memberInput,refreshMember,MEMBER_TEST_SHA} from './member-input.mjs';
import {interpretMemberNormal} from './member-capture.mjs';
const copy=structuredClone,assess=v=>interpretMemberNormal(refreshMember(v),MEMBER_TEST_SHA);
const lower = raw => {raw.total=2;raw.pids=[];raw.active=raw.assigned=raw.listed=0;};
export const originalCounterexamples = [
  ['MC1-last-observation-total-decrease',v=>{v.native.lastObservation.total=2;}],
  ['MC1-last-normal-total-decrease',v=>{v.native.lastNormalMembers.total=2;}],
  ['MC1-terminal-sample-total-decrease-and-row-omission',v=>{const s=copy(v.native.terminalSamples[0]);s.members.total=2;s.processes.pop();v.native.terminalSamples.unshift(s);} ],
  ['MC2-extra-close-error-despite-success-flags',v=>{v.native.handleInventory['gate-member-2'].closeError=6;}],
  ['MC2-job-close-error-despite-success-flags',v=>{v.native.handleInventory.job.closeError=6;}],
  ['MC2-retained-failed-membership-query',v=>{v.native.events.push({kind:'offending-membership',data:{phase:'terminal',queryOk:false,accountingOk:false,complete:false,queryError:5,accountingError:5}});} ],
];
for(const[name,change]of originalCounterexamples)test('original '+name+' refuses with valid recomputed transport',()=>{
  const v=memberInput();change(v);const r=assess(v);assert.equal(r.transport.complete,true);assert.equal(r.phase.complete,false);
  assert.equal(r.captureComplete,false);assert.equal(r.normalQualificationPassed,false);assert.equal(r.ownedSetClosureConfirmed,false);assert.equal(r.safeForReuse,false);
});
for(const[name,change]of [
  ['fresh alias',n=>{n.freshOwner.total=1;}],
  ['before-resume alias',n=>{n.beforeResume.total=2;}],
  ['live alias',n=>{n.liveMembers={...n.liveMembers,total:2,pids:[100,101],assigned:2,listed:2,active:2};}],
  ['last normal alias',n=>{n.lastNormalMembers.total=2;}],
  ['last observation alias',n=>{n.lastObservation.total=2;}],
  ['owner acquired mirror',n=>{n.events.find(e=>e.kind==='owner-acquired').data.members.total=1;}],
  ['required role mirror',n=>{lower(n.events.find(e=>e.kind==='required-workload-bound').data.members);} ],
  ['empty outcome mirror',n=>{n.events.find(e=>e.kind==='normal-owned-set-empty').data.total=2;}],
  ['membership event',n=>{const e=copy(n.events.find(e=>e.kind==='membership'&&e.data.total===3));lower(e.data);n.events.push(e);} ],
  ['earlier terminal sample',n=>{const s=copy(n.terminalSamples[0]);s.members.total=2;s.processes.pop();n.terminalSamples.unshift(s);} ],
  ['terminal event without matching samples',n=>{const s=copy(n.terminalSamples[0].members);s.pids=[102];s.assigned=s.listed=s.active=1;n.events.push({kind:'membership',data:s});}],
  ['terminal event/state decrease',n=>{n.events.push({kind:'membership',data:copy(n.terminalEvidence.members)});const s=copy(n.terminalEvidence.members);s.total=2;n.events.push({kind:'membership',data:s});}],
])test('MC1 '+name+' cannot contradict other retained representations',()=>{
  const v=memberInput();change(v.native);const r=assess(v);assert.equal(r.normalQualificationPassed,false);assert.equal(r.ownedSetClosureConfirmed,false);
});
for(const role of ['root','gate-member-1','gate-member-2','thread','job','stdin','child'])for(const key of ['closeError','win32Error'])
  test('MC2 retained '+role+' '+key+' overrides success disposition and zero aggregate counter',()=>{
    const v=memberInput();v.native.handleInventory[role][key]=6;assert.equal(v.native.observation.failures,0);
    const r=assess(v);assert.equal(r.normalQualificationPassed,false);assert.equal(r.ownedSetClosureConfirmed,false);
  });
test('MC2 acquisition row error cannot be erased by acquired binding summary',()=>{
  const v=memberInput();v.native.memberAcquisitions[1].win32Error=5;const r=assess(v);assert.equal(r.ownedSetClosureConfirmed,false);
});
test('MC2 retained lifetime close error cannot be erased by closed:true',()=>{
  const v=memberInput();v.native.lifetimes[2].closeError=6;const r=assess(v);assert.equal(r.ownedSetClosureConfirmed,false);
});
test('MC2 successful zero query errors and ordinary pending waits remain valid',()=>{
  const v=memberInput();for(const life of v.native.lifetimes)for(const key of ['pid','creation','membership'])assert.equal(life.initial.queries[key].win32Error,0);
  const s=copy(v.native.terminalSamples[0]);s.members.pids=[102];s.members.assigned=s.members.listed=s.members.active=1;s.processes[2].wait.result=258;s.processes[2].exit.code=259;
  v.native.terminalSamples.unshift(s);const r=assess(v);assert.equal(r.normalQualificationPassed,true);assert.equal(r.ownedSetClosureConfirmed,true);
});
for(const key of ['closeError','win32Error'])test('MC2 error-only lifecycle field '+key+' remains a failure even with diagnostic zero',()=>{
  const v=memberInput();v.native.handleInventory['gate-member-2'][key]=0;assert.equal(assess(v).ownedSetClosureConfirmed,false);
});
test('MC2 a complete offending observation refuses normal success without inventing an ownership query failure',()=>{
  const v=memberInput();v.native.events.push({kind:'offending-membership',data:copy(v.native.terminalEvidence.members)});
  const r=assess(v);assert.equal(r.normalQualificationPassed,false);assert.equal(r.ownedSetClosureConfirmed,true);assert.ok(r.normalReasons.includes('retained-offending-membership'));
});
// Two production-shaped later-acquisition histories. The final third lifetime must not be
// retroactively required in an earlier sample that genuinely precedes its bounded acquisition.
export function laterAcquisition({duringTerminal=false}={}) {
  const v=memberInput(),n=v.native,[root,child,extra]=n.lifetimes;
  const live={...copy(n.liveMembers),pids:[100,101],assigned:2,listed:2,active:2,total:2};n.liveMembers=live;
  const initial=e=>({kind:'handle-observation',data:copy(e.initial)}),observations=rows=>rows.map(data=>({kind:'gate-handle-observation',data:copy(data)}));
  const prefix=n.events.slice(0,n.events.findIndex(e=>e.kind==='membership'&&e.data.phase==='normal-live'));
  const bound={kind:'required-workload-bound',data:{bindings:copy(n.workloadBindings),members:copy(live)}},release={kind:'normal-release',data:{workloadBindings:copy(n.workloadBindings)}};
  const final=copy(n.terminalEvidence),terminalEvent=s=>({kind:'membership',data:copy(s.members)});
  if(duringTerminal) {
    n.originalFailure=n.error='TimeoutException: original normal closure';n.normalExited=false;n.terminateRequested=true;n.terminateReturned=true;v.outer.status=v.outer.exitStatus=2;
    n.lastNormalMembers={...copy(live),phase:'success-terminal',pids:[101],assigned:1,listed:1,active:1};
    const early={members:{...copy(n.lastNormalMembers),phase:'terminal'},processes:[copy(root.terminal),copy(child.terminal)]};early.processes[1].wait.result=258;early.processes[1].exit.code=259;
    const acquired=copy(final);acquired.members.pids=[102];acquired.members.assigned=acquired.members.listed=acquired.members.active=1;
    acquired.processes[2].wait.result=258;acquired.processes[2].exit.code=259;
    n.terminalSamples=[early,acquired,final];n.terminalEvidence=copy(final);n.lastObservation=copy(final.members);
    n.events=[...prefix,{kind:'membership',data:copy(live)},initial(child),bound,release,{kind:'membership',data:copy(n.lastNormalMembers)},
      terminalEvent(early),...observations(early.processes),terminalEvent(acquired),initial(extra),...observations(acquired.processes),terminalEvent(final),...observations(final.processes)];
  } else {
    n.events=[...prefix,{kind:'membership',data:copy(live)},initial(child),bound,release,
      {kind:'membership',data:{...copy(n.lastNormalMembers),pids:[102],assigned:1,listed:1,active:1}},initial(extra),
      {kind:'membership',data:copy(n.lastNormalMembers)},{kind:'normal-owned-set-empty',data:copy(n.lastNormalMembers)},terminalEvent(final),...observations(final.processes)];
  }
  return v;
}
test('MC1 later bounded acquisition after role binding preserves normal success when every lifetime is covered',()=>{
  const r=assess(laterAcquisition());assert.deepEqual(r.normalReasons,[]);assert.equal(r.normalQualificationPassed,true);assert.equal(r.ownedSetClosureConfirmed,true);
});
test('MC1 later bounded acquisition between terminal samples preserves physical closure and original normal failure',()=>{
  const r=assess(laterAcquisition({duringTerminal:true}));assert.deepEqual(r.phase.reasons,[]);assert.equal(r.normalQualificationPassed,false);assert.equal(r.ownedSetClosureConfirmed,true);
  assert.equal(r.native.originalFailure,'TimeoutException: original normal closure');
});
test('MC1 same-count earlier sample cannot omit an applicable lifetime in favor of a later one',()=>{
  const v=laterAcquisition({duringTerminal:true});v.native.terminalSamples[0].processes[1]=copy(v.native.lifetimes[2].terminal);
  const r=assess(v);assert.equal(r.ownedSetClosureConfirmed,false);assert.ok(r.phase.reasons.includes('terminal-accounting-lifetime-gap'));
});
test('MC1 terminal event chronology cannot be erased by otherwise valid sample totals',()=>{
  const v=laterAcquisition({duringTerminal:true}),n=v.native;const queries=n.events.filter(e=>e.kind==='membership'&&e.data.phase==='terminal');
  [queries[0].data,queries[1].data]=[queries[1].data,queries[0].data];assert.equal(assess(v).ownedSetClosureConfirmed,false);
});
test('MC1 an unseen before-resume cumulative member cannot be backfilled by later bound lifetimes',()=>{
  const v=memberInput();v.native.beforeResume.total=2;v.native.events.find(e=>e.kind==='membership'&&e.data.phase==='before-resume').data.total=2;
  const r=assess(v);assert.equal(r.ownedSetClosureConfirmed,false);assert.ok(r.phase.reasons.includes('cumulative-member-not-observed-at-query'));
});
test('MC1 an unseen earlier live member cannot be erased by a later complete live snapshot',()=>{
  const v=memberInput(),n=v.native,index=n.events.findIndex(e=>e.kind==='membership'&&e.data.phase==='normal-live');
  const raw={...copy(n.beforeResume),phase:'normal-live',total:2};n.events.splice(index,0,{kind:'membership',data:raw});
  assert.equal(assess(v).ownedSetClosureConfirmed,false);
});
