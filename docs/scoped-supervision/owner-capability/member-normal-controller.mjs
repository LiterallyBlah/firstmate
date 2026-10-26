/** Distinct single MEMBER-NORMAL v4 case. Import is inert; the named absent dispatch file holds execution. */
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,openSync,readSync,closeSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {recorder,observeOutput} from './capture.mjs';
import {interpretMemberNormal} from './member-capture.mjs';
export const MEMBER_PINS = Object.freeze({"WindowsJobOwner.cs":"1b0117215cc80f81ab199e206a6da64a11ec6166ffc3db8a12546d7e368fa2c0","WindowsRootGate.cs":"09f44cdec979dc45240651e1847c7dadb94956f2d178ed2eeb9f50a903073593","WindowsMemberNormal.cs":"0e6fcecd7a0d94978e21319bc0fb3325663d10fabdc892c55fa1537683840c62","member-normal-only.ps1":"bdf5bdd5304b1cdc0308db2adaa5d48c85d109095c03fe435faf862524e65590","root.mjs":"9fc52a21eeee7f311cda8a55214cfe08c494532a4b703da9fbf844df7f3ba727","child.mjs":"1d5201bb4fb63e88f83c9831e46e6bc131a8fff38d11fd37f5e90e846189a6e3","capture.mjs":"875933e8b1235230305e8f25162ec94b1f5dc0d85bed9fa4b16cf02f919cfa99","member-phase.mjs":"d7bb20be232cc61667d09c21dcc512f233ec8f82fb41c6dc2b3491335b574ac0","member-capture.mjs":"e2700a771b3006966ee32d63751462468260bc7b4a0e2ba3f2b27fc1040f5352"}); // exact reviewed source bytes; not a runtime override
export const NATIVE_SOURCE_SHA256 = "a61098b3bb597af66232592bf0e2e2caa1db25c0a42f5aee66529e8983ce339b";
export const CASE_ID='0d258e54-3bbe-4e10-9edf-f2b55736941a', NONCE='4637b177-3c51-495f-9095-d79181118466';
const sha=b=>createHash('sha256').update(b).digest('hex');
function bounded(path,errors,limit=2097152) {
  let fd;
  try {fd=openSync(path,'r');const buffer=Buffer.alloc(limit+1);let size=0;
    while(size<buffer.length){const n=readSync(fd,buffer,size,buffer.length-size,null);if(!n)break;size+=n;}
    assert.ok(size<=limit,'Saved file cap');return Buffer.from(buffer.subarray(0,size));
  }catch(error){if(errors.length<8)errors.push({path,error:String(error.message).slice(0,300)});return null;}
  finally{if(fd!==undefined)closeSync(fd);}
}
async function main(){
  assert.equal(process.argv.length,2,'No overrides or second case');assert.equal(process.platform,'win32');assert.equal(process.arch,'x64');assert.equal(process.version,'v24.18.0');
  const source=fileURLToPath(new URL('.',import.meta.url)),repo=fileURLToPath(new URL('../../../',import.meta.url));assert.equal(resolve('.'),resolve(repo));
  const powershell='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
  assert.equal(sha(readFileSync(process.execPath)),'9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de');
  assert.equal(sha(readFileSync(powershell)),'60c9b29843624dd8af6b6a7b26147753be6aeef65098b9a503cc50850afe410f');
  for(const [name,pin] of Object.entries(MEMBER_PINS))assert.equal(sha(readFileSync(join(source,name))),pin,`Changed member source: ${name}`);
  const parent=resolve('.local/owner-member-normal'),directory=join(parent,'member-normal-1'),dispatchPath=join(parent,'member-normal-1.dispatch.json');
  assert.ok(existsSync(dispatchPath),'MEMBER_NORMAL_DISPATCH_HOLD'); // no mkdir/reservation/helper before this supported gate
  const errors=[],dispatchRaw=bounded(dispatchPath,errors);assert.equal(errors.length,0);
  const dispatch=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(dispatchRaw));
  assert.deepEqual(dispatch,{format:'firstmate.member-normal-dispatch/1',scenario:'normal',executeOneMemberNormal:true,caseId:CASE_ID,nonce:NONCE,
    controllerSha256:sha(readFileSync(fileURLToPath(import.meta.url))),sourcePins:MEMBER_PINS,nativeSourceSha256:NATIVE_SOURCE_SHA256});
  assert.ok(!existsSync(directory),'Member-normal reservation already exists');
  mkdirSync(parent,{recursive:true});mkdirSync(directory);mkdirSync(join(directory,'source'));
  for(const name of [...Object.keys(MEMBER_PINS),'member-normal-controller.mjs'])copyFileSync(join(source,name),join(directory,'source',name));
  const save=(name,value)=>{const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value,null,2)+'\n');assert.ok(bytes.length<=2097152,'Saved member file cap');writeFileSync(join(directory,name),bytes,{flag:'wx'});};
  const configuration={directory,nodePath:process.execPath,nodeVersion:process.version,caseId:CASE_ID,nonce:NONCE,scenario:'normal',
    childEntry:join(source,'child.mjs'),rootEntry:join(source,'root.mjs')};save('configuration.json',configuration);save('dispatch.json',dispatchRaw);
  const args=['-NoProfile','-NonInteractive','-File',join(source,'member-normal-only.ps1'),'-OutputDirectory',directory,'-NodePath',process.execPath,'-Configuration',join(directory,'configuration.json')];
  save('launch.json',{configuration,executable:powershell,args,pins:MEMBER_PINS,controllerSha256:sha(readFileSync(fileURLToPath(import.meta.url))),nativeSourceSha256:NATIVE_SOURCE_SHA256});
  const journal = recorder(), helper = spawn(powershell, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = observeOutput(helper.stdout), stderr = observeOutput(helper.stderr), started = performance.now();
  let closed = false, status = null, signal = null, error = null, exitObserved = false, exitStatus = null, exitSignal = null, deadlineFired = false;
  const note = (kind, data) => journal.note(kind, { atMs: performance.now() - started, ...data });
  for (const key of ['stdout', 'stderr']) helper[key]?.on('error', caught => note('helper-output-error', { stream: key, error: String(caught.message).slice(0, 300) }));
  note('helper-created', { pid: helper.pid, controllerPid: process.pid, instance: randomUUID(), node: process.version });
  await new Promise(done => {
    let grace;
    const timer = setTimeout(() => {
      deadlineFired = true; note('outer-deadline', { helperPid: helper.pid });
      try { note('terminate-only-owned-helper', { returned: helper.kill() }); } catch (caught) { note('helper-termination-error', { error: String(caught.message).slice(0, 300) }); }
      grace = setTimeout(() => { note('helper-close-unknown', {}); helper.unref(); helper.stdout?.unref?.(); helper.stderr?.unref?.(); done(); }, 3000);
    }, 15000);
    helper.once('error', caught => { error = String(caught.message).slice(0, 300); note('helper-error', { error }); });
    helper.once('exit', (code, why) => { exitObserved = true; exitStatus = code; exitSignal = why; note('helper-exit', { code, signal: why }); });
    helper.once('close', (code, why) => { closed = true; status = code; signal = why; note('helper-close', { code, signal: why }); clearTimeout(timer); clearTimeout(grace); done(); });
  });
  const out = stdout.snapshot(), err = stderr.snapshot();
  save('helper.stdout.bin', Buffer.from(out.data, 'base64')); save('helper.stderr.bin', Buffer.from(err.data, 'base64'));
  const outer = { helperPid: helper.pid ?? null, closed, status, signal, error, exitObserved, exitStatus, exitSignal, deadlineFired,
    stdout: out, stderr: err, observation: journal.snapshot(), outputLoss: { stdout: out.dropped, stderr: err.dropped }, outputErrors: { stdout: out.errors, stderr: err.errors } };
  save('helper-terminal.json', outer);
  const readErrors=[],helperFileRaw=bounded(join(directory,'member-normal-helper.json'),readErrors);
  const markerPath=join(directory,'root-pre-spawn.json'),markerRaw=existsSync(markerPath)?bounded(markerPath,readErrors,4096):null;
  let rootPreSpawn=null;
  if(markerRaw)try{rootPreSpawn=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(markerRaw));}catch(error){if(readErrors.length<8)readErrors.push({path:markerPath,error:String(error.message).slice(0,300)});}
  const read=name=>{const raw=bounded(join(directory,name),readErrors);if(!raw)return null;try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch(error){if(readErrors.length<8)readErrors.push({path:name,error:String(error.message).slice(0,300)});return null;}};
  const rootEntryRaw=bounded(join(directory,'root-entry.json'),readErrors,4096),childEntryRaw=bounded(join(directory,'child-entry.json'),readErrors,4096);
  const parseEntry=raw=>{try{return raw?JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)):null;}catch{if(readErrors.length<8)readErrors.push({error:'Invalid committed entry'});return null;}};
  const result=interpretMemberNormal({...configuration,childScriptPath:configuration.childEntry,outer,helperFileRaw,markerRaw,rootPreSpawn,rootEntryRaw,childEntryRaw,rootEntry:parseEntry(rootEntryRaw),childEntry:parseEntry(childEntryRaw),
    entryPartialsPresent:['root-pre-spawn.json','root-entry.json','child-entry.json'].some(name=>existsSync(join(directory,name+'.partial'))),
    rootResult:read('root-result.json'),childResult:read('child-result.json'),childOutput:read('child-output.json'),readErrors},NATIVE_SOURCE_SHA256);
  save('member-normal-capture.json',result);
  console.log(JSON.stringify({directory,captureComplete:result.captureComplete,requiredWorkloadRolesConfirmed:result.requiredWorkloadRolesConfirmed,
    normalQualificationPassed:result.normalQualificationPassed,closureState:result.closureState,normalReasons:result.normalReasons,actualRuntimeQualified:false,anotherCaseAuthorized:false}));
  if(!result.normalQualificationPassed)process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(String(error?.stack??error));process.exitCode=2;});
