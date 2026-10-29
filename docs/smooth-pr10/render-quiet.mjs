/** Existing data stays still during a real pending Query refresh. Synthetic host only. */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const here=dirname(fileURLToPath(import.meta.url)), root=resolve(here,'../..'), out=resolve(root,'.local/smooth-pr10/quiet'), baseline='fbdf3ae0';
const repo=createRequire(resolve(root,'package.json')), local=createRequire(resolve(root,'docs/board-list/package.json'));
const {build}=local('esbuild'), {chromium}=local('playwright');
const affected=new Set(['needs-you-state.ts','needs-you.tsx','deck-decisions.ts','decision-drawer.tsx','decision-raised-card.tsx','decision-raised.ts','task-list.tsx','task-board.tsx','header-actions.tsx','work-details.tsx']);
await mkdir(out,{recursive:true});
for(const stage of ['before','after']) await build({entryPoints:[resolve(here,'panel.jsx')],outfile:resolve(out,stage+'.js'),bundle:true,jsx:'automatic',logLevel:'warning',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'quiet-fixture',setup(b){
  b.onResolve({filter:/^@getpaseo\/plugin$/},()=>({path:resolve(root,'docs/board-list/contracts.js')}));
  b.onResolve({filter:/^@getpaseo\/plugin\//},()=>({path:resolve(here,'stubs.jsx')}));
  b.onResolve({filter:/^react($|\/)/},a=>({path:repo.resolve(a.path)}));
  b.onResolve({filter:/^react-dom($|\/)/},a=>({path:local.resolve(a.path)}));
  b.onResolve({filter:/^react-native($|-web$)/},()=>({path:local.resolve('react-native-web')}));
  b.onResolve({filter:/^lucide-react$/},()=>({path:local.resolve('lucide-react')}));
  if(stage==='before') b.onLoad({filter:/[\\/]client[\\/][^\\/]+[.]tsx?$/},a=>{const name=a.path.replaceAll('\\','/').split('/').at(-1); if(!affected.has(name))return; return{contents:execFileSync('git',['show',`${baseline}:client/${name}`],{cwd:root,encoding:'utf8'}),loader:'tsx'};});
}}]});
const server=createServer(async(req,res)=>{const stage=req.url.includes('before')?'before':'after';res.setHeader('Content-Type',req.url.endsWith('.js')?'application/javascript':'text/html');res.end(req.url.endsWith('.js')?await readFile(resolve(out,stage+'.js')):`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;font-family:system-ui}*{box-sizing:border-box}button,input,select{font:inherit}:focus-visible{outline:2px solid currentColor;outline-offset:2px}</style><div id="root"></div><script src="/${stage}.js"></script>`);});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({...process.platform==='win32'?{channel:'msedge'}:{},headless:true}),results=[];
const fingerprint=el=>{const style=getComputedStyle(el);return{text:el.innerText,border:style.borderStyle,background:style.backgroundColor,icon:el.querySelector('svg')?.getAttribute('class')};};
try{
  for(const stage of ['before','after']) for(const theme of ['light','dark']) for(const[device,width,height]of[['desktop',1440,1000],['phone',390,844]]) for(const mode of ['background','failed','stale']){
    const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.clock.install({time:new Date('2026-10-29T18:13:00Z')});
    await page.goto(`http://127.0.0.1:${server.address().port}/?`+new URLSearchParams({stage,theme,surface:'list',home:'upgraded',features:'off','quiet-refresh':mode}),{waitUntil:'networkidle'});
    await page.waitForFunction(()=>window.review.cache.getQueryData(['firstmate','needs-you'])?.actionCount===7);
    await page.waitForFunction(()=>document.querySelector('[id^="needs-you-"]')?.textContent.includes('Needs you · 7'));
    const indicator=page.locator('[id^="needs-you-"]').first(), heading=page.getByTestId('task-group-needs-you').getByRole('heading');
    await heading.waitFor();const initial=await indicator.evaluate(fingerprint),initialHeading=await heading.innerText();
    await page.evaluate(()=>{void window.review.cache.refetchQueries({queryKey:['firstmate','needs-you'],exact:true},{cancelRefetch:false});});
    await page.waitForFunction(mode=>{const state=window.review.cache.getQueryState(['firstmate','needs-you']);return mode==='background'?state?.fetchStatus==='fetching':mode==='failed'?state?.status==='error':state?.data?.freshness.status==='stale';},mode);
    if(stage==='before'||mode!=='background')await page.waitForFunction(({stage,mode})=>document.querySelector('[id^="needs-you-"]')?.textContent.includes(stage==='after'?'Last updated':mode==='failed'?'offline':mode==='stale'?'as of':'Updating'),{stage,mode});
    const key=`${stage}-${theme}-${device}-${mode}`,text=await page.locator('body').innerText();
    if(mode==='background'){
      assert.equal(await page.evaluate(()=>window.review.cache.getQueryState(['firstmate','needs-you']).status),'success','pending refresh retains successful data');
      if(stage==='before'){assert.match(await indicator.innerText(),/Updating/);assert.match(await heading.innerText(),/as of/);}
      else{assert.deepEqual(await indicator.evaluate(fingerprint),initial,'header count/icon/style stay still');assert.equal(await heading.innerText(),initialHeading);assert.doesNotMatch(text,/Updating|as of \d\d:\d\d|Last updated/);}
    }else if(stage==='after'){
      assert.match(await indicator.innerText(),/Last updated 18:10/);assert.match(await page.getByTestId('task-group-needs-you').innerText(),/Last updated 18:10/);
      assert.doesNotMatch(text,/Updating|as of \d\d:\d\d/);
      const muted=await page.getByTestId('task-group-needs-you').getByText('Last updated 18:10',{exact:true}).evaluate(el=>getComputedStyle(el).color);
      const expectedMuted=await page.evaluate(()=>{const el=document.createElement('span');el.style.color=window.fixtureTheme.colors.foregroundMuted;return el.style.color;});
      assert.equal(muted,expectedMuted,'stale timestamp uses the muted theme token');
    }
    assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.equal(await page.evaluate(()=>window.review.calls.filter(c=>/admit-ui|attach|provision|[.]set$|[.]admin$/.test(c.name)).length),0);
    await page.screenshot({path:resolve(out,key+'.png')});results.push({key,text});
    if(stage==='after'&&mode==='failed'){await indicator.click();await page.getByRole('button',{name:'Try again',exact:true}).waitFor();}
    await page.close();console.log(key);
  }
  for(const theme of ['light','dark'])for(const device of ['desktop','phone']){
    const width=device==='desktop'?600:390,page=await browser.newPage({viewport:{width:width*2+48,height:1000}}),rows=[];
    for(const mode of ['background','failed','stale']){const images=await Promise.all(['before','after'].map(async stage=>`<figure><figcaption>${stage==='before'?'Before · installed main fbdf3ae0':'After · silent background reads'}</figcaption><img src="data:image/png;base64,${(await readFile(resolve(out,`${stage}-${theme}-${device}-${mode}.png`))).toString('base64')}"></figure>`));rows.push(`<h2>${mode}</h2><div class="pair">${images.join('')}</div>`);}
    await page.setContent(`<style>body{margin:16px;background:${theme==='light'?'#eef2ef':'#151a17'};color:${theme==='light'?'#16241b':'#f1f3f1'};font:14px system-ui}.pair{display:flex;gap:16px}figure{margin:0;width:${width}px}img{display:block;width:100%}h2{font-size:16px}</style><h1>Needs you · header and List heading · ${theme} · ${device}</h1><p>Actual FleetSurface and a real pending/failed/source-stale Query refresh. Synthetic host; no live effects.</p>${rows.join('')}`);
    await page.screenshot({path:resolve(out,`${theme}-${device}-comparison.png`),fullPage:true});await page.close();
  }
  await writeFile(resolve(out,'results.json'),JSON.stringify({passed:true,baseline,captures:24,results},null,2));console.log(JSON.stringify({passed:true,captures:24,out}));
}finally{await browser.close();await new Promise(done=>server.close(done));}
