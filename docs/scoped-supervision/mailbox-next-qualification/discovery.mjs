/** Inert exact selection only. Never loads a configuration, test, runner or native helper. */
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {glob,convertPathToPattern} from 'tinyglobby';
import {CASE,NONCE,REPO,SELECTION,locations} from './contract.mjs';
import {errorValue} from './io.mjs';
const slash=path=>path.replaceAll('\\','/');
export async function exactDiscovery(files,cwd,globFiles=glob){
 assert.equal(files.length,2);assert.equal(new Set(files).size,2);
 const include=files.map(path=>convertPathToPattern(path));
 const found=(await globFiles(include,{dot:true,cwd,ignore:[],expandDirectories:false})).map(path=>slash(resolve(cwd,path))).sort();
 assert.deepEqual(found,files.map(slash).sort(),'Exact mailbox discovery refused');
 return{include,found,count:found.length,configsEvaluated:false,callbacksExecuted:false};
}
export async function assertMailboxDiscovery(plan){
 assert.equal(plan.caseId,CASE);assert.equal(plan.nonce,NONCE);assert.equal(plan.files.length,2);
 for(let i=0;i<2;i++){const f=plan.files[i],s=SELECTION[i];assert.equal(f.path,join(locations().directory,'selected',s.name,s.name+'.test.ts'));assert.equal(f.title,s.title);assert.equal(f.bodyHash,s.bodyHash);assert.equal(f.expectations,s.expectations);}
 return exactDiscovery(plan.files.map(f=>f.path),resolve(REPO));
}
export async function recordDiscovery(discover,save,noteRecordingError){
 let result;
 try{result=await discover();}
 catch(error){
  try{save({passed:false,error:errorValue(error)});}
  catch(recordingError){try{noteRecordingError(errorValue(recordingError));}catch{}}
  throw error; // recording cannot replace the exact discovery failure
 }
 save({passed:true,...result});return result; // a failed successful-receipt write is never retried
}
