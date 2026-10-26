/** Mailbox-only rendering/materialization. No identity/browser preparer, Git, runtime or provider calls. */
import {readFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {convertPathToPattern} from 'tinyglobby';
import {literalCallback} from '../observer-admission/adapters.mjs';
import {retainSetup} from '../observer-wiring/selected.mjs';
import {BASE,SELECTION,sha,fixedConfiguration} from './contract.mjs';
import {saveNew} from './io.mjs';
// Imports emitted as code need the same freeze as ordinary module imports.
export const EMITTED_RUNTIME_IMPORTS=Object.freeze({client:'docs/scoped-supervision/mailbox-next-qualification/worker.mjs',adapters:'docs/scoped-supervision/observer-admission/adapters.mjs',retention:'docs/scoped-supervision/observer-wiring/client.mjs'});
// Pure config emitter permits discovery-only fixtures without creating a runtime case.
export function renderMailboxConfiguration(files,setup){return `import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:${JSON.stringify(files.map(f=>convertPathToPattern(f.path)))},exclude:[],setupFiles:[${JSON.stringify(setup)}],maxWorkers:2,isolate:true,watch:false,pool:'forks',fileParallelism:true,testTimeout:5000,retry:0,passWithNoTests:false,allowOnly:false,environment:'node',coverage:{enabled:false}}});\n`;}
export function renderMailbox(config,sources,pins){
 fixedConfiguration(config);const root=config.repositoryRoot,directory=config.directory;
 const url=path=>pathToFileURL(resolve(root,path)).href;
 const modules=Object.fromEntries(Object.entries(EMITTED_RUNTIME_IMPORTS).map(([name,path])=>[name,url(path)]));
 const generated={},files=[],slots=[];
 for(const target of SELECTION){
  const source=sources[target.path];assert.equal(sha(Buffer.from(source)),target.sourceSha256);
  const literal=literalCallback(source,target);assert.equal(literal.sha256,target.bodyHash);assert.equal((literal.body.match(/\bexpect\(/g)||[]).length,target.expectations);
  const output=join(directory,'selected',target.name),path=join(output,target.name+'.test.ts'),capsulePath=join(output,'capsule.json');
  const capsule={slotId:randomUUID(),name:target.name,runtime:'s02-mailbox-owned/1',sourceHead:BASE,sourceHash:target.sourceSha256,bodyHash:target.bodyHash,
   observerHashes:Object.fromEntries(['observer-admission/session.mjs','observer-admission/adapters.mjs','observer-wiring/protocol.mjs','mailbox-next-qualification/worker.mjs'].map(name=>[name,pins.files['docs/scoped-supervision/'+name]])),
   sourcePins:{[resolve(root,target.path)]:target.sourceSha256},ownedHomeRoot:join(output,'homes'),output,external:join(output,'external.jsonl'),
   callbackLimitMs:5000,ownerCaseId:config.caseId,ownerNonce:config.nonce,ownerPinsSha256:config.pinsSha256,configuration:join(directory,'configuration.json')};
  const header=source.slice(0,source.indexOf('\ndescribe(')).replace(/from "(\.\.?\/[^\"]+)"/g,(_all,spec)=>`from ${JSON.stringify(resolve(root,'server',spec).replaceAll('\\','/'))}`)
   .replace('describe, expect, it }','describe, expect, it, vi }');
  const extra=target.name==='triage'?'SupervisionInbox':'SupervisionEvents';
  generated[path]=`${header}\nimport {${extra}} from ${JSON.stringify(resolve(root,'server',target.name==='triage'?'supervision-inbox':'supervision-events'))};
import {openMailboxCase} from ${JSON.stringify(modules.client)};
const {state,filesystemPhases,installMailboxPhases}=await vi.hoisted(async()=>{const adapters=await import(${JSON.stringify(modules.adapters)});return{state:{current:null,fs:null,actual:null},...adapters};});
vi.mock('node:fs/promises',async importOriginal=>{const actual=await importOriginal();state.actual=actual;return{...actual,...Object.fromEntries(['mkdir','readFile','readdir','stat','link','unlink','open'].map(name=>[name,(...args)=>state.current&&state.fs?state.fs[name](...args):Reflect.apply(actual[name],actual,args)]))};});
const originalCallback=async()=>${literal.body};
it(${JSON.stringify(target.title)},context=>{
 const bridge=openMailboxCase(${JSON.stringify(capsulePath)});state.current=bridge;
 try{state.fs=filesystemPhases(bridge.session,state.actual);installMailboxPhases(bridge.session,{SupervisionStore,SupervisionEvents,SupervisionInbox});}catch(error){bridge.session.observerError(error);}
 const signal=()=>{bridge.session.note('cooperative-signal');bridge.flush('deadline');};context.signal.addEventListener('abort',signal,{once:true});
 context.onTestFinished(()=>{try{bridge.finalize();}finally{state.current=null;state.fs=null;context.signal.removeEventListener('abort',signal);}});
 return bridge.run(originalCallback);
});\n`;
  generated[capsulePath]=JSON.stringify(capsule,null,2)+'\n';generated[capsule.external]='';
  files.push({...target,path,sha256:sha(Buffer.from(generated[path])),capsulePath});slots.push(capsule);
 }
 const setup=join(directory,'selected','setup.mjs'),retainedSetup=join(directory,'selected','retained-real-setup.mjs'),configPath=join(directory,'selected','vitest.config.mjs');
 const byPath=Object.fromEntries(files.map(f=>[f.path.replaceAll('\\','/'),f.capsulePath]));
 generated[setup]=`import {expect} from 'vitest';\nimport {resolve} from 'node:path';\nimport {prepareWorkerSetup} from ${JSON.stringify(modules.client)};
const selected=${JSON.stringify(byPath)}[resolve(expect.getState().testPath).replaceAll('\\\\','/')];if(!selected)throw Error('Unselected mailbox file');
prepareWorkerSetup(selected);await import(${JSON.stringify(pathToFileURL(retainedSetup).href)});\n`;
 // Use the actual pinned setup body and the existing exact retention seam. A conditional
 // bundler transform must not be able to miss and register its original destructive cleanup.
 const retained=retainSetup(sources['test/setup.ts']),line=retained.indexOf('\n');
 assert.match(retained.slice(0,line),/^import \{ retainDiagnosticHome \} from /);
 generated[retainedSetup]=`import {retainDiagnosticHome} from ${JSON.stringify(modules.retention)};\n`+retained.slice(line+1);
 generated[configPath]=renderMailboxConfiguration(files,setup);
 const artifacts=Object.entries(generated).filter(([path])=>!path.endsWith('.jsonl')).map(([path,text])=>({path,sha256:sha(Buffer.from(text))}));
 return{format:'firstmate.s02-mailbox-selection/1',caseId:config.caseId,nonce:config.nonce,pinsSha256:config.pinsSha256,files,slots,artifacts,config:configPath,report:join(directory,'vitest-results.json'),generated};
}
export function materializeMailbox(config,pins){
 const sources=Object.fromEntries([...SELECTION.map(t=>t.path),'test/setup.ts'].map(path=>[path,readFileSync(resolve(config.repositoryRoot,path),'utf8')]));
 const plan=renderMailbox(config,sources,pins);
 for(const slot of plan.slots){mkdirSync(slot.ownedHomeRoot,{recursive:true});mkdirSync(join(slot.output,'trace'));}
 for(const[path,text]of Object.entries(plan.generated)){mkdirSync(resolve(path,'..'),{recursive:true});saveNew(path,Buffer.from(text));}
 const{generated,...retained}=plan;saveNew(join(config.directory,'selection.json'),retained);return retained;
}
