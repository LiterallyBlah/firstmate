/** F1/F2/F3 review regressions through registered Home. All reads/data are synthetic. */
import {createRequire} from 'node:module';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../..'),out=resolve(root,'.local/smooth-pr2/regressions');
const repo=createRequire(resolve(root,'package.json')),local=createRequire(resolve(root,'docs/board-list/package.json'));
const{build}=local('esbuild'),{chromium}=local('playwright');
// The reviewed UI rebased unchanged onto slice 3. This commit remains an ancestor.
const baseline='58f56fe80bda3088259e95e0ed136a6bbb553b89';
const affected=new Set(['work-details.tsx','workflow-plans.tsx','project-ownership.tsx','maintenance-ownership.tsx','supervision-activation.tsx','migration-operations.tsx']);
await mkdir(resolve(out,'screenshots'),{recursive:true});
for(const stage of ['before','after'])await build({entryPoints:[resolve(here,'regression-panel.jsx')],outfile:resolve(out,stage+'.js'),bundle:true,jsx:'automatic',logLevel:'warning',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'review-regressions',setup(b){
 b.onResolve({filter:/^@getpaseo\/plugin$/},()=>({path:resolve(root,'docs/board-list/contracts.js')}));
 b.onResolve({filter:/^@getpaseo\/plugin\//},()=>({path:resolve(here,'stubs.jsx')}));
 b.onResolve({filter:/^react($|\/)/},a=>({path:repo.resolve(a.path)}));
 b.onResolve({filter:/^react-dom($|\/)/},a=>({path:local.resolve(a.path)}));
 b.onResolve({filter:/^react-native($|-web$)/},()=>({path:local.resolve('react-native-web')}));
 b.onResolve({filter:/^lucide-react$/},()=>({path:local.resolve('lucide-react')}));
 b.onLoad({filter:/smooth-pr2[\\/]data.jsx$/},async a=>({loader:'jsx',contents:await readFile(a.path,'utf8')+`
if(params.get('case')==='discuss')Object.assign(projects.projects[0],{name:'Reader',projectId:scope.scopes[1].id,scopeId:scope.scopes[1].id,agentId:scope.scopes[1].target.agentId,workspaceId:scope.scopes[1].workspaceId,sessions:1,turns:1});
if(params.get('case')==='read-error')window.review.scopeFail=true;
`}));
 b.onLoad({filter:/smooth-pr2[\\/]stubs.jsx$/},async a=>({loader:'jsx',contents:(await readFile(a.path,'utf8')).replace('window.review.calls.push({name:contract.name,input});',`window.review.calls.push({name:contract.name,input}); if(window.review.scopeFail&&contract.name==='firstmate.scope.read')throw new Error('Synthetic temporary scope read failure');`)}));
 if(stage==='before')b.onLoad({filter:/[\\/]client[\\/][^\\/]+\.tsx?$/},a=>{
  const path=relative(root,a.path).replaceAll('\\','/');if(!affected.has(path.slice('client/'.length)))return;
  return{contents:execFileSync('git',['show',`${baseline}:${path}`],{cwd:root,encoding:'utf8'}),loader:'tsx'};
 });
}}]});
const server=createServer(async(req,res)=>{
 const stage=req.url.includes('before')?'before':'after';res.setHeader('Content-Type',req.url.endsWith('.js')?'application/javascript':'text/html');
 res.end(req.url.endsWith('.js')?await readFile(resolve(out,stage+'.js')):`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;font-family:system-ui}#root{display:flex;flex-direction:column}*{box-sizing:border-box}button,input,select{font:inherit}button{min-height:44px}</style><div id="root"></div><script src="/${stage}.js"></script>`);
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({...(process.platform==='win32'?{channel:'msedge'}:{}),headless:true,args:['--disable-gpu']});
const results=[],failures=[];
const readCount=page=>page.evaluate(()=>window.review.calls.filter(c=>c.name==='firstmate.scope.read').length);
const settle=page=>page.waitForFunction(()=>window.review.cache.isFetching()===0);
try{
 for(const stage of ['before','after'])for(const theme of ['light','dark'])for(const[device,width,height]of[['desktop',1440,1000],['phone',390,844]])for(const scenario of ['discuss','read-error','layout','problem-layout']){
  const page=await browser.newPage({viewport:{width,height}}),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  const q=new URLSearchParams({stage,theme,home:'upgraded',features:scenario==='problem-layout'?'off':'on',case:scenario});
  if(['discuss','read-error'].includes(scenario))q.set('configured','');if(scenario==='problem-layout')q.set('problem','');
  await page.goto(origin+'/?'+q,{waitUntil:'networkidle'});await settle(page);
  await page.getByRole('button',{name:'Work details',exact:true}).click();await settle(page);
  const key=`${theme}-${device}-${scenario}-${stage}`,evidence={};
  if(scenario==='discuss'){
   await page.getByRole('button',{name:'Project mates and plans',exact:true}).click();
   await page.getByRole('button',{name:'Discuss Reader scope',exact:true}).click();
   if(stage==='after')await page.getByRole('dialog',{name:'Work details',exact:true}).waitFor({state:'hidden'});
   evidence.navigation=await page.evaluate(()=>window.review.navigation);
   evidence.dialogStillOpen=await page.getByRole('dialog',{name:'Work details',exact:true}).count()>0;
   const route=evidence.navigation.find(n=>n.params?.discussionScope);
   assert.equal(route?.params.discussionScope,'00000000-0000-4000-8000-000000000201');
   assert.equal(route?.params.discussionHome,'C:/fixture/FirstMate');
   if(stage==='after'&&evidence.dialogStillOpen)failures.push(key+': F1 discussion covered by Work details');
   if(stage==='before')assert.equal(evidence.dialogStillOpen,true,'baseline must reproduce F1');
  }else if(scenario==='read-error'){
   evidence.before=await readCount(page);
   await page.evaluate(()=>{window.review.scopeFail=false;});await page.keyboard.press('Escape');
   await page.getByRole('button',{name:'Work details',exact:true}).click();await settle(page);
   evidence.after=await readCount(page);
   evidence.currentStatus=await page.evaluate(()=>window.review.cache.getQueryState(['firstmate','scope-read','local','C:/fixture/FirstMate'])?.status);
   if(stage==='after'&&(evidence.after<=evidence.before||evidence.currentStatus!=='success'))failures.push(key+': F2 reopening performs no owning-query read');
   if(stage==='before')assert.equal(evidence.after,evidence.before,'baseline must reproduce F2');
   const retry=page.getByRole('button',{name:'Refresh details',exact:true});
   if(stage==='after'&&evidence.after>evidence.before&&evidence.currentStatus==='success'){
    assert.equal(await page.getByRole('dialog',{name:'Work details',exact:true}).count(),1,'successful recovery stays visible');
    await retry.waitFor({state:'visible'});
    assert.equal(await retry.count(),1,'a read-only recovery control is available');
    await page.evaluate(()=>{window.review.scopeFail=true;});await retry.click();await settle(page);
    assert.equal(await page.evaluate(()=>window.review.cache.getQueryState(['firstmate','scope-read','local','C:/fixture/FirstMate'])?.status),'error');
    await page.screenshot({path:resolve(out,'screenshots',key+'-retry-error.png')});
    const before=await readCount(page);await page.evaluate(()=>{window.review.scopeFail=false;});await retry.click();await settle(page);
    assert.ok(await readCount(page)>before);
    assert.equal(await page.evaluate(()=>window.review.cache.getQueryState(['firstmate','scope-read','local','C:/fixture/FirstMate'])?.status),'success');
    await retry.waitFor({state:'visible'});
    await page.getByText('Plan help could not be refreshed.',{exact:false}).waitFor({state:'hidden'});
   }
  }else{
   await page.getByRole('button',{name:'Project mates and plans',exact:true}).click();
   await page.evaluate(()=>{
    const nodes=[...document.querySelectorAll('*')].filter(el=>[...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim()));
    const sizes=nodes.map(el=>({el,size:parseFloat(getComputedStyle(el).fontSize),line:parseFloat(getComputedStyle(el).lineHeight)}));
    for(const{el,size,line}of sizes){el.style.fontSize=`${size*2}px`;if(Number.isFinite(line))el.style.lineHeight=`${line*2}px`;}
   });
   await page.getByRole('button',{name:stage==='before'?'Refresh maintenance':'Technical details',exact:true}).scrollIntoViewIfNeeded();
   evidence.buttons=await page.getByRole('dialog',{name:'Work details',exact:true}).evaluate(dialog=>{
    const bounds=dialog.getBoundingClientRect();return[...dialog.querySelectorAll('[role="button"],button')].map(el=>{
     const r=el.getBoundingClientRect();let clipped=r.left<bounds.left-.5||r.right>bounds.right+.5;
     for(let p=el.parentElement;p&&p!==dialog;p=p.parentElement){const c=getComputedStyle(p),b=p.getBoundingClientRect();if(['hidden','auto','scroll'].includes(c.overflowX)&& (r.left<b.left-.5||r.right>b.right+.5))clipped=true;}
     return{label:el.getAttribute('aria-label')||el.textContent,left:r.left,right:r.right,height:r.height,dialogRight:bounds.right,clipped};
    });
   });
   const clipped=evidence.buttons.filter(b=>b.clipped);
   if(stage==='after'&&clipped.length)failures.push(key+': F3 clipped controls '+clipped.map(b=>b.label).join(', '));
   if(stage==='before'&&device==='phone')assert.ok(clipped.some(b=>b.label==='Create maintenance owner'),'baseline must reproduce F3');
   assert.ok(evidence.buttons.every(b=>b.height>=43.5),'interactive controls retain 44px height');
  }
  assert.deepEqual(errors,[]);const calls=await page.evaluate(()=>window.review.calls);
  assert.equal(calls.filter(c=>/attach-ui|provision-ui|recover-ui|abort-ui|\.migrate$|admit-ui|\.discuss$|\.answer$/.test(c.name)).length,0,'review navigation/retry must not send or provision');
  await page.screenshot({path:resolve(out,'screenshots',key+'.png')});
  results.push({key,stage,theme,device,scenario,errors,calls,...evidence});console.log(key);await page.close();
 }
}finally{await browser.close();await new Promise(done=>server.close(done));await writeFile(resolve(out,'results.json'),JSON.stringify({passed:!failures.length,baseline,failures,results},null,2));}
assert.deepEqual(failures,[],'review regression failures');console.log(JSON.stringify({passed:true,cases:results.length,out}));
