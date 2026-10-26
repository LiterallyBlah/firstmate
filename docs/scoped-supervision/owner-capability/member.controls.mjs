// Finite data-only controls; source/receipt reads only. No executable controller/helper/workload import.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {interpretMemberNormal} from './member-capture.mjs';
import {memberPhaseAssessment} from './member-phase.mjs';
import {memberInput,refreshMember,commitMember,MEMBER_TEST_SHA} from './member-input.mjs';
import {sealOwnerCapture} from './admission.mjs';
import {interpretNormal} from './qualify-normal.mjs';
import {positive,refreshFinal} from './query-control-input.mjs';
import {interpretRootGate} from './root-gate-capture.mjs';
import {gateInput,TEST_SOURCE_SHA} from './root-gate-input.mjs';
const assess=input=>interpretMemberNormal(refreshMember(input),MEMBER_TEST_SHA);
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
test('explicit new contract accepts root + committed expected child + fully bound extra of any image',()=>{
  for(const image of ['C:\\unrecognized.exe','C:\\Windows\\System32\\conhost.exe','C:\\node.exe']) {
    const v=memberInput();v.native.lifetimes[2].initial.identity.image=image;
    v.native.events.find(e=>e.kind==='handle-observation'&&e.data.role===v.native.lifetimes[2].bindingRef.role).data=structuredClone(v.native.lifetimes[2].initial);
    const result=assess(v);assert.deepEqual(result.normalReasons,[]);assert.equal(result.normalQualificationPassed,true);
    assert.equal(result.ownedSetClosureConfirmed,true);assert.equal(result.actualRuntimeQualified,false);assert.equal(result.anotherCaseAuthorized,false);
  }
});
test('pair-only and eight fully bound members both preserve required roles and bounds',()=>{
  for(const extras of [0,6])assert.equal(assess(memberInput({extras})).normalQualificationPassed,true);
});
test('legacy exact-two positive remains accepted; complete extra still refused by legacy pair guard',()=>{
  const v=positive();assert.equal(interpretNormal(v).normalQualificationPassed,true);
  v.helperFile.nativeResult.liveMembers={...v.helperFile.nativeResult.liveMembers,assigned:3,listed:3,active:3,total:3,pids:[12,13,14]};refreshFinal(v);
  assert.equal(interpretNormal(v).normalQualificationPassed,false);assert.ok(sealOwnerCapture({...v,native:v.helperFile.nativeResult}).problems.includes('missing-complete-live-membership'));
});
test('old root-only gate still refuses the same complete extra and never qualifies normal',()=>{
  const v=gateInput({extra:1,marker:false}),r=interpretRootGate(v,TEST_SOURCE_SHA);
  assert.equal(r.gateVerdict,'refused-extra-member');assert.equal(r.gateReached,false);assert.equal(r.normalQualificationPassed,false);
});
for(const[name,change]of [
  ['extra binding substituted for expected child',v=>{v.native.workloadBindings.expectedChild=structuredClone(v.native.lifetimes[2].bindingRef);}],
  ['missing committed child',v=>{v.childEntry=null;v.childEntryRaw=null;delete v.native.committedEntries['child-entry.json'];}],
  ['committed child missing from held set',v=>{v.childEntry.pid=999;v.rootEntry.childPid=999;commitMember(v);}],
  ['child entry points to extra image',v=>{v.childEntry.pid=102;v.rootEntry.childPid=102;v.native.workloadBindings.expectedChild=structuredClone(v.native.lifetimes[2].bindingRef);commitMember(v);}],
  ['wrong child parent',v=>{v.childEntry.ppid=900;commitMember(v);}],
  ['wrong root helper',v=>{v.rootEntry.ppid=900;commitMember(v);}],
  ['wrong nonce',v=>{v.childEntry.nonce=v.caseId;commitMember(v);}],
  ['reused root instance',v=>{v.childEntry.instance=v.rootEntry.instance;commitMember(v);}],
  ['root pre-spawn instance changed',v=>{v.rootPreSpawn.instance=v.childEntry.instance;commitMember(v);}],
  ['changed fixed child entry',v=>{v.rootPreSpawn.childEntry='C:\\other.mjs';commitMember(v);}],
  ['raw committed bytes disagree',v=>{v.childEntryRaw=Buffer.from('{}');}],
  ['partial commit',v=>{v.entryPartialsPresent=true;}],
  ['missing original child result',v=>{v.childResult=null;}],
  ['original root result failure',v=>{v.rootResult.childCode=1;}],
  ['child output loss',v=>{v.childOutput.stderr.dropped=1;}],
  ['malformed child output bytes with complete counters',v=>{v.childOutput.stderr.data='not-base64';}],
  ['missing child output bytes with complete counters',v=>{delete v.childOutput.stderr.data;}],
  ['deadline fired',v=>{v.native.deadlineFired=true;}],
  ['forced owned termination',v=>{v.native.terminateRequested=true;}],
  ['required child nonzero exit',v=>{v.native.lifetimes[1].terminal.exit.code=197;v.native.terminalEvidence.processes[1].exit.code=197;v.native.terminalSamples[0].processes[1].exit.code=197;v.native.handleInventory['gate-member-1'].observation.exit.code=197;}],
])test(name+' refuses normal without inventing historical closure',()=>{
  const v=memberInput();change(v);const r=assess(v);assert.equal(r.normalQualificationPassed,false);
  assert.deepEqual(r.historicalClosures,['C2:failed/unknown','normal1:failed/unknown','normal2:failed/unknown']);assert.equal(r.actualRuntimeQualified,false);
});
test('missing committed child/outcome is separate from otherwise complete physical closure',()=>{
  const v=memberInput();v.childEntry=null;v.childEntryRaw=null;delete v.native.committedEntries['child-entry.json'];
  const r=assess(v);assert.equal(r.requiredWorkloadRolesConfirmed,false);assert.equal(r.normalQualificationPassed,false);assert.equal(r.ownedSetClosureConfirmed,true);
});
for(const[name,change]of [
  ['unseen cumulative member',v=>{v.native.lastObservation.total=4;}],
  ['extra member omitted from held lifetimes',v=>{v.native.lifetimes.pop();}],
  ['acquisition missing',v=>{v.native.memberAcquisitions.pop();}],
  ['failed acquisition',v=>{v.native.memberAcquisitions[1].acquisition='failed';}],
  ['lifetime replaced',v=>{v.native.replacementDetected=true;}],
  ['continuity lost',v=>{v.native.lifetimes[2].continuous=false;}],
  ['bound overflow',v=>{v.native.lifetimeOverflow=1;}],
  ['observation loss',v=>{v.native.observation.dropped=1;}],
  ['observation sink failure',v=>{v.native.observation.failures=1;v.native.observation.errors=['sink'];}],
  ['nonterminal extra',v=>{v.native.terminalEvidence.processes[2].wait.result=258;}],
  ['extra disposal failed',v=>{v.native.handleInventory['gate-member-2'].disposition='close-failed';}],
  ['lifetime disposal absent',v=>{delete v.native.lifetimes[2].closed;}],
  ['job disposal failed',v=>{v.native.cleanup.jobHandleClosed=false;}],
  ['root stream loss',v=>{v.native.rootOutput.stderr.dropped=1;}],
  ['partial job query',v=>{v.native.events.find(e=>e.kind==='membership').data.queryOk=false;}],
  ['accounting query failed',v=>{v.native.terminalSamples[0].members.accountingError=5;}],
  ['dropped terminal row',v=>{v.native.terminalEvidence.processes.pop();}],
  ['omitted resource inventory',v=>{delete v.native.handleInventory['gate-member-2'];}],
])test(name+' refuses admission and closure',()=>{
  const v=memberInput();change(v);const r=assess(v);assert.equal(r.normalQualificationPassed,false);assert.equal(r.ownedSetClosureConfirmed,false);
});
for(const location of ['initial','retained-terminal','terminal-event','inventory','final'])for(const query of ['wait','exit'])
  test('NC1 '+query+' failure in '+location+' cannot be repaired by successful later sample or zero counter',()=>{
    const v=memberInput(),n=v.native;
    const row=location==='initial'?n.lifetimes[2].initial:location==='retained-terminal'?n.terminalSamples[0].processes[2]:
      location==='terminal-event'?n.events.find(e=>e.kind==='gate-handle-observation'&&e.data.role==='gate-member-2').data:
      location==='inventory'?n.handleInventory['gate-member-2'].observation:n.terminalEvidence.processes[2];
    row[query]={ok:false,win32Error:6};assert.equal(n.observation.failures,0);const r=assess(v);assert.equal(r.ownedSetClosureConfirmed,false);
    assert.ok(r.phase.reasons.includes('recorded-required-query-or-reference-failure'));
  });
