/** Distinct single ROOT-ONLY gate. Import is inert; the named absent dispatch file holds execution. */
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,openSync,readSync,closeSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {recorder,observeOutput} from './capture.mjs';
import {interpretRootGate} from './root-gate-capture.mjs';
export const GATE_PINS = Object.freeze({"WindowsJobOwner.cs":"1b0117215cc80f81ab199e206a6da64a11ec6166ffc3db8a12546d7e368fa2c0","WindowsRootGate.cs":"09f44cdec979dc45240651e1847c7dadb94956f2d178ed2eeb9f50a903073593","root-gate-only.ps1":"e6f7f8ed450cf04d736f73b7a872305520d5b0bc61b846836f46a2c6459e3a47","root-gate.mjs":"f3eace8504ce14c7fdf3d5539e9985256c339a9f219dc203bd9adc698bacac1b","root-gate-capture.mjs":"cdbc4edf134a5e6ce7322edcd47fa71a42442b7426b97101d5292661b7c693c9","phase-capture.mjs":"87d7c787352da747061dfde46e89bfbeefd27eee8036f78309d25a334b64fa2d","capture.mjs":"875933e8b1235230305e8f25162ec94b1f5dc0d85bed9fa4b16cf02f919cfa99","diagnostic-capture.mjs":"875e1718ff3bd1ec074193804988e61200bf2646a6460a1f434ea50da2595a1e","child.mjs":"1d5201bb4fb63e88f83c9831e46e6bc131a8fff38d11fd37f5e90e846189a6e3"}); // refreshed from final source bytes, not a runtime override
export const NATIVE_SOURCE_SHA256 = 'dfc332a48ffc54434d3222a136b6ee0299497b886f5ba1ead95fc762ab2421d6';
export const CASE_ID='49ab7fc0-aa4c-41b7-acae-bdb9d13489d7', NONCE='1aff3330-6969-452c-b24f-f118b1158ed3';
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
  for(const [name,pin] of Object.entries(GATE_PINS))assert.equal(sha(readFileSync(join(source,name))),pin,`Changed gate source: ${name}`);
  const parent=resolve('.local/owner-root-gate'),directory=join(parent,'root-gate-1'),dispatchPath=join(parent,'root-gate-1.dispatch.json');
  assert.ok(existsSync(dispatchPath),'ROOT_GATE_DISPATCH_HOLD'); // no mkdir/reservation/helper before this supported gate
  const errors=[],dispatchRaw=bounded(dispatchPath,errors);assert.equal(errors.length,0);
  const dispatch=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(dispatchRaw));
  assert.deepEqual(dispatch,{format:'firstmate.root-gate-dispatch/1',scenario:'root-gate',executeOneRootOnlyGate:true,caseId:CASE_ID,nonce:NONCE,
    controllerSha256:sha(readFileSync(fileURLToPath(import.meta.url))),sourcePins:GATE_PINS,nativeSourceSha256:NATIVE_SOURCE_SHA256});
  assert.ok(!existsSync(directory),'Root-gate reservation already exists');
  mkdirSync(parent,{recursive:true});mkdirSync(directory);mkdirSync(join(directory,'source'));
  for(const name of [...Object.keys(GATE_PINS),'root-gate-controller.mjs'])copyFileSync(join(source,name),join(directory,'source',name));
  const save=(name,value)=>{const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value,null,2)+'\n');assert.ok(bytes.length<=2097152,'Saved gate file cap');writeFileSync(join(directory,name),bytes,{flag:'wx'});};
  const configuration={directory,nodePath:process.execPath,nodeVersion:process.version,caseId:CASE_ID,nonce:NONCE,scenario:'root-gate',
    childEntry:join(source,'child.mjs'),rootEntry:join(source,'root-gate.mjs')};save('configuration.json',configuration);save('dispatch.json',dispatchRaw);
  const args=['-NoProfile','-NonInteractive','-File',join(source,'root-gate-only.ps1'),'-OutputDirectory',directory,'-NodePath',process.execPath,'-Configuration',join(directory,'configuration.json')];
  save('launch.json',{configuration,executable:powershell,args,pins:GATE_PINS,controllerSha256:sha(readFileSync(fileURLToPath(import.meta.url))),nativeSourceSha256:NATIVE_SOURCE_SHA256});
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
  const readErrors=[],helperFileRaw=bounded(join(directory,'root-gate-helper.json'),readErrors);
  const markerPath=join(directory,'root-pre-spawn.json'),markerRaw=existsSync(markerPath)?bounded(markerPath,readErrors,4096):null;
  let rootPreSpawn=null;
  if(markerRaw)try{rootPreSpawn=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(markerRaw));}catch(error){if(readErrors.length<8)readErrors.push({path:markerPath,error:String(error.message).slice(0,300)});}
  const result=interpretRootGate({...configuration,childScriptPath:configuration.childEntry,outer,helperFileRaw,markerRaw,rootPreSpawn,markerPartialExists:existsSync(markerPath+'.partial'),readErrors},NATIVE_SOURCE_SHA256);
  save('root-gate-capture.json',result);
  console.log(JSON.stringify({directory,gateVerdict:result.gateVerdict,discrimination:result.discrimination,captureComplete:result.captureComplete,
    closureState:result.closureState,safeForReuse:false,normalQualificationPassed:false,actualRuntimeQualified:false,anotherCaseAuthorized:false}));
  if(!result.captureComplete || !result.ownedSetClosureConfirmed)process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(String(error?.stack??error));process.exitCode=2;});
