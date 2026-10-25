// Static/source and data-only controls. Never imports an executable root, native helper or controller.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {phaseAssessment} from './phase-capture.mjs';
import {diagnosticAssessment} from './diagnostic-capture.mjs';
import {positive} from './query-control-input.mjs';
import {gateInput,refreshGate,TEST_SOURCE_SHA} from './root-gate-input.mjs';
import {interpretRootGate} from './root-gate-capture.mjs';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
test('normal native source changes only the partial declaration and two default-false gate seams',()=>{
  const old=read('../../../.local/root-gate-prepare/accepted-source/WindowsJobOwner.cs');
  const projected=read('WindowsJobOwner.cs').replace('public sealed partial class FirstMateJobCapability','public sealed class FirstMateJobCapability')
    .replace(/^        if \(rootGate\) signature \+=.*\r?\n/m,'')
    .replace('if (rootGate) GateCaptureMembers(result); else CaptureDiagnosticMembers(result);','CaptureDiagnosticMembers(result);');
  assert.equal(projected,old);
  assert.ok(read('WindowsJobOwner.cs').includes('if (pids.Count > 2 || !pids.Contains(owner.root.Pid))'));
  assert.ok(read('WindowsJobOwner.cs').includes('(uint)pair["total"] != 2'));
});
test('root gate exactly preserves startup/import/committed marker prefix, then has no reachable child call',()=>{
  const root=read('root.mjs'),gate=read('root-gate.mjs'),prefix=root.slice(0,root.indexOf('const child = spawn('));
  assert.ok(gate.startsWith(prefix));
  assert.equal(gate.slice(prefix.length),'// Distinct root-only gate: no child call is reachable. The owner terminates after the marker.\nAtomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);\n');
  assert.ok(!gate.includes("from './root.mjs'"));assert.equal((gate.match(/\bspawn\s*\(/g)??[]).length,0);
});
test('native setup/explicit flags/deadline precede resume and all refusal paths enter owner cleanup',()=>{
  const text=read('WindowsRootGate.cs'),entry=text.slice(text.indexOf('public static Dictionary<string, object> QualifyRootGate'));
  assert.ok(entry.indexOf('owner.Acquire()')<entry.indexOf('CreateProcessW('));
  assert.ok(entry.indexOf('new Timer(')<entry.indexOf('CreateProcessW('));assert.ok(entry.indexOf('CreateProcessW(')<entry.indexOf('ResumeThread('));
  assert.ok(entry.includes('Suspended | UnicodeEnvironment | NoWindow | 0x80000'));assert.equal((entry.match(/CreateProcessW\(/g)??[]).length,1);
  assert.ok(entry.indexOf('} finally {')<entry.indexOf('owner.Terminate("root-gate-"'));
  assert.ok(!text.includes('QualifyNormal('));assert.ok(!text.includes('RunOwned('));
  assert.ok(!/GetProcesses|Process32|BREAKAWAY|DETACHED_PROCESS|conhost/i.test(text));
  assert.ok(text.includes('readonly IntPtr Handle'));assert.ok(text.includes('root.Process != life.Handle'));
});
test('terminal source never looks up an image; wait/exit returned errors are immediately accounted',()=>{
  const text=read('WindowsRootGate.cs'),start=text.indexOf('Dictionary<string, object> GateObserveTerminal'),end=text.indexOf('void GateTerminalCapture',start),body=text.slice(start,end);
  assert.ok(!body.includes('QueryFullProcessImageNameW'));assert.ok(body.includes('"attempted", false'));assert.ok(body.includes('"bindingRef", life.Ref()'));
  assert.equal((body.match(/WaitForSingleObject\(/g)??[]).length,1);assert.equal((body.match(/GetExitCodeProcess\(/g)??[]).length,1);
  assert.ok(body.includes('if (wait == UInt32.MaxValue) ObservationError'));assert.ok(body.includes('if (!ok) ObservationError'));
});
test('initial binding is latched before queries and a replay returns without replacing the first observation',()=>{
  const text=read('WindowsRootGate.cs'),start=text.indexOf('void GateBindLive('),end=text.indexOf('void GateCaptureMembers',start),body=text.slice(start,end);
  assert.ok(body.indexOf('if (life.InitialAttempted)')<body.indexOf('life.InitialAttempted = true'));
  assert.ok(body.indexOf('life.InitialAttempted = true')<body.indexOf('ObserveProcess('));
  assert.ok(body.slice(0,body.indexOf('life.InitialAttempted = true')).includes('return;'));
  assert.equal((body.match(/life.Initial = /g)??[]).length,1);
});
test('native close precedes fallible recording; counterfactual recording-first order is rejected',()=>{
  const text=read('WindowsRootGate.cs'),start=text.indexOf('bool GateClose('),end=text.indexOf('public static',start),body=text.slice(start,end);
  const order=source=>source.indexOf('CloseHandle(handle)')>=0 && source.indexOf('CloseHandle(handle)')<source.indexOf('Step("record root-gate close"');
  assert.equal(order(body),true);assert.equal(order(body.replace('CloseHandle(handle)','SKIPPED_NATIVE_CALL()')+'\nCloseHandle(handle);'),false);
  // Finite source-order model: injected observational exceptions cannot remove the prior close or the next outer Step.
  const closed=[],failures=[];
  for(const role of ['root','extra','thread','job','stdin']){try{closed.push(role);try{throw Error('recording sink');}catch(e){failures.push(e.message);}}catch{}}
  assert.deepEqual(closed,['root','extra','thread','job','stdin']);assert.equal(failures.length,5);
  assert.ok(text.includes('foreach (var life in owner.gateLifetimes)'));assert.ok(text.includes('owner.Step("root-gate process close"'));
});
test('legacy dispatcher retains exact old behavior including NC1 original failures',()=>{
  for(const change of [()=>{},n=>{n.diagnosticMembers[0].initial.exit={ok:false,win32Error:5};},n=>{n.terminalEvidence.root.wait={ok:false,win32Error:6};}]){
    const input=positive(),n=input.helperFile.nativeResult;change(n);assert.deepEqual(phaseAssessment(input,n),diagnosticAssessment(input,n));
  }
});
test('frozen source pins, helper source set and absent dispatch prevent preparation from opening a target boundary',()=>{
  const controller=read('root-gate-controller.mjs');const match=controller.match(/GATE_PINS = Object.freeze\((\{[^;]+\})\);/);assert.ok(match);
  const pins=JSON.parse(match[1]);for(const[name,pin]of Object.entries(pins))assert.equal(createHash('sha256').update(readFileSync(new URL(name,import.meta.url))).digest('hex'),pin);
  const helper=read('root-gate-only.ps1');const names=helper.match(/\$allowed = @\(([^\n]+)\)/)[1].match(/'([^']+)'/g).map(s=>s.slice(1,-1));assert.deepEqual(names.sort(),Object.keys(pins).sort());
  assert.ok(controller.indexOf("'ROOT_GATE_DISPATCH_HOLD'")<controller.indexOf('mkdirSync(parent'));
  assert.ok(helper.indexOf('ROOT_GATE_DISPATCH_HOLD')<helper.indexOf('Add-Type -Path'));
  assert.ok(!existsSync(new URL('../../../.local/owner-root-gate/root-gate-1.dispatch.json',import.meta.url)));
  assert.ok(!existsSync(new URL('../../../.local/owner-root-gate/root-gate-1',import.meta.url)));
});
const mutateFrame=(input,change)=>{
  const frame=JSON.parse(Buffer.from(input.outer.stdout.data,'base64'));change(frame);const raw=Buffer.from(JSON.stringify(frame)+'\n');
  input.outer.stdout={...input.outer.stdout,bytes:raw.length,retained:raw.length,data:raw.toString('base64')};
};
for(const [name,change]of [
  ['digest',f=>{f.file.sha256='0'.repeat(64);}],['length',f=>{f.file.bytes++;}],['post-write disposal',f=>{f.file.complete=false;}],
  ['post-write recording failure',f=>{f.recordingError={message:'file close',truncated:false};}],['identity',f=>{f.nonce='wrong';}],
])test(`final frame ${name} discrepancy refuses independently of native data`,()=>{
  const i=gateInput();mutateFrame(i,change);const r=interpretRootGate(i,TEST_SOURCE_SHA);assert.equal(r.captureComplete,false);assert.equal(r.ownedSetClosureConfirmed,false);assert.equal(r.normalQualificationPassed,false);
});
for(const [name,change]of [
  ['exit missing',o=>{o.exitObserved=false;}],['close missing',o=>{o.closed=false;}],['exit/close disagree',o=>{o.exitStatus=2;}],
  ['stderr nonempty',o=>{o.stderr={bytes:1,retained:1,data:'eA==',encoding:'base64',drained:true,closed:true,dropped:0,errors:0};}],
])test(`external ${name} is not manufactured from file success`,()=>{const i=gateInput();change(i.outer);const r=interpretRootGate(i,TEST_SOURCE_SHA);assert.equal(r.captureComplete,false);assert.equal(r.ownedSetClosureConfirmed,false);});
test('partial/false native complete flag cannot be reconstructed from plausible successful fields',()=>{
  const i=gateInput();i.native.events.push({kind:'membership',data:{...i.native.gateSnapshot,complete:false}});refreshGate(i);assert.equal(interpretRootGate(i,TEST_SOURCE_SHA).captureComplete,false);
});
test('recording failure and missing member terminal remain unknown despite all subset closes',()=>{
  const i=gateInput({extra:1,marker:false});i.native.observation.failures=1;i.native.observation.errors=['sink failure'];i.native.terminalEvidence.processes.pop();refreshGate(i);
  const r=interpretRootGate(i,TEST_SOURCE_SHA);assert.equal(r.discrimination,'extra-member-observed-without-child-call');assert.equal(r.captureComplete,false);assert.equal(r.ownedSetClosureConfirmed,false);
});
test('marker cannot convert an unexpected-member snapshot into a reached gate',()=>{
  const i=gateInput({extra:1,marker:true});i.native.stopReason='marker';i.native.markerObservedBeforeStop=true;refreshGate(i);
  const r=interpretRootGate(i,TEST_SOURCE_SHA);assert.equal(r.gateReached,false);assert.equal(r.captureComplete,false);
});
test('before-resume refusal must bind the extra member in the before-resume inventory',()=>{
  const i=gateInput({extra:1,marker:false});i.native.stopReason='unexpected-before-resume';i.native.targetResumed=false;refreshGate(i);
  assert.equal(interpretRootGate(i,TEST_SOURCE_SHA).captureComplete,false);
  i.native.beforeResume=structuredClone(i.native.gateSnapshot);refreshGate(i);
  i.native.events=i.native.events.filter(e=>e.kind!=='root-resumed');refreshGate(i);
  const r=interpretRootGate(i,TEST_SOURCE_SHA);assert.equal(r.captureComplete,true);assert.equal(r.gateReached,false);assert.equal(r.gateVerdict,'refused-extra-member');
});
test('owner-acquired nested membership cannot hide an unacquired member or partial query',()=>{
  const i=gateInput();i.native.events.find(e=>e.kind==='owner-acquired').data.members={...i.native.freshOwner,total:1,pids:[999],active:1,assigned:1,listed:1};refreshGate(i);
  const r=interpretRootGate(i,TEST_SOURCE_SHA);assert.equal(r.captureComplete,false);assert.equal(r.ownedSetClosureConfirmed,false);
});
test('an unexpected root exit is preserved separately from confirmed handle closure',()=>{
  const i=gateInput();i.native.lifetimes[0].terminal.exit.code=1;i.native.handleInventory.root.observation.exit.code=1;
  i.native.terminalEvidence.processes[0].exit.code=1;i.native.terminalSamples[0].processes[0].exit.code=1;refreshGate(i);
  const r=interpretRootGate(i,TEST_SOURCE_SHA);assert.equal(r.captureComplete,false);assert.equal(r.ownedSetClosureConfirmed,true);assert.equal(r.safeForReuse,false);
});
