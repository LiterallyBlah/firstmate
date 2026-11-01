/** Run the checked-in CI's Node render/regression commands with the same argument vectors.
 * No shell, daemon, installation or live API. Retain every result, including failures. */
import {readFile,mkdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {spawnSync,execFileSync} from "node:child_process";
const out=resolve(".local/fmu-integration/gates");await mkdir(out,{recursive:true});
const workflow=await readFile(".github/workflows/check.yml","utf8"),head=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const commands=workflow.split(/\r?\n/).map(l=>/^\s+- run: node (.+)$/.exec(l)?.[1]).filter(Boolean);
const results=[];
for(const [index,command]of commands.entries()){
 const args=command.split(/ +/);if(!/^(?:docs\/|node_modules\/vitest\/vitest.mjs$)/.test(args[0]))throw Error("Unexpected CI command: "+command);
 const extra=args.includes("server/plan-help-wiring.test.ts")?{PR175_CAPTURE:"1"}:args.includes("test/fmu-integration/native-path.test.ts")?{FMU_INTEGRATION_CAPTURE:"1"}:{};
 const result=spawnSync(process.execPath,args,{env:{...process.env,...extra},encoding:"utf8",maxBuffer:64*1024*1024});
 const log=resolve(out,`${String(index+1).padStart(2,"0")}-${args[0].replace(/[^\w-]/g,"_")}.log`);
 await writeFile(log,(result.stdout??"")+(result.stderr??"")+(result.error?String(result.error):""));
 results.push({head,command:[process.execPath,...args],env:extra,exit:result.status,signal:result.signal,error:result.error?String(result.error):null,log});
 await writeFile(resolve(out,"results.json"),JSON.stringify(results,null,2));console.log(JSON.stringify(results.at(-1)));
}
if(results.some(r=>r.exit!==0))process.exitCode=1;
