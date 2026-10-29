/** Actual plan browser/review at a pinned baseline and current source; synthetic host only. */
import {createRequire} from 'node:module';
import {dirname,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../..'),out=resolve(root,'.local/smooth-pr9/ui');
const repo=createRequire(resolve(root,'package.json')),local=createRequire(resolve(root,'docs/board-list/package.json'));
const {build}=local('esbuild'),{chromium}=local('playwright');
const baseline='9c3485e8';
await mkdir(resolve(out,'screenshots'),{recursive:true});
for(const stage of ['before','after'])await build({entryPoints:[resolve(here,'panel.jsx')],outfile:resolve(out,stage+'.js'),bundle:true,jsx:'automatic',logLevel:'warning',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'isolated-host',setup(b){
 b.onResolve({filter:/^@getpaseo\/plugin$/},()=>({path:resolve(root,'docs/board-list/contracts.js')}));
 b.onResolve({filter:/^@getpaseo\/plugin\//},()=>({path:resolve(here,'stubs.jsx')}));
 b.onResolve({filter:/^react($|\/)/},a=>({path:repo.resolve(a.path)}));
 b.onResolve({filter:/^react-dom($|\/)/},a=>({path:local.resolve(a.path)}));
 b.onResolve({filter:/^react-native($|-web$)/},()=>({path:local.resolve('react-native-web')}));
 b.onResolve({filter:/^lucide-react$/},()=>({path:local.resolve('lucide-react')}));
 b.onResolve({filter:/^\.\/workflow-plans$/},a=>a.importer.includes('client')?{path:resolve(here,'context.jsx')}:undefined);
 if(stage==='before')b.onLoad({filter:/[\\/]client[\\/]workflow-plan-browser\.tsx$/},a=>({contents:execFileSync('git',['show',`${baseline}:${relative(root,a.path).replaceAll('\\','/')}`],{cwd:root,encoding:'utf8'}),loader:'tsx'}));
}}]});
const server=createServer(async(req,res)=>{const stage=req.url.includes('before')?'before':'after';res.setHeader('Content-Type',req.url.endsWith('.js')?'application/javascript':'text/html');res.end(req.url.endsWith('.js')?await readFile(resolve(out,stage+'.js')):`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;font-family:system-ui}#root{display:flex;flex-direction:column}*{box-sizing:border-box}button,input,select{font:inherit}button{min-height:44px;min-width:44px}:focus-visible{outline:2px solid currentColor;outline-offset:2px}</style><div id="root"></div><script src="/${stage}.js"></script>`);});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({...(process.platform==='win32'?{channel:'msedge'}:{}),headless:true,args:['--disable-gpu']}),results=[];
const writes=page=>page.evaluate(()=>window.review.calls.filter(c=>/\.(set|migrate|attach-ui)$/.test(c.name)));
async function capture(page,key){const state=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,text:document.body.innerText,calls:window.review.calls}));assert.equal(state.overflow,false,key);await page.screenshot({path:resolve(out,'screenshots',key+'.png')});results.push({key,...state});}
async function targets(page,id='plan-help-review'){const nodes=page.getByTestId(id).locator('[role="button"],input,textarea');for(let i=0;i<await nodes.count();i++){const n=nodes.nth(i);await n.scrollIntoViewIfNeeded();const r=await n.boundingBox();assert.ok(r.width>=43.5&&r.height>=43.5,await n.getAttribute('aria-label'));assert.ok(r.x>=0&&r.x+r.width<=page.viewportSize().width+1,'control clipped');}}
try{
 for(const theme of ['light','dark'])for(const [device,width,height]of [['desktop',1440,1000],['phone',390,844]]){
  for(const stage of ['before','after']){
   const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
   await page.goto(`${origin}/?${new URLSearchParams({stage,theme,home:'upgraded',features:'on'})}`,{waitUntil:'networkidle'});
   await capture(page,`${theme}-${device}-plans-${stage}`);assert.deepEqual(await writes(page),[]);
   if(stage==='after'){
    const id=await page.evaluate(()=>window.review.target),entry=page.getByTestId('workflow-plan-'+id).getByRole('button',{name:'Review plan help',exact:true});
    await entry.click();await page.getByText('Current owner: Captain',{exact:true}).waitFor();await capture(page,`${theme}-${device}-review`);await targets(page);assert.deepEqual(await writes(page),[]);
    await page.keyboard.press('Escape');assert.equal(await entry.evaluate(el=>el===document.activeElement),true,'focus return');await entry.click();
    await page.getByLabel('Backup folder',{exact:true}).fill('C:/Independent backups');await page.getByLabel('Backup retention',{exact:true}).fill('Keep for 30 days; retain manually until reviewed.');
    await page.getByRole('button',{name:'Save backup settings',exact:true}).click();await page.waitForFunction(()=>window.review.calls.some(c=>c.name.endsWith('backup.set')));
    await page.getByRole('button',{name:'Handover evidence',exact:true}).click();
    for(const [name,value]of [['Reviewed delivery inventory','reviewed-deliveries'],['Compatible rollback build','reviewed-build'],['Accepted permission import','reviewed-permission-import']])await page.getByLabel(name,{exact:true}).fill(value);
    await page.getByRole('button',{name:'Review handover',exact:true}).click();await capture(page,`${theme}-${device}-confirm`);assert.equal((await writes(page)).length,1);
    await page.getByRole('button',{name:'Confirm this handover step',exact:true}).click();await page.getByRole('button',{name:'Check handover deliveries',exact:true}).waitFor();await capture(page,`${theme}-${device}-prepared`);
    for(const label of ['Check handover deliveries','Review handover checks','Review ownership change']){
     await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('button',{name:'Confirm this handover step',exact:true}).click();
    }
    await page.getByText('Handover is complete. The captain can now review Attach below.',{exact:true}).waitFor();await capture(page,`${theme}-${device}-committed`);
    assert.equal((await writes(page)).filter(c=>c.name.endsWith('attach-ui')).length,0,'handover never attaches');
    await page.getByRole('button',{name:'Attach plan helper',exact:true}).click();await page.getByTestId('supervision-attach-confirmation').waitFor();await capture(page,`${theme}-${device}-attach-review`);await targets(page,'supervision-attach-confirmation');assert.equal((await writes(page)).filter(c=>c.name.endsWith('attach-ui')).length,0);
   }
   assert.deepEqual(errors,[]);await page.close();
  }
  for(const scenario of ['held','invalid']){
   const page=await browser.newPage({viewport:{width,height}});await page.goto(`${origin}/?${new URLSearchParams({stage:'after',theme,home:'upgraded',features:'on',case:scenario})}`,{waitUntil:'networkidle'});
   const id=await page.evaluate(()=>window.review.target);await page.getByTestId('workflow-plan-'+id).getByRole('button',{name:'Review plan help',exact:true}).click();
   if(scenario==='invalid'){
    await page.getByLabel('Backup folder',{exact:true}).fill('C:/FirstMate');await page.getByLabel('Backup retention',{exact:true}).fill('Keep for 30 days');await page.getByRole('button',{name:'Save backup settings',exact:true}).click();await page.getByRole('button',{name:'Review corrected backup settings',exact:true}).waitFor();
    await capture(page,`${theme}-${device}-invalid`);await page.getByRole('button',{name:'Review corrected backup settings',exact:true}).click();await page.getByLabel('Backup folder',{exact:true}).fill('C:/Independent backups');
   }else{assert.equal(await page.getByRole('button',{name:'Review handover',exact:true}).isDisabled(),true);await capture(page,`${theme}-${device}-held`);}
   await page.evaluate(()=>{const nodes=[...document.querySelectorAll('*')].filter(el=>[...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim()));const sizes=nodes.map(el=>({el,size:parseFloat(getComputedStyle(el).fontSize),line:parseFloat(getComputedStyle(el).lineHeight)}));for(const {el,size,line}of sizes){el.style.fontSize=size*2+'px';if(Number.isFinite(line))el.style.lineHeight=line*2+'px';}});
   await targets(page);await capture(page,`${theme}-${device}-${scenario}-text200`);await page.close();
  }
 }
 await writeFile(resolve(out,'results.json'),JSON.stringify(results,null,2));console.log(`${results.length} production-component captures and assertions passed.`);
}finally{await browser.close();server.close();}
