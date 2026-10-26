/** Fixed mailbox-actual-1. Import is inert; only a separately admitted exact dispatch may run main. */
import {spawn} from 'node:child_process';
import {readFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {recorder,observeOutput} from '../owner-capability/capture.mjs';
import {CASE,NONCE,BASE,REPO,SOURCE,NATIVE_SHA,NODE_SHA,PS_SHA,CAPS,sha,locations} from './contract.mjs';
import {readBounded,decode,saveNew,errorValue} from './io.mjs';
import {materializeMailbox} from './prepare.mjs';
import {interpretMailbox} from './product.mjs';
const PINS_SHA='43a124694efe22dc2e0146c0eb863fbbb74f4505c6954dd275b44fc1d7ec729d'; // frozen source manifest; populated before source review
async function main(){
 assert.equal(process.argv.length,2,'No overrides or second case');assert.equal(process.platform,'win32');assert.equal(process.arch,'x64');assert.equal(process.version,'v24.18.0');
 assert.equal(resolve('.'),resolve(REPO));const powershell='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
 assert.equal(sha(readFileSync(process.execPath)),NODE_SHA);assert.equal(sha(readFileSync(powershell)),PS_SHA);
 const pinsRaw=readBounded(join(SOURCE,'source-pins.json'));assert.equal(sha(pinsRaw),PINS_SHA);const pins=decode(pinsRaw);
 assert.equal(pins.format,'firstmate.s02-mailbox-sources/1');assert.equal(pins.baseHead,BASE);assert.equal(pins.nativeSourceSha256,NATIVE_SHA);assert.equal(pins.caseId,CASE);assert.equal(pins.nonce,NONCE);assert.deepEqual(pins.caps,CAPS);
 for(const[name,hash]of Object.entries(pins.files))assert.equal(sha(readFileSync(resolve(REPO,name))),hash,'Changed pinned mailbox source: '+name);
 const{directory,dispatch:dispatchPath,configuration:configurationPath}=locations();assert.ok(existsSync(dispatchPath),'S02_MAILBOX_DISPATCH_HOLD');
 const dispatchRaw=readBounded(dispatchPath),dispatch=decode(dispatchRaw),controllerSha256=sha(readFileSync(fileURLToPath(import.meta.url)));
 assert.deepEqual(dispatch,{format:'firstmate.s02-mailbox-dispatch/1',executeOneMailbox:true,caseId:CASE,nonce:NONCE,pinsSha256:PINS_SHA,controllerSha256});
 assert.ok(!existsSync(directory),'Mailbox case already reserved');mkdirSync(resolve(directory,'..'),{recursive:true});mkdirSync(directory);
 for(const name of [...Object.keys(pins.files),'docs/scoped-supervision/mailbox-qualification/controller.mjs','docs/scoped-supervision/mailbox-qualification/source-pins.json']){
  const destination=join(directory,'source',name);mkdirSync(resolve(destination,'..'),{recursive:true});copyFileSync(resolve(REPO,name),destination);
 }
 const save=(name,value)=>saveNew(join(directory,name),value);
 const configuration={format:'firstmate.s02-mailbox-runtime/1',directory,repositoryRoot:resolve(REPO),nodePath:process.execPath,nodeVersion:process.version,caseId:CASE,nonce:NONCE,scenario:'normal',
  childEntry:join(SOURCE,'child.mjs'),rootEntry:join(SOURCE,'root.mjs'),pinsSha256:PINS_SHA,controllerSha256};
 const plan=materializeMailbox(configuration,pins);configuration.selectionSha256=sha(readBounded(join(directory,'selection.json')));
 save('configuration.json',configuration);save('dispatch.json',dispatchRaw);
 const args=['-NoProfile','-NonInteractive','-File',join(SOURCE,'mailbox-only.ps1'),'-OutputDirectory',directory,'-NodePath',process.execPath,'-Configuration',configurationPath];
 save('launch.json',{configuration,executable:powershell,args,pinsSha256:PINS_SHA,controllerSha256,nativeSourceSha256:NATIVE_SHA,selection:plan});
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

 const nativeErrors=[],ordinaryErrors=[],productErrors=[];
 const obtain=(name,errors,limit=2097152,optional=false)=>{try{if(optional&&!existsSync(join(directory,name)))return null;return readBounded(join(directory,name),limit);}catch(error){errors.push({path:name,error:errorValue(error)});return null;}};
 const parse=(name,errors,limit=2097152,optional=false)=>{const raw=obtain(name,errors,limit,optional);if(!raw)return null;try{return decode(raw);}catch(error){errors.push({path:name,error:errorValue(error)});return null;}};
 const helperFileRaw=obtain('member-normal-helper.json',nativeErrors),markerRaw=obtain('root-pre-spawn.json',ordinaryErrors,4096),rootEntryRaw=obtain('root-entry.json',ordinaryErrors,4096),childEntryRaw=obtain('child-entry.json',ordinaryErrors,4096);
 const parsedEntry=raw=>{try{return raw?decode(raw):null;}catch(error){ordinaryErrors.push({error:errorValue(error)});return null;}};
 const input={...configuration,childScriptPath:configuration.childEntry,outer,helperFileRaw,markerRaw,rootEntryRaw,childEntryRaw,rootPreSpawn:parsedEntry(markerRaw),rootEntry:parsedEntry(rootEntryRaw),childEntry:parsedEntry(childEntryRaw),
  entryPartialsPresent:['root-pre-spawn.json','root-entry.json','child-entry.json'].some(name=>existsSync(join(directory,name+'.partial'))),
  rootResult:parse('root-result.json',ordinaryErrors),childResult:parse('child-result.json',ordinaryErrors),childOutput:parse('child-output.json',ordinaryErrors),readErrors:nativeErrors};
 const reportRaw=obtain('vitest-results.json',productErrors),selectionRaw=obtain('selection.json',productErrors),slots={};
 const product={plan:selectionRaw?parsedEntry(selectionRaw):null,selectionRaw,reportRaw,report:reportRaw?parsedEntry(reportRaw):null,runner:parse('runner-result.json',productErrors),runnerError:parse('runner-error.json',productErrors,2097152,true),slots,generatedArtifacts:{}};
 for(const artifact of plan.artifacts){const rel=artifact.path.slice(directory.length+1);const raw=obtain(rel,productErrors);product.generatedArtifacts[artifact.path]=raw?sha(raw):null;}
 for(const slot of plan.slots){const name=slot.name,prefix='selected/'+name+'/';slots[name]={externalRaw:obtain(prefix+'external.jsonl',productErrors),
  capsule:parse(prefix+'capsule.json',productErrors),returned:parse(prefix+'post-disposal-return.json',productErrors),snapshot:parse(prefix+'trace/post-dispose.json',productErrors),retentionRaw:obtain(prefix+'retained-home.jsonl',productErrors)};}
 const errors=[...ordinaryErrors,...productErrors];product.readErrors={count:errors.length,errors:errors.slice(0,8)};
 const result=interpretMailbox(input,product,plan,NATIVE_SHA);save('member-normal-capture.json',result.member);save('mailbox-capture.json',result);
 save('product-read-errors.json',{nativeCount:nativeErrors.length,nativeErrors:nativeErrors.slice(0,8),ordinaryCount:ordinaryErrors.length,ordinaryErrors:ordinaryErrors.slice(0,8),productCount:productErrors.length,productErrors:productErrors.slice(0,8)});
 console.log(JSON.stringify({directory,normalProductSuccess:result.normalProductSuccess,ownedSetClosureConfirmed:result.ownedSetClosureConfirmed,closureState:result.closureState,reasons:result.product.reasons,actualRuntimeQualified:false,anotherCaseAuthorized:false}));
 if(!result.normalProductSuccess)process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(JSON.stringify(errorValue(error)));process.exitCode=2;});
