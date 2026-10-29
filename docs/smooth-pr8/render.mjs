/** Current components against pre-slice baseline. Synthetic host only; writes ignored .local. */
import {createRequire} from 'node:module';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../..'),out=resolve(root,'.local/smooth-pr8/ui'),baseline='60d377fc';
const repo=createRequire(resolve(root,'package.json')),local=createRequire(resolve(root,'docs/board-list/package.json'));
const {build}=local('esbuild'),{chromium}=local('playwright');
await mkdir(resolve(out,'screenshots'),{recursive:true});
for(const stage of ['before','after'])await build({entryPoints:[resolve(here,'panel.jsx')],outfile:resolve(out,stage+'.js'),bundle:true,jsx:'automatic',logLevel:'warning',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'fixture-host',setup(b){
 b.onResolve({filter:/^@getpaseo\/plugin$/},()=>({path:resolve(root,'docs/board-list/contracts.js')}));
 b.onResolve({filter:/^@getpaseo\/plugin\//},()=>({path:resolve(here,'stubs.jsx')}));
 b.onResolve({filter:/^react($|\/)/},a=>({path:repo.resolve(a.path)}));
 b.onResolve({filter:/^react-dom($|\/)/},a=>({path:local.resolve(a.path)}));
 b.onResolve({filter:/^react-native($|-web$)/},()=>({path:local.resolve('react-native-web')}));
 b.onResolve({filter:/^lucide-react$/},()=>({path:local.resolve('lucide-react')}));
 if(stage==='before')b.onLoad({filter:/[\\/](client|shared)[\\/][^\\/]+\.tsx?$/},args=>{const path=relative(root,args.path).replaceAll('\\','/');return {contents:execFileSync('git',['show',`${baseline}:${path}`],{cwd:root,encoding:'utf8'}),loader:path.endsWith('tsx')?'tsx':'ts'};});
}}]});
const server=createServer(async(req,res)=>{const stage=req.url.includes('before')?'before':'after';res.setHeader('Content-Type',req.url.endsWith('.js')?'application/javascript':'text/html');res.end(req.url.endsWith('.js')?await readFile(resolve(out,stage+'.js')):`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;font-family:system-ui}#root{display:flex;flex-direction:column}*{box-sizing:border-box}button,input,textarea{font:inherit}:focus-visible{outline:2px solid #348b72;outline-offset:2px}</style><div id="root"></div><script src="/${stage}.js"></script>`);});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({...(process.platform==='win32'?{channel:'msedge'}:{}),headless:true,args:['--disable-gpu']}),results=[];
const cases=['discussion','discussion-details','new','remote','routine','needs','needs-details','needs-warning','needs-partial','maintenance-answer'];
try{
 for(const stage of ['before','after'])for(const theme of ['light','dark'])for(const [device,width,height]of [['desktop',1440,1000],['phone',390,844]])for(const name of cases){
  const page=await browser.newPage({viewport:{width,height}}),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  const surface=name==='discussion-details'?'discussion':name.startsWith('needs')?'needs':name;
  const q=new URLSearchParams({stage,theme,surface});if(name==='needs-warning')q.set('warning','');if(name==='needs-partial')q.set('partial','');
  await page.goto(origin+'/?'+q,{waitUntil:'networkidle'});
  if(surface==='needs'||surface==='maintenance-answer')await page.getByRole('button',{name:/^Answer:/}).last().click();
  if(name==='discussion-details')await page.getByRole('button',{name:'Details',exact:true}).click();
  if(stage==='after'&&name==='new')await page.getByRole('button',{name:'Review first message',exact:true}).click();
  if(stage==='after'&&name==='needs-details')await page.getByRole('button',{name:'Decision details',exact:true}).click();
  if(stage==='after'&&name==='needs-warning')await page.getByRole('button',{name:'Warning details',exact:true}).click();
  assert.deepEqual(errors,[],`${stage}/${theme}/${device}/${name}`);
  const state=await page.evaluate(()=>({text:document.body.innerText,overflow:document.documentElement.scrollWidth>innerWidth,calls:window.pr8.calls}));
  assert.equal(state.overflow,false,`${stage}/${theme}/${device}/${name} overflow`);
  assert.equal(state.calls.filter(c=>/\.(discuss|answer|activate|act)$|attach|provision/.test(c.name)).length,0,'reading and review create no effects');
  if(stage==='after'){
   if(surface==='discussion')assert.doesNotMatch(state.text,/Shared stream|Discussion scope|@mate selects/);
   if(name==='needs')assert.doesNotMatch(state.text,/Scope [0-9a-f-]{36}|owner epoch|Scoped decision|Inbox scope|Unscoped quarantines/);
   if(name==='needs-details')assert.match(state.text,/owner epoch 1/);
   if(name==='needs-warning')assert.match(state.text,/Unidentified task scope requires reconciliation/);
   if(name==='needs-partial'){assert.doesNotMatch(state.text,/No decisions right now/);assert.match(state.text,/1\+/);}
   if(name==='remote'||name==='routine')assert.equal(await page.getByRole('button',{name:'Send',exact:true}).isDisabled(),true);
   const controls=page.getByTestId(surface==='needs'||surface==='maintenance-answer'?'scoped-needs':'scope-discussion').getByRole('button');
   for(const control of await controls.all())if(await control.isVisible()){const box=await control.boundingBox();assert.ok(box.height>=44,`44px control: ${await control.getAttribute('aria-label')}`);}
  }
  const key=`${stage}-${theme}-${device}-${name}`;await page.screenshot({path:resolve(out,'screenshots',key+'.png')});results.push({key,errors,...state});
  if(stage==='after'&&name==='new'){
   const composer=page.getByRole('textbox',{name:'Message recipient'});
   const draft=await composer.inputValue();
   await page.evaluate(()=>{window.pr8.scope.scopes[3].target.scopeVersion++;});
   await page.getByRole('button',{name:'Refresh',exact:true}).click();
   await page.getByText('The message or recipient changed. Review it again before sending.',{exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Start conversation and send',exact:true}).isDisabled(),true);
   assert.equal(await composer.inputValue(),draft);
   await page.getByRole('button',{name:'Keep editing',exact:true}).click();
   assert.equal(await composer.evaluate(el=>el===document.activeElement),true,'editing returns focus to draft');
   await page.getByRole('button',{name:'Review first message',exact:true}).click();
   await page.getByRole('button',{name:'Start conversation and send',exact:true}).click();
   await page.waitForFunction(()=>window.pr8.calls.filter(c=>c.name==='firstmate.scope.discuss').length===1);
   assert.equal(await page.evaluate(()=>window.pr8.calls.find(c=>c.name==='firstmate.scope.discuss').input.route.target.scopeVersion),2);
   results.at(-1).firstSend={targetChangeHeld:true,draftRetained:true,editingFocusReturned:true,explicitSends:1};
  }
  if(stage==='after'&&device==='phone'&&['new','needs','needs-warning'].includes(name)){
   await page.evaluate(()=>{const nodes=[...document.querySelectorAll('div,span,p,button,input,textarea')].filter(el=>[...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim()));const sizes=nodes.map(el=>({el,size:parseFloat(getComputedStyle(el).fontSize),line:parseFloat(getComputedStyle(el).lineHeight)}));for(const {el,size,line}of sizes){el.style.fontSize=`${size*2}px`;if(Number.isFinite(line))el.style.lineHeight=`${line*2}px`;}});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'200% text width');await page.screenshot({path:resolve(out,'screenshots',key+'-text200.png')});
  }
  console.log(key);await page.close();
 }
 await writeFile(resolve(out,'results.json'),JSON.stringify({passed:true,baseline,captures:results.length,results},null,2));console.log(JSON.stringify({passed:true,captures:results.length,out}));
}finally{await browser.close();await new Promise(done=>server.close(done));}
