/** Paseo compilation + actual class-node check + complete Hermes parse. The older shell harness
 * counts the three maintenance `class:` property keys on the pinned baseline as class syntax. */
import {createRequire} from "node:module";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {mkdir,writeFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import assert from "node:assert/strict";
const compiler=process.env.PASEO_COMPILER;
assert.ok(compiler,"Set PASEO_COMPILER to the installed, inspected Paseo compiler; this check never installs a plugin.");
const {compilePlugin}=await import(pathToFileURL(compiler).href),repo=createRequire(resolve("package.json")),{parse}=repo("@babel/parser");
const {clientBundle,serverBundle}=await compilePlugin({client:resolve("index.client.tsx"),server:resolve("index.server.ts")});
const classes=[],walk=node=>{if(!node||typeof node!=="object")return;if(node.type==="ClassDeclaration"||node.type==="ClassExpression")classes.push(node.type);for(const value of Object.values(node))if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==="object")walk(value)};
walk(parse(clientBundle,{sourceType:"script"}));assert.deepEqual(classes,[]);assert.equal(clientBundle.includes("node_modules/pixi.js"),false);assert.equal(clientBundle.includes("iVBORw0KGgo"),false);
const out=resolve(".local/fmu-foundation/native");await mkdir(out,{recursive:true});const file=resolve(out,"client.js");await writeFile(file,clientBundle);
const platform=process.platform==="win32"?"win64-bin/hermesc.exe":process.platform==="darwin"?"osx-bin/hermesc":"linux64-bin/hermesc";
execFileSync(resolve("node_modules/react-native/sdks/hermesc",platform),["-emit-binary","-out",resolve(out,"client.hbc"),file],{stdio:"pipe"});
const receipt={compiler,clientBytes:Buffer.byteLength(clientBundle),serverBytes:Buffer.byteLength(serverBundle),classDeclarations:0,hermes:"pass",legacyClassWordMatches:[...clientBundle.matchAll(/\bclass\b/g)].length};
await writeFile(resolve(out,"results.json"),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
