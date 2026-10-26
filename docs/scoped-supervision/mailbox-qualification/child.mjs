/** Fixed actual product runner. Native-owned parent launches it; importing it never starts a run. */
import {writeFileSync,renameSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {threadId,isMainThread} from 'node:worker_threads';
import assert from 'node:assert/strict';
import {loadRuntime} from './worker.mjs';
import {readJson,readBounded,decode,saveNew,errorValue} from './io.mjs';
import {sha} from './contract.mjs';
import {runFixedVitest} from './lifecycle.mjs';
import {checkTestResults} from './product.mjs';
async function main(){
 assert.equal(process.argv.length,3);const{config}=loadRuntime(process.argv[2]);
 const entry={caseId:config.caseId,scenario:'normal',nonce:config.nonce,pid:process.pid,ppid:process.ppid,instance:randomUUID(),node:process.version,threadId,isMainThread};
 const entryBytes=Buffer.from(JSON.stringify(entry));assert.ok(entryBytes.length<=4096);
 const partial=join(config.directory,'child-entry.json.partial');writeFileSync(partial,entryBytes,{flag:'wx'});renameSync(partial,join(config.directory,'child-entry.json'));
 const save=(name,value)=>saveNew(join(config.directory,name),value);
 try{
  await new Promise(resolveRelease=>{const timer=setInterval(()=>{if(existsSync(join(config.directory,'release'))){clearInterval(timer);resolveRelease();}},10);});
  assert.equal(readBounded(join(config.directory,'release'),4096).toString(),'owned-workload-confirmed');
  const plan=readJson(join(config.directory,'selection.json'));assert.equal(sha(readBounded(join(config.directory,'selection.json'))),config.selectionSha256);
  process.env.FIRSTMATE_MAILBOX_CONFIGURATION=process.argv[2];process.chdir(config.repositoryRoot);
  const{startVitest}=await import('vitest/node');let reportRaw;
  const result=await runFixedVitest(config,plan,{startVitest,readReport:()=>{reportRaw=readBounded(plan.report);return decode(reportRaw);},
   capture:record=>{record.reportSha256=reportRaw?sha(reportRaw):null;save('runner-result.json',record);}});
  const reasons=checkTestResults(plan,result.report,result.record),fulfilled=reasons.length===0;
  save('child-result.json',{fulfilled,format:'firstmate.s02-mailbox-child/1',caseId:config.caseId,nonce:config.nonce,reportSha256:reportRaw?sha(reportRaw):null,reasons});
  if(!fulfilled)process.exitCode=1;
 }catch(error){
  try{save('runner-error.json',{originalError:errorValue(error)});}catch{}
  try{save('child-result.json',{fulfilled:false,format:'firstmate.s02-mailbox-child/1',caseId:config.caseId,nonce:config.nonce,originalError:errorValue(error)});}catch{}
  process.stderr.write(JSON.stringify(errorValue(error)));process.exitCode=1;
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{process.stderr.write(JSON.stringify(errorValue(error)));process.exitCode=2;});
