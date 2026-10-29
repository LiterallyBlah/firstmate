/** Compose actual-RPC captures; both stages use the same disposable production backend. */
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readFile,mkdir,copyFile} from 'node:fs/promises';
const root=process.cwd(),out=resolve(root,'.local/smooth-pr9/production'),evidence=resolve(root,'docs/smooth-pr9/evidence');
const local=createRequire(resolve(root,'docs/board-list/package.json')),{chromium}=local('playwright');
const browser=await chromium.launch({...(process.platform==='win32'?{channel:'msedge'}:{}),headless:true});await mkdir(evidence,{recursive:true});
try{for(const theme of ['light','dark'])for(const device of ['desktop','phone']){
 const width=device==='desktop'?720:390,page=await browser.newPage({viewport:{width:width*2+48,height:1000}}),rows=[];
 for(const kind of ['review','evidence']){const figures=[];
  for(const stage of ['before','after']){const name=`${theme}-${device}-${kind}-${stage}`,bytes=await readFile(resolve(out,name+'.png'));
   figures.push(`<figure><figcaption>${stage==='before'?'Before · fe5c65b3':'After · actual server contracts'} · ${kind}</figcaption><img src="data:image/png;base64,${bytes.toString('base64')}"></figure>`);
   await copyFile(resolve(out,name+'.png'),resolve(evidence,`${theme}-${device}-rpc-${kind}-${stage}.png`));
  }rows.push(`<main>${figures.join('')}</main>`);
 }
 await page.setContent(`<style>body{margin:16px;background:${theme==='light'?'#eef2ef':'#151a17'};color:${theme==='light'?'#16241b':'#f1f3f1'};font:14px system-ui}main{display:flex;gap:16px;margin:20px 0}figure{margin:0;width:${width}px}img{display:block;width:100%}figcaption{margin-bottom:8px}</style><h2>PR 175 corrections · ${theme} · ${device}</h2><p>Actual registered RPCs and distinct workflow/supervision home IDs. Adapted native host primitives only. Viewing, evidence selection and cancel cause no handover or Attach.</p>${rows.join('')}`);
 await page.screenshot({path:resolve(evidence,`${theme}-${device}-rpc-comparison.png`),fullPage:true});await page.close();
}}finally{await browser.close();}
console.log('Four actual-RPC before/after comparison sheets saved.');
