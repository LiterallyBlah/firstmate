/** Reviewable comparison sheets, with full-size original component captures retained alongside. */
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,mkdir,copyFile} from 'node:fs/promises';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),out=resolve(root,'.local/smooth-pr9/ui'),evidence=resolve(root,'docs/smooth-pr9/evidence');
const local=createRequire(resolve(root,'docs/board-list/package.json')),{chromium}=local('playwright');
const browser=await chromium.launch({...(process.platform==='win32'?{channel:'msedge'}:{}),headless:true});
await mkdir(evidence,{recursive:true});
const data=async name=>`data:image/png;base64,${(await readFile(resolve(out,'screenshots',name+'.png'))).toString('base64')}`;
try{
 for(const theme of ['light','dark'])for(const device of ['desktop','phone']){
  const width=device==='desktop'?720:390,page=await browser.newPage({viewport:{width:width*2+48,height:1000}});
  const figures=[];
  for(const stage of ['before','after']){
   const name=`${theme}-${device}-plans-${stage}`;figures.push(`<figure><figcaption>${stage==='before'?'Before · 9c3485e8':'After · optional contextual plan help'}</figcaption><img src="${await data(name)}"></figure>`);
   await copyFile(resolve(out,'screenshots',name+'.png'),resolve(evidence,name+'.png'));
  }
  const style=`<style>body{margin:16px;background:${theme==='light'?'#eef2ef':'#151a17'};color:${theme==='light'?'#16241b':'#f1f3f1'};font:14px system-ui}main{display:flex;gap:16px;margin:20px 0}figure{margin:0;width:${width}px}img{display:block;width:100%}figcaption{margin-bottom:8px}</style>`;
  await page.setContent(`${style}<h2>Plan help · ${theme} · ${device}</h2><p>Actual components; isolated host fixture. Viewing and canceling create nothing.</p><main>${figures.join('')}</main>`);await page.screenshot({path:resolve(evidence,`${theme}-${device}-comparison.png`),fullPage:true});
  const rows=[];
  for(const pair of [['review','confirm'],['prepared','committed'],['attach-review','held'],['invalid','invalid-text200']]){
   const cols=[];for(const name of pair)cols.push(`<figure><figcaption>${name}</figcaption><img src="${await data(`${theme}-${device}-${name}`)}"></figure>`);rows.push(`<main>${cols.join('')}</main>`);
  }
  await page.setContent(`${style}<h2>Plan help reviews · ${theme} · ${device}</h2><p>Actual controls, illustrative data. Handover never attaches; the captain's existing Attach review is a separate step.</p>${rows.join('')}`);await page.screenshot({path:resolve(evidence,`${theme}-${device}-reviews.png`),fullPage:true});await page.close();
 }
}finally{await browser.close();}
console.log('Saved all four theme/width before/after pairs and review sheets.');
