/** Both native entrypoints, production review component, synthetic host only. */
import {createRequire} from "node:module";
import {resolve} from "node:path";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import assert from "node:assert/strict";
const root=process.cwd(),out=resolve(root,".local/fmu-assignments/ui"),local=createRequire(resolve(root,"docs/board-list/package.json")),repo=createRequire(resolve(root,"package.json"));
const {build}=local("esbuild"),{chromium}=local("playwright");await mkdir(out,{recursive:true});
await build({entryPoints:[resolve(root,"docs/fmu-assignments/panel.jsx")],outfile:resolve(out,"app.js"),bundle:true,jsx:"automatic",logLevel:"warning",define:{"process.env.NODE_ENV":'"development"'},plugins:[{name:"synthetic-host",setup(b){
 b.onResolve({filter:/^@getpaseo\/plugin$/},()=>({path:resolve(root,"docs/board-list/contracts.js")}));
 b.onResolve({filter:/^@getpaseo\/plugin\//},()=>({path:resolve(root,"docs/fmu-foundation/stubs.jsx")}));
 b.onResolve({filter:/^\.\/workflow-plans$/},a=>a.importer.includes("client")?({path:resolve(root,"docs/fmu-foundation/stubs.jsx")}):undefined);
 b.onResolve({filter:/^react($|\/)/},a=>({path:repo.resolve(a.path)}));b.onResolve({filter:/^react-dom($|\/)/},a=>({path:local.resolve(a.path)}));
 b.onResolve({filter:/^react-native($|-web$)/},()=>({path:local.resolve("react-native-web")}));b.onResolve({filter:/^lucide-react$/},()=>({path:local.resolve("lucide-react")}));
}}]});
const server=createServer(async(req,res)=>{const js=req.url.endsWith(".js");res.setHeader("Content-Type",js?"text/javascript":"text/html");res.end(js?await readFile(resolve(out,"app.js")):`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;min-height:100%;font-family:system-ui}*{box-sizing:border-box}button:focus-visible{outline:2px solid #20744a;outline-offset:2px}</style><div id="root"></div><script src="/app.js"></script>`)});
await new Promise(r=>server.listen(0,"127.0.0.1",r));const browser=await chromium.launch({...(process.platform==="win32"?{channel:"msedge"}:{}),headless:true}),results=[];
try{for(const theme of ["light","dark"])for(const width of [1440,390])for(const scene of ["choose","review","prepared","committed","paused","stale","disabled"]){
 const captures=[];
 for(const entry of ["home","watch","plan"]){const page=await browser.newPage({viewport:{width,height:width===390?844:1000}}),errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/?${new URLSearchParams({theme,scene,entry})}`,{waitUntil:"networkidle"});
 if(scene==="review"){const choice=page.getByRole("button",{name:/^Review export-checks to/});await choice.focus();await page.keyboard.press("Enter");await page.getByRole("button",{name:"Prepare reviewed watch assignment",exact:true}).waitFor();}
 assert.deepEqual(await page.evaluate(()=>window.actions),[]);assert.deepEqual(await page.evaluate(()=>window.fixtureCalls),[]);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 assert.equal(await page.getByRole("button",{name:"Enable independent read-only observer unavailable",exact:true}).isDisabled(),true);
 const path=resolve(out,`${theme}-${width}-${scene}-${entry}.png`),png=await page.screenshot({path,fullPage:true});captures.push(png.toString("base64"));
 results.push({theme,width,scene,entry,screenshot:path.slice(root.length+1),noOverflow:true,actions:0,errors});await page.close();}
 // Both entrypoints display precisely the same captured review; automatic pixel comparison.
 assert.equal(captures[0],captures[1]);assert.equal(captures[1],captures[2]);results.push({theme,width,scene,comparison:"home/watch/plan",identical:true});
}}finally{await browser.close();await new Promise(r=>server.close(r));}
await writeFile(resolve(out,"results.json"),JSON.stringify(results,null,2));console.log(JSON.stringify({captures:results.filter(r=>r.screenshot).length,comparisons:results.filter(r=>r.comparison).length,allChecksPassed:true,liveHost:false}));
