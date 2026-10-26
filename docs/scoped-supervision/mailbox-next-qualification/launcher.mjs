/** Held single direct controller invocation. Import is inert. No termination/cleanup or descendant-closure inference. */
import {spawn} from 'node:child_process';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {REPO,SOURCE,NODE_PATH,NODE_VERSION,CASE,NONCE,sha} from './contract.mjs';
import {readBounded,decode,saveNew,errorValue} from './io.mjs';
import {validateLaunch} from './launch-guard.mjs';
import {captureController} from './outer-capture.mjs';
const OUTER_PINS_SHA='6fda4d3279410a9c79b9e2b5f1e3e2e9a869676019d2d39ded028053642aeadb';
async function main(){
 assert.equal(process.argv.length,2,'No alternate case/arguments');assert.equal(process.platform,'win32');assert.equal(process.arch,'x64');assert.equal(process.version,NODE_VERSION);assert.equal(process.execPath,NODE_PATH);
 const raw=readBounded(join(SOURCE,'outer-pins.json'));assert.equal(sha(raw),OUTER_PINS_SHA);const manifest=decode(raw),pinsRaw=readBounded(join(SOURCE,'source-pins.json')),pins=decode(pinsRaw),controller=readBounded(manifest.controller);
 for(const[path,hash]of Object.entries(pins.files))assert.equal(sha(readFileSync(resolve(REPO,path))),hash,'Changed source '+path);
 const dispatchRaw=readBounded(manifest.activeDispatch);
 validateLaunch(manifest,{cwd:resolve('.'),executable:process.execPath,nodeVersion:process.version,nodeSha256:sha(readFileSync(process.execPath)),powershellSha256:sha(readFileSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe')),
  casePresent:existsSync(manifest.caseDirectory),outerPresent:existsSync(manifest.outerDirectory),dispatchPresent:existsSync(manifest.activeDispatch),pinsSha256:sha(pinsRaw),controllerSha256:sha(controller),templateSha256:sha(dispatchRaw),
  sourcePinsComplete:true,controllerDeclaredPinsSha256:controller.toString().match(/const PINS_SHA='([a-f0-9]{64})'/)?.[1],dispatch:decode(dispatchRaw)});
 // Exclusive launcher reservation before spawning the controller. Never reset/reuse this directory.
 mkdirSync(manifest.outerDirectory);const recordingErrors=[];let recordingErrorCount=0;
 const save=(name,value)=>{try{return saveNew(join(manifest.outerDirectory,name),value);}catch(error){recordingErrorCount++;if(recordingErrors.length<8)recordingErrors.push({name,error:errorValue(error)});return null;}};
 for(const[name,bytes]of [['launcher.source.mjs',readFileSync(new URL(import.meta.url))],['outer-pins.json',raw],['controller.source.mjs',controller],['source-pins.json',pinsRaw]])save(name,bytes);
 const launch=save('launch.json',{format:'firstmate.s02-controller-launch/1',caseId:CASE,nonce:NONCE,controllerExecutable:manifest.executable,args:[manifest.controller],cwd:manifest.cwd,
  sourcePinsSha256:manifest.pinsSha256,controllerSha256:manifest.controllerSha256,outerPinsSha256:OUTER_PINS_SHA,launcherSha256:sha(readFileSync(new URL(import.meta.url))),outerPid:process.pid,node:process.version});
 if(!launch||recordingErrorCount){console.error(JSON.stringify({error:'Outer launch recording failed; controller not started',recordingErrorCount,recordingErrors}));process.exitCode=2;return;}
 const terminal=await captureController({spawn,executable:manifest.executable,args:[manifest.controller],cwd:manifest.cwd});
 const descriptors={};for(const key of ['stdout','stderr']){const bytes=Buffer.from(terminal[key].data,'base64'),saved=save('controller.'+key+'.bin',bytes);descriptors[key]={bytes:bytes.length,sha256:sha(bytes),complete:saved!==null};}
 let product=null,productReadError=null,productRaw=null;
 try{productRaw=readBounded(join(manifest.caseDirectory,'mailbox-capture.json'));product=decode(productRaw);assert.equal(product.format,'firstmate.s02-mailbox-capture/1');assert.equal(product.caseId,CASE);assert.equal(product.nonce,NONCE);assert.equal(product.pinsSha256,manifest.pinsSha256);}
 catch(error){productReadError=errorValue(error);product=null;}
 const value={format:'firstmate.s02-mailbox-outer-result/1',caseId:CASE,nonce:NONCE,sourcePinsSha256:manifest.pinsSha256,controllerSha256:manifest.controllerSha256,terminal,streamFiles:descriptors,
  ordinaryProduct:{available:product!==null,normalProductSuccessAsRecorded:product?.normalProductSuccess??null,readError:productReadError,fileBytes:productRaw?.length??null,fileSha256:productRaw?sha(productRaw):null},
  physicalClosure:{ownedSetClosureAsRecorded:product?.ownedSetClosureConfirmed??null,stateAsRecorded:product?.closureState??'unknown',establishedByOuterExit:false},
  recordingErrorCount,recordingErrors,normalCaseEvidenceComplete:terminal.assessment.normalExit&&recordingErrorCount===0&&product?.normalProductSuccess===true&&product?.ownedSetClosureConfirmed===true,
  actualRuntimeQualified:false,anotherCaseAuthorized:false,safeForReuse:false};
 const saved=save('outer-result.json',value);
 console.log(JSON.stringify({directory:manifest.caseDirectory,outerDirectory:manifest.outerDirectory,controllerCaptureComplete:terminal.assessment.complete,controllerNormalExit:terminal.assessment.normalExit,
  normalProductSuccessAsRecorded:value.ordinaryProduct.normalProductSuccessAsRecorded,ownedSetClosureAsRecorded:value.physicalClosure.ownedSetClosureAsRecorded,recordingErrorCount,outerReceiptWritten:saved!==null,
  actualRuntimeQualified:false,anotherCaseAuthorized:false,safeForReuse:false}));
 if(!value.normalCaseEvidenceComplete||!saved)process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(JSON.stringify(errorValue(error)));process.exitCode=2;});