test('successful pending 258 in earlier terminal sample remains allowed until all members close',()=>{
  const v=memberInput(),pending=structuredClone(v.native.terminalSamples[0]);
  pending.members={...pending.members,pids:[102],active:1,assigned:1,listed:1};pending.processes[2].wait.result=258;pending.processes[2].exit.code=259;
  v.native.terminalSamples.unshift(pending);assert.equal(assess(v).normalQualificationPassed,true);
});
test('new member version refuses legacy/rootgate schemas; old gate reader refuses new version',()=>{
  const v=memberInput();for(const[c,d]of[[2,1],[3,2]]){v.native.captureVersion=c;v.native.diagnosticVersion=d;assert.equal(assess(v).normalQualificationPassed,false);}
  assert.equal(memberPhaseAssessment({},gateInput().native).complete,false);
  const oldGate=interpretRootGate(memberInput(),MEMBER_TEST_SHA);assert.equal(oldGate.captureComplete,false);assert.equal(oldGate.normalQualificationPassed,false);
});
for(const[name,change]of [
  ['WAIT_FAILED reported as successful',v=>{v.wait={ok:true,result:0xffffffff};}],
  ['wait Win32 error with successful flag',v=>{v.wait={ok:true,result:258,win32Error:6};}],
  ['exit Win32 error with successful flag',v=>{v.exit={ok:true,code:259,win32Error:5};}],
])test('original NC1 inconsistent raw counterexample: '+name,()=>{
  const v=memberInput();change(v.native.lifetimes[2].initial);assert.equal(v.native.observation.failures,0);assert.equal(assess(v).ownedSetClosureConfirmed,false);
});
test('original native failure stays separately retained while independently complete physical closure can be confirmed',()=>{
  const v=memberInput();v.native.error=v.native.originalFailure='InvalidOperationException: original case';v.outer.status=v.outer.exitStatus=2;
  const r=assess(v);assert.equal(r.native.originalFailure,'InvalidOperationException: original case');assert.equal(r.transport.complete,true);
  assert.equal(r.normalQualificationPassed,false);assert.equal(r.ownedSetClosureConfirmed,true);
});
test('transport frame, raw file, helper exit/close, loss and complete-file disposal remain required',()=>{
  for(const change of [v=>{v.outer.exitObserved=false;},v=>{v.outer.closed=false;},v=>{v.outer.stdout.dropped=1;},
    v=>{v.helperFileRaw=Buffer.concat([v.helperFileRaw,Buffer.from(' ')]);},v=>{v.outer.stderr.bytes=1;},v=>{v.outer.observation.failures=1;}]) {
    const v=memberInput();change(v);const r=interpretMemberNormal(v,MEMBER_TEST_SHA);assert.equal(r.normalQualificationPassed,false);assert.equal(r.ownedSetClosureConfirmed,false);
  }
});
test('bounded maximum fully populated success receipt fits the unchanged 2 MiB file and 32 KiB frame',()=>{
  const v=memberInput({extras:6}),n=v.native;for(const life of n.lifetimes){life.initial.identity.image=life===n.lifetimes[0]||life===n.lifetimes[1]?v.nodePath:'x'.repeat(1024);}
  for(const e of n.events)if(e.kind==='handle-observation')e.data=structuredClone(n.lifetimes.find(l=>l.bindingRef.role===e.data.role).initial);
  n.terminalSamples=Array.from({length:8},()=>structuredClone(n.terminalEvidence));while(n.events.length<64)n.events.push({kind:'gate-handle-observation',data:structuredClone(n.lifetimes.at(-1).terminal)});
  const r=assess(v);assert.equal(r.normalQualificationPassed,true);assert.ok(v.helperFileRaw.length<2097152);assert.ok(v.outer.stdout.bytes<32768);
});
test('native source uses only creation-time owner and reviewed immutable lifetime path; unchanged flags/deadlines/bounds',()=>{
  const text=read('WindowsMemberNormal.cs');assert.equal((text.match(/CreateProcessW\(/g)??[]).length,1);
  assert.ok(text.indexOf('owner.Acquire()')<text.indexOf('CreateProcessW('));assert.ok(text.indexOf('new Timer(')<text.indexOf('CreateProcessW('));
  assert.ok(text.includes('Suspended | UnicodeEnvironment | NoWindow | 0x80000'));assert.ok(text.includes('null, 5000, Timeout.Infinite'));
  assert.ok(text.includes('closure.ElapsedMilliseconds < 8000'));assert.ok(text.includes('(uint)members["total"] > 8'));
  assert.ok(!/conhost|GetProcesses|Process32|BREAKAWAY|DETACHED_PROCESS|QualifyNormal\(|RunOwned\(/i.test(text));
  assert.ok(text.includes('MemberPid(descendant, "pid")'));assert.ok(text.includes('MemberPid(parent, "childPid") != childPid'));
  assert.ok(text.includes('life.Initial'));assert.ok(text.indexOf('receipt["workloadBindings"] =')<text.indexOf('File.WriteAllText(Path.Combine(directory, "release")'));
  assert.ok(text.includes('owner.GateTerminalCapture'));assert.ok(text.includes('owner.GateClose(current.Role, current.Handle)'));
});
