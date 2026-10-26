/** Typed-source/absence guards, not authentication. No process creation or case mutation. */
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {CASE,NONCE,NODE_PATH,NODE_VERSION,NODE_SHA,PS_SHA,CAPS,REPO,SOURCE,locations,sha} from './contract.mjs';
export function outerLocation(){return locations().directory+'.outer';}
export function validateLaunch(manifest,snapshot){
 assert.equal(manifest.format,'firstmate.s02-mailbox-outer-pins/1');assert.equal(manifest.caseId,CASE);assert.equal(manifest.nonce,NONCE);
 assert.equal(manifest.cwd,resolve(REPO));assert.equal(snapshot.cwd,manifest.cwd);assert.equal(manifest.executable,NODE_PATH);assert.equal(snapshot.executable,NODE_PATH);assert.equal(snapshot.nodeVersion,NODE_VERSION);
 assert.equal(snapshot.nodeSha256,NODE_SHA);assert.equal(snapshot.powershellSha256,PS_SHA);assert.deepEqual(manifest.limits,CAPS);
 assert.equal(manifest.controller,join(SOURCE,'controller.mjs'));assert.equal(manifest.outerDirectory,outerLocation());
 assert.equal(manifest.caseDirectory,locations().directory);assert.equal(manifest.activeDispatch,locations().dispatch);
 for(const key of ['casePresent','outerPresent'])assert.equal(snapshot[key],false,'Refuse existing '+key);
 assert.equal(snapshot.dispatchPresent,true,'Named exclusive dispatch is required');
 for(const key of ['pinsSha256','controllerSha256','templateSha256'])assert.equal(snapshot[key],manifest[key]);
 assert.equal(snapshot.sourcePinsComplete,true);assert.equal(snapshot.controllerDeclaredPinsSha256,manifest.pinsSha256);
 assert.deepEqual(snapshot.dispatch,{format:'firstmate.s02-mailbox-dispatch/1',executeOneMailbox:true,caseId:CASE,nonce:NONCE,pinsSha256:manifest.pinsSha256,controllerSha256:manifest.controllerSha256});
 return true;
}
