/** Read-only predecessor evidence audit. Does not execute any inherited script. */
import {readFile,mkdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import assert from "node:assert/strict";
const paseo=process.env.FMU_INPUT_ROOT??"C:/Users/micha/.paseo",data=resolve(paseo,"plugin-data/firstmate/home/data");
const out=resolve(".local/fmu-integration"),sha=b=>createHash("sha256").update(b).digest("hex");
await mkdir(out,{recursive:true});
const pins=[
 [resolve(data,"fm-supervisor-unification-plan/implementation-plan.md"),"de8423e7e603d4957f467e39740301df08b0270142244c20a35b082897cedd82"],
 [resolve(data,"fm-supervisor-unification-scout/review-resolution.md"),"0762d195c14a9053040125a969a1b5273e5c5adfcc192e37475b10bc47940a43"],
 [resolve(data,"fm-supervisor-unification-review/report.md"),"3c24ce3db44fde931a024d661359ded382bb09e09a543b2b0d2720318d40f77e"],
 [resolve(data,"fmu-assignments-review/correction-acceptance-report.md"),"1635bacf79c08b915d9189a0a410e6b7e4b6a211900006e8a7cd4982d379fb5c"],
 [resolve(data,"fmu-assignments-review/correction-acceptance-manifest.json"),"d379a700b77d569496206c864840947cd03b4d6003c153cd0663f3b47d0ece93"],
 [resolve(paseo,"worktrees/23z5sbxl/fmu-assignments/.local/fmu-assignments/corrections/report.md"),"298b4eb7081e97b7a7cfdd7a8b1a0177471ff15cb6914595254143151cd6ebcc"],
 [resolve(paseo,"worktrees/23z5sbxl/fmu-assignments/.local/fmu-assignments/corrections/final-manifest.json"),"51083173005e8228df49a9e81951ab3a4f5726ac06189475889f3f97a9071ca7"],
];
for(const [path,hash] of pins)assert.equal(sha(await readFile(path)),hash,path);
const audits=[];
for(const [manifest,root,count] of [
 [pins[4][0],resolve(paseo,"worktrees/23z5sbxl/fmu-assignments-review/.local/fmu-assignments-review/corrections"),49],
 [pins[6][0],resolve(paseo,"worktrees/23z5sbxl/fmu-assignments/.local/fmu-assignments/corrections"),269],
]){
 const m=JSON.parse(await readFile(manifest,"utf8"));assert.equal(m.files.length,count);
 for(const f of m.files){const bytes=await readFile(resolve(root,f.path));assert.equal(bytes.length,f.bytes,f.path);assert.equal(sha(bytes),f.sha256,f.path);}
 audits.push({manifest,root,files:count,verified:true});
}
const git=(...args)=>execFileSync("git",args);
for(const head of ["27ffa47ff76e16b9824d21d9f623ed37d47f757c","11ceae67064903398fe8e47dbe246ee5a8c46bf1","ce98f3b5b612af744bb7f81467cb821698b8bcdf","b9793eba4cd915c60e238aad9fdf599903b33fd7"])git("merge-base","--is-ancestor",head,"HEAD");
assert.equal(git("diff","27ffa47","HEAD","--","test/fmu-foundation/acceptance.json","test/fmu-foundation/baseline-receipt.json").length,0);
const qualification=JSON.parse(await readFile(resolve(paseo,"worktrees/23z5sbxl/fmu-assignments/.local/fmu-assignments/corrections/qualification.json"),"utf8"));
assert.equal(qualification.pins.length,13);
for(const pin of qualification.pins)assert.equal(sha(git("show",`ce98f3b:${pin.path}`)),pin.sha256,pin.path);
const draft=await readFile(resolve(data,"fm-supervisor-unification-plan/draft-plan.json"));JSON.parse(draft);
const result={head:git("rev-parse","HEAD").toString().trim(),pins:pins.map(([path,sha256])=>({path,sha256})),draftSha256:sha(draft),audits,stage2BlobPins:13,
 originalFailuresRetained:true,frozenAcceptanceUnchanged:true,boundary:"Inherited bytes and source ancestry only. Fresh Stage 3 checks remain required."};
await writeFile(resolve(out,"input-audit.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
