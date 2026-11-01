/** Native components with synthetic host only; pinned source comparison, no daemon or provider. */
import {createRequire} from "node:module";
import {resolve} from "node:path";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {createServer} from "node:http";
import assert from "node:assert/strict";
const root=process.cwd(),out=resolve(root,".local/fmu-foundation/ui"),local=createRequire(resolve(root,"docs/board-list/package.json")),repo=createRequire(resolve(root,"package.json"));
const {build}=local("esbuild"),{chromium}=local("playwright");await mkdir(out,{recursive:true});
for(const stage of ["before","after"])await build({entryPoints:[resolve(root,"docs/fmu-foundation/panel.jsx")],outfile:resolve(out,stage+".js"),bundle:true,jsx:"automatic",logLevel:"warning",define:{"process.env.NODE_ENV":'"development"'},plugins:[{name:"synthetic-host",setup(b){
 b.onResolve({filter:/^@getpaseo\/plugin$/},()=>({path:resolve(root,"docs/board-list/contracts.js")}));
 b.onResolve({filter:/^@getpaseo\/plugin\//},()=>({path:resolve(root,"docs/fmu-foundation/stubs.jsx")}));
 b.onResolve({filter:/^\.\/workflow-plans$/},a=>a.importer.includes("client")?({path:resolve(root,"docs/fmu-foundation/stubs.jsx")}):undefined);
 b.onResolve({filter:/^react($|\/)/},a=>({path:repo.resolve(a.path)}));b.onResolve({filter:/^react-dom($|\/)/},a=>({path:local.resolve(a.path)}));
 b.onResolve({filter:/^react-native($|-web$)/},()=>({path:local.resolve("react-native-web")}));b.onResolve({filter:/^lucide-react$/},()=>({path:local.resolve("lucide-react")}));
 if(stage==="before")b.onLoad({filter:/[\\/]client[\\/]supervision-activation\.tsx$/},()=>({contents:execFileSync("git",["show","37113ec6b694a08a47f96d62fee5ff55c2889004:client/supervision-activation.tsx"],{encoding:"utf8"}),loader:"tsx"}));
}}]});
const server=createServer(async(req,res)=>{const stage=req.url.includes("before")?"before":"after",js=req.url.endsWith(".js");res.setHeader("Content-Type",js?"text/javascript":"text/html");res.end(js?await readFile(resolve(out,stage+".js")):`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;min-height:100%;font-family:system-ui}*{box-sizing:border-box}button,input,textarea{font:inherit}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid #20744a;outline-offset:2px}</style><div id="root"></div><script src="/${stage}.js"></script>`)});
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch({...(process.platform==="win32"?{channel:"msedge"}:{}),headless:true}),results=[];
try{for(const theme of ["light","dark"])for(const width of [1440,390])for(const scene of ["attach","active","pending","paused","stale","uncertain","observer"]){
 const shots={};for(const stage of scene==="attach"?["before","after"]:["after"]){const page=await browser.newPage({viewport:{width,height:width===390?844:1000}}),errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/?${new URLSearchParams({stage,theme,scene})}`,{waitUntil:"networkidle"});
 if(scene==="attach"){
  const model=page.getByRole("button",{name:/^Supervisor model:/});await model.focus();await page.keyboard.press("Enter");await page.getByRole("button",{name:"Sol 6.1",exact:true}).click();
  await page.getByRole("button",{name:/^Permission mode:/}).click();await page.getByRole("button",{name:stage==="before"?"Full access":"Full access (full-access)",exact:true}).click();
  if(stage==="after")await page.getByRole("button",{name:/^Reasoning: High/}).waitFor();
 }else if(scene==="active") {await page.getByRole("button",{name:"Review profile change",exact:true}).click();await page.getByRole("button",{name:"Save pending profile change",exact:true}).waitFor();}
 else if(scene==="pending"){await page.getByRole("button",{name:"Review replacement",exact:true}).click();await page.getByLabel("Replacement checkpoint and opening").fill("Continue from the retained checkpoint; no changed authority.");}
 else if(scene==="observer")await page.getByRole("alert").filter({hasText:/read.only/}).waitFor();
 assert.deepEqual(await page.evaluate(()=>window.actions),[]);assert.equal(await page.evaluate(()=>window.fixtureCalls.filter(c=>c.name!=="firstmate.mate.targets").length),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 const path=resolve(out,`${stage}-${theme}-${width}-${scene}.png`);const png=await page.screenshot({path,fullPage:false});shots[stage]=png.toString("base64");
 results.push({stage,theme,width,scene,noOverflow:true,actions:0,errors,screenshot:path.slice(root.length+1)});await page.close();}
 if(scene==="attach"){const page=await browser.newPage({viewport:{width,height:width===390?844:1000}});const diff=await page.evaluate(async shots=>{const images=await Promise.all(Object.values(shots).map(src=>new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.src="data:image/png;base64,"+src})));const pixels=images.map(i=>{const c=document.createElement("canvas");c.width=i.width;c.height=i.height;const x=c.getContext("2d");x.drawImage(i,0,0);return x.getImageData(0,0,c.width,c.height).data});let changed=0;for(let i=0;i<pixels[0].length;i+=4)if([0,1,2].some(k=>Math.abs(pixels[0][i+k]-pixels[1][i+k])>8))changed++;return{changedPixels:changed,totalPixels:pixels[0].length/4}},shots);results.push({theme,width,comparison:"pinned Attach vs shared explicit reasoning form",...diff,expectedChange:"Reasoning control and captured-profile explanation"});await page.close();}
}}finally{await browser.close();await new Promise(r=>server.close(r));}
await writeFile(resolve(out,"results.json"),JSON.stringify(results,null,2));console.log(JSON.stringify({captures:results.filter(r=>r.screenshot).length,comparisons:results.filter(r=>r.comparison).length,allChecksPassed:true,liveHost:false}));
