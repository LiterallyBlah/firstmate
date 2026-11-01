/** Source bundle qualification only. Does not load, install or activate a plugin. */
import {readFile,mkdir,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {createRequire} from "node:module";
import assert from "node:assert/strict";
const compiler=process.env.PASEO_COMPILER;
assert(compiler,"Set PASEO_COMPILER to the installed source compiler; no daemon is used.");
const out=resolve(".local/fmu-assignments/native");await mkdir(out,{recursive:true});
const {compilePlugin}=await import(pathToFileURL(compiler).href);
const {clientBundle,serverBundle}=await compilePlugin({client:resolve("index.client.tsx"),server:resolve("index.server.ts")});
const {parse}=createRequire(import.meta.url)("@babel/parser"),parsed=parse(clientBundle,{sourceType:"script"});
let classes=0;function walk(node){if(!node||typeof node!=="object")return;if(node.type==="ClassDeclaration"||node.type==="ClassExpression")classes++;for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==="object")walk(value);}}walk(parsed);
assert.equal(classes,0,"No client class AST nodes");
assert.equal(clientBundle.includes("node_modules/pixi.js"),false);
assert.equal(clientBundle.includes("iVBORw0KGgo"),false);
await writeFile(join(out,"client.js"),clientBundle);await writeFile(join(out,"server.js"),serverBundle);
const platform=process.platform==="win32"?"win64-bin/hermesc.exe":process.platform==="darwin"?"osx-bin/hermesc":"linux64-bin/hermesc";
execFileSync(resolve("node_modules/react-native/sdks/hermesc",platform),["-emit-binary","-out",join(out,"client.hbc"),join(out,"client.js")],{stdio:"pipe"});
const receipt={compiler,clientClassAstNodes:classes,completeHermesParse:true,clientBytes:Buffer.byteLength(clientBundle),serverBytes:Buffer.byteLength(serverBundle),
 clientSha256:createHash("sha256").update(clientBundle).digest("hex"),serverSha256:createHash("sha256").update(serverBundle).digest("hex"),
 classWordOccurrences:(clientBundle.match(/\bclass\b/g)??[]).length,qualification:"source compile only; no installed or live runtime claim"};
await writeFile(join(out,"results.json"),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
