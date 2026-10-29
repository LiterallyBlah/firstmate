/** Summaries of the real component captures; no live home or product calls. */
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,mkdir} from 'node:fs/promises';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),out=resolve(root,'.local/smooth-pr2/ui');
const local=createRequire(resolve(root,'docs/board-list/package.json')),{chromium}=local('playwright');
const browser=await chromium.launch({...(process.platform==='win32'?{channel:'msedge'}:{}),headless:true});
const screens=['fresh-on','home','board','plans','details','problem-details','discussion-details','all-empty','settings-details'];
const img=async name=>`data:image/png;base64,${(await readFile(resolve(out,'screenshots',name+'.png'))).toString('base64')}`;
await mkdir(out,{recursive:true});
try{
 for(const theme of ['light','dark'])for(const device of ['desktop','phone']){
  const width=device==='desktop'?600:390,page=await browser.newPage({viewport:{width:width*2+48,height:1000}});
  const rows=[];
  for(const name of screens)rows.push(`<h2>${name}</h2><div class="pair"><figure><figcaption>Before · d74a30c</figcaption><img src="${await img(`${theme}-${device}-${name}-before`)}"></figure><figure><figcaption>After · PR 2</figcaption><img src="${await img(`${theme}-${device}-${name}-after`)}"></figure></div>`);
  await page.setContent(`<style>body{margin:16px;background:${theme==='light'?'#eef2ef':'#151a17'};color:${theme==='light'?'#16241b':'#f1f3f1'};font:14px system-ui}.pair{display:flex;gap:16px}figure{margin:0;width:${width}px}img{display:block;width:100%}h1{font-size:20px}h2{font-size:16px;margin:24px 0 8px}figcaption{margin-bottom:8px}</style><h1>FirstMate PR 2 · ${theme} · ${device}</h1><p>Actual components, synthetic home and reads. Before left; after right. Full captures in the CI artifact.</p>${rows.join('')}`);
  await page.screenshot({path:resolve(out,`${theme}-${device}-comparison.png`),fullPage:true});await page.close();
 }
 for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width:1218,height:1000}}),items=[];
  for(const name of ['fresh-on','details','problem-details'])items.push(`<figure><figcaption>${name} · 200% text</figcaption><img src="${await img(`${theme}-phone-${name}-after-text200`)}"></figure>`);
  await page.setContent(`<style>body{margin:12px;background:${theme==='light'?'#eef2ef':'#151a17'};color:${theme==='light'?'#16241b':'#f1f3f1'};font:14px system-ui}main{display:flex;gap:12px}figure{margin:0;width:390px}img{width:100%;display:block}figcaption{padding-bottom:12px}</style><h2>FirstMate PR 2 · ${theme} · 390px · 200% text</h2><main>${items.join('')}</main>`);
  await page.screenshot({path:resolve(out,`${theme}-phone-text200.png`),fullPage:true});await page.close();
 }
 const review=resolve(root,'.local/smooth-pr2/regressions');
 for(const theme of ['light','dark'])for(const device of ['desktop','phone']){
  const width=device==='desktop'?600:390,page=await browser.newPage({viewport:{width:width*2+48,height:1000}}),rows=[];
  for(const name of ['discuss','read-error','layout','problem-layout']){
   const pair=[];
   for(const stage of ['before','after'])pair.push(`<figure><figcaption>${stage==='before'?'Reviewed UI · 58f56fe':'Fixed'}</figcaption><img src="data:image/png;base64,${(await readFile(resolve(review,'screenshots',`${theme}-${device}-${name}-${stage}.png`))).toString('base64')}"></figure>`);
   rows.push(`<h2>${name}${name.includes('layout')?' · scrolled controls at 200% text':''}</h2><div class="pair">${pair.join('')}</div>`);
  }
  await page.setContent(`<style>body{margin:16px;background:${theme==='light'?'#eef2ef':'#151a17'};color:${theme==='light'?'#16241b':'#f1f3f1'};font:14px system-ui}.pair{display:flex;gap:16px}figure{margin:0;width:${width}px}img{display:block;width:100%}h1{font-size:20px}h2{font-size:16px;margin:24px 0 8px}figcaption{margin-bottom:8px}</style><h1>PR 169 · review fixes · ${theme} · ${device}</h1><p>Registered production Home and shell; synthetic read-only host data. Before left; fixed right.</p>${rows.join('')}`);
  await page.screenshot({path:resolve(out,`${theme}-${device}-review-fixes.png`),fullPage:true});await page.close();
 }
}finally{await browser.close();}
console.log('Ten screenshot summaries written to '+out);
