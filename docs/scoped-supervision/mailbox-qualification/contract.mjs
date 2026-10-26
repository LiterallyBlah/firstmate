/** Fixed, held S02 case. These are local typed-source guards, not authentication. */
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
export const BASE='aa8db567714b38542ee6ef18a2f9f31e8cbcc5b0';
export const CASE='b807adc9-87fb-46a2-8c1a-c88208531ec3', NONCE='4ddd694a-f73f-4f03-8b02-2fb839eedde5';
export const NATIVE_SHA='a61098b3bb597af66232592bf0e2e2caa1db25c0a42f5aee66529e8983ce339b';
export const NODE_SHA='9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de';
export const PS_SHA='60c9b29843624dd8af6b6a7b26147753be6aeef65098b9a503cc50850afe410f';
export const REPO=fileURLToPath(new URL('../../../',import.meta.url));
export const SOURCE=fileURLToPath(new URL('.',import.meta.url));
export const CAPS=Object.freeze({fileBytes:2097152,finalFrameBytes:32768,streamBytes:65536,entryBytes:4096,members:8,terminalSamples:8,events:64,errors:8,nativeDeadlineMs:5000,closureMs:8000,outerDeadlineMs:15000,outerGraceMs:3000});
export const SELECTION=Object.freeze([
 {name:'triage',path:'server/supervision-events.test.ts',title:'explicitly resolves unknown-owner triage once exact registry evidence exists, retaining prior provenance',sourceSha256:'677c0a062be6ea8df844b4619304b4572f8e5ae10d48b9797ee8a812fc6c6b06',bodyHash:'c20c1cff852619e52197e6c9df656fa6154c3bad7c85aeb2a413c6b29732e71c',expectations:5},
 {name:'inbox',path:'server/supervision-inbox.test.ts',title:'pins exact request bytes; accepted replay survives later epoch replacement without new spend',sourceSha256:'44bfc09f6d21240f915c3175e9b847f0e8d9317e14a1f6dc3488f4dcd0694e95',bodyHash:'89a164554e52bb21acfa519a919158c52bf8c9df8f7f370ead95be09d8bcaeb0',expectations:9},
]);
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const canonical=code=>code.replaceAll('\r\n','\n');
export function locations(repo=REPO){const directory=resolve(repo,'.local/s02-product-qualification/mailbox-actual-1');return{directory,dispatch:directory+'.dispatch.json',configuration:join(directory,'configuration.json')};}
export function fixedConfiguration(config,repo=REPO){
 const p=locations(repo);
 assert.equal(config.format,'firstmate.s02-mailbox-runtime/1');assert.equal(config.caseId,CASE);assert.equal(config.nonce,NONCE);
 assert.equal(config.scenario,'normal');assert.equal(resolve(config.directory),p.directory);assert.equal(resolve(config.repositoryRoot),resolve(repo));
 assert.equal(config.nodeVersion,'v24.18.0');assert.equal(config.nodePath,'C:\\Program Files\\nodejs\\node.exe');
 assert.equal(resolve(config.rootEntry),resolve(repo,'docs/scoped-supervision/mailbox-qualification/root.mjs'));
 assert.equal(resolve(config.childEntry),resolve(repo,'docs/scoped-supervision/mailbox-qualification/child.mjs'));
 assert.match(config.pinsSha256,/^[a-f0-9]{64}$/);assert.match(config.controllerSha256,/^[a-f0-9]{64}$/);
 return config;
}
