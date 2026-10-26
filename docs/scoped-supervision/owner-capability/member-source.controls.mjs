// Static checks and inert data only: never import a controller, helper, fixture or assembly.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=n=>readFileSync(new URL(n,import.meta.url),'utf8'),raw=n=>readFileSync(new URL(n,import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
test('all frozen legacy/rootgate critical sources and original workloads remain byte-identical',()=>{
  for(const[n,h]of Object.entries({'WindowsJobOwner.cs':'1b0117215cc80f81ab199e206a6da64a11ec6166ffc3db8a12546d7e368fa2c0',
    'WindowsRootGate.cs':'09f44cdec979dc45240651e1847c7dadb94956f2d178ed2eeb9f50a903073593',
    'phase-capture.mjs':'87d7c787352da747061dfde46e89bfbeefd27eee8036f78309d25a334b64fa2d',
    'root.mjs':'9fc52a21eeee7f311cda8a55214cfe08c494532a4b703da9fbf844df7f3ba727',
    'child.mjs':'1d5201bb4fb63e88f83c9831e46e6bc131a8fff38d11fd37f5e90e846189a6e3'}))assert.equal(sha(raw(n)),h,n);
});
test('frozen new template, controller/native/source/image pins agree and activation paths remain absent',()=>{
  const controller=read('member-normal-controller.mjs'),helper=read('member-normal-only.ps1'),template=JSON.parse(read('member-normal.dispatch.template.json'));
  const pins=JSON.parse(controller.match(/MEMBER_PINS = Object.freeze\((\{[^;]+\})\);/)[1]);
  assert.deepEqual(template.sourcePins,pins);assert.equal(Object.keys(pins).length,9);
  for(const[name,h]of Object.entries(pins))assert.equal(sha(raw(name)),h,name);
  assert.equal(template.controllerSha256,sha(raw('member-normal-controller.mjs')));
  assert.equal(template.nativeSourceSha256,sha(Buffer.concat([raw('WindowsJobOwner.cs'),Buffer.from([0]),raw('WindowsRootGate.cs'),Buffer.from([0]),raw('WindowsMemberNormal.cs')])));
  assert.ok(controller.includes(template.nativeSourceSha256));assert.ok(controller.includes(template.caseId)&&controller.includes(template.nonce));
  const names=helper.match(/\$allowed = @\(([^\n]+)\)/)[1].match(/'([^']+)'/g).map(s=>s.slice(1,-1));assert.deepEqual(names.sort(),Object.keys(pins).sort());
  assert.ok(!existsSync(new URL('../../../.local/owner-member-normal/member-normal-1',import.meta.url)));
  assert.ok(!existsSync(new URL('../../../.local/owner-member-normal/member-normal-1.dispatch.json',import.meta.url)));
  assert.ok(controller.includes('9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de'));
  assert.ok(controller.includes('60c9b29843624dd8af6b6a7b26147753be6aeef65098b9a503cc50850afe410f'));
});
test('new dispatch precedes every supported process-creating boundary without modifying old holds',()=>{
  const controller=read('member-normal-controller.mjs'),helper=read('member-normal-only.ps1');
  assert.ok(controller.indexOf('MEMBER_NORMAL_DISPATCH_HOLD')<controller.indexOf('mkdirSync(parent'));
  assert.ok(controller.indexOf('assert.deepEqual(dispatch,')<controller.indexOf('spawn(powershell'));
  assert.ok(helper.indexOf('MEMBER_NORMAL_DISPATCH_HOLD')<helper.indexOf("'native.reserved'"));
  assert.ok(helper.indexOf("'native.reserved'")<helper.indexOf('Add-Type -Path'));
  assert.equal((helper.match(/::QualifyMemberNormalV4\(/g)??[]).length,1);
  assert.ok(!/::Run\(|::Preflight\(|::QualifyRootGate\(|::QualifyNormal\(/.test(helper));
  assert.ok(read('WindowsJobOwner.cs').includes('CaptureReviewAccepted = false'));
});
test('native and consumer explicitly agree on schema, roles, committed raw bytes and all retained member evidence',()=>{
  const native=read('WindowsMemberNormal.cs'),phase=read('member-phase.mjs'),capture=read('member-capture.mjs');
  assert.ok(native.includes('"captureVersion", 4, "diagnosticVersion", 3'));assert.ok(phase.includes('n?.captureVersion === 4 && n?.diagnosticVersion === 3'));
  for(const text of [native,phase])assert.ok(text.includes('required-workload-and-owned-set/1'));
  for(const text of [native,capture])for(const word of ['root-pre-spawn.json','root-entry.json','child-entry.json','rawBase64','expectedChild'])assert.ok(text.includes(word),word);
  for(const field of ['n?.liveMembers','n?.lastNormalMembers','n?.lastObservation','samples.map','terminalEvidence','handleInventory','memberAcquisitions'])assert.ok(phase.includes(field),field);
  assert.ok(capture.includes('normalQualificationPassed:passed'));assert.ok(capture.includes('actualRuntimeQualified:false,anotherCaseAuthorized:false'));
});
test('native rejects arbitrary second-member role selection; commitment and held reference precede release',()=>{
  const text=read('WindowsMemberNormal.cs');
  assert.ok(!/pids\[0\]|pids\[1\]|pids.Count == 2|total.*!= 2|conhost/i.test(text));
  const order=s=>s.indexOf('long childPid = MemberPid(descendant, "pid")')>=0&&
    s.indexOf('MemberPid(parent, "childPid") != childPid')>s.indexOf('long childPid =')&&
    s.indexOf('receipt["workloadBindings"] =')>s.indexOf('owner.gateLifetimes.Find(')&&
    s.indexOf('File.WriteAllText(Path.Combine(directory, "release")')>s.indexOf('receipt["workloadBindings"] =');
  assert.equal(order(text),true);assert.equal(order(text.replace('long childPid = MemberPid(descendant, "pid")','long childPid = 123')),false);
});
test('existing wait/exit NC1 and initial/terminal phase rules are reused without alternate native query paths',()=>{
  const native=read('WindowsMemberNormal.cs'),held=read('WindowsRootGate.cs');
  assert.ok(!/WaitForSingleObject\(|GetExitCodeProcess\(|QueryFullProcessImageNameW\(|OpenProcess\(/.test(native));
  assert.ok(native.includes('owner.GateBindLive(rootLife)')&&native.includes('owner.GateTerminalCapture'));
  assert.ok(held.includes('if (wait == UInt32.MaxValue) ObservationError'));assert.ok(held.includes('if (!ok) ObservationError'));
  assert.ok(held.includes('life.InitialAttempted = true'));assert.ok(held.includes('"terminal-retains-initial-binding"'));
  assert.ok(held.includes('for (int sample = 0; sample < 8 && closure.ElapsedMilliseconds < 8000; sample++)'));
});
test('capture bounds, helper complete-after-disposal, raw final frame and separate terminal observations are preserved',()=>{
  const native=read('WindowsMemberNormal.cs'),helper=read('member-normal-only.ps1'),controller=read('member-normal-controller.mjs');
  assert.ok(native.includes('new byte[4097]'));assert.ok(native.includes('count > 4096'));assert.ok(native.includes('MaxJsonLength = 4096'));
  assert.ok(helper.includes('$bytes.Length -gt 2097152'));assert.ok(helper.includes('$frameBytes.Length -gt 32768'));
  assert.ok(helper.indexOf('$file.Dispose()')<helper.indexOf('$descriptor.complete = $true'));
  assert.ok(helper.includes('$stdout.Write($frameBytes'));assert.ok(helper.includes('originalFailure = $original'));
  for(const word of ["helper.once('exit'","helper.once('close'",'15000','3000','observeOutput(helper.stdout)','observeOutput(helper.stderr)','4096'])assert.ok(controller.includes(word),word);
});
