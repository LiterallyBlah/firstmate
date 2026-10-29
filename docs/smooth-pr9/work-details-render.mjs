/** Captain's empty Plan help reproduction through the registered Home and actual Work details drawer. */
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const root=process.cwd(),out=resolve(root,'.local/smooth-pr9/work-details'),evidence=resolve(root,'docs/smooth-pr9/evidence');
const repo=createRequire(resolve(root,'package.json')),local=createRequire(resolve(root,'docs/board-list/package.json')),{build}=local('esbuild'),{chromium}=local('playwright');
await mkdir(out,{recursive:true});await mkdir(evidence,{recursive:true});
for(const stage of ['before','after'])await build({entryPoints:[resolve(root,'docs/smooth-pr2/regression-panel.jsx')],outfile:resolve(out,stage+'.js'),bundle:true,jsx:'automatic',logLevel:'warning',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'work-details-host',setup(b){
 b.onResolve({filter:/^@getpaseo\/plugin$/},()=>({path:resolve(root,'docs/board-list/contracts.js')}));
 b.onResolve({filter:/^@getpaseo\/plugin\//},()=>({path:resolve(root,'docs/smooth-pr2/stubs.jsx')}));
 b.onResolve({filter:/^react($|\/)/},a=>({path:repo.resolve(a.path)}));b.onResolve({filter:/^react-dom($|\/)/},a=>({path:local.resolve(a.path)}));
 b.onResolve({filter:/^react-native($|-web$)/},()=>({path:local.resolve('react-native-web')}));b.onResolve({filter:/^lucide-react$/},()=>({path:local.resolve('lucide-react')}));
 b.onLoad({filter:/smooth-pr2[\\/]data.jsx$/},async a=>({loader:'jsx',contents:await readFile(a.path,'utf8')+'\nactivation.operatorEnabled=false;\n'}));
 if(stage==='before')b.onLoad({filter:/[\\/]client[\\/]supervision-activation\.tsx$/},()=>({contents:execFileSync('git',['show','fbdf3ae0:client/supervision-activation.tsx'],{encoding:'utf8'}),loader:'tsx'}));
}}]});
const server=createServer(async(req,res)=>{const stage=req.url.includes('before')?'before':'after';res.setHeader('Content-Type',req.url.endsWith('.js')?'application/javascript':'text/html');res.end(req.url.endsWith('.js')?await readFile(resolve(out,stage+'.js')):`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;font-family:system-ui}#root{display:flex;flex-direction:column}*{box-sizing:border-box}button,input,select{font:inherit}button{min-height:44px}</style><div id="root"></div><script src="/${stage}.js"></script>`);});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({...(process.platform==='win32'?{channel:'msedge'}:{}),headless:true,args:['--disable-gpu']}),results=[];
try{
 for(const theme of ['light','dark'])for(const[device,width,height]of[['desktop',1440,1000],['phone',390,844]])for(const scenario of ['empty','problem'])for(const stage of ['before','after']){
  const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
  const params=new URLSearchParams({stage,theme,home:'upgraded',features:'on',case:'layout'});if(scenario==='problem')params.set('problem','');
  await page.goto(`http://127.0.0.1:${server.address().port}/?${params}`,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.review.cache.isFetching()===0);
  await page.getByRole('button',{name:'Work details',exact:true}).click();await page.waitForFunction(()=>window.review.cache.isFetching()===0);
  const dialog=page.getByRole('dialog',{name:'Work details',exact:true}),board=dialog.getByTestId('supervision-activation-board');
  if(scenario==='empty'){
   if(stage==='before'){assert.equal(await board.count(),1);assert.equal((await board.innerText()).trim(),'Plan help','must reproduce the bare heading');}
   else{assert.equal(await board.count(),0,'empty Plan help must occupy no section');assert.equal(await dialog.getByText('Plan help',{exact:true}).count(),0);}
  }else{assert.equal(await board.count(),1);assert.ok((await board.innerText()).includes('Journal hash mismatch'));}
  const state=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,calls:window.review.calls,text:document.body.innerText}));
  assert.equal(state.overflow,false);assert.deepEqual(errors,[]);assert.equal(state.calls.some(c=>/\.(set|migrate|attach-ui|provision-ui)$/.test(c.name)),false);
  const key=`${theme}-${device}-work-details-${scenario}-${stage}`;await page.screenshot({path:resolve(out,key+'.png')});results.push({key,...state});await page.keyboard.press('Escape');await page.close();
 }
 for(const theme of ['light','dark'])for(const device of ['desktop','phone']){
  const width=device==='desktop'?720:390,page=await browser.newPage({viewport:{width:width*2+48,height:1000}}),figures=[];
  for(const stage of ['before','after']){const name=`${theme}-${device}-work-details-empty-${stage}`,bytes=await readFile(resolve(out,name+'.png'));await copyFile(resolve(out,name+'.png'),resolve(evidence,name+'.png'));figures.push(`<figure><figcaption>${stage==='before'?'Before · installed main fbdf3ae0':'After · no empty section'}</figcaption><img src="data:image/png;base64,${bytes.toString('base64')}"></figure>`);}
  await page.setContent(`<style>body{margin:16px;background:${theme==='light'?'#eef2ef':'#151a17'};color:${theme==='light'?'#16241b':'#f1f3f1'};font:14px system-ui}main{display:flex;gap:16px}figure{margin:0;width:${width}px}img{width:100%}figcaption{margin-bottom:8px}</style><h2>Work details · ${theme} · ${device}</h2><p>Actual registered Home and drawer. An enabled empty Plan help section is hidden; saved problems and controls remain available.</p><main>${figures.join('')}</main>`);await page.screenshot({path:resolve(evidence,`${theme}-${device}-work-details-comparison.png`),fullPage:true});await page.close();
 }
 await writeFile(resolve(out,'results.json'),JSON.stringify(results,null,2));console.log(`${results.length} Work details screenshot regression cases passed.`);
}finally{await browser.close();server.close();}
