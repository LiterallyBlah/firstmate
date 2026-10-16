import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../../..');
let scaffold=readFileSync(resolve(root,'docs/deck-settings/render.mjs'),'utf8').split('const browser = await chromium.launch')[0];
scaffold=scaffold.replace('const here = dirname(fileURLToPath(import.meta.url));',`const here = ${JSON.stringify(resolve(root,'docs/deck-settings'))};`);
if(process.env.EDGE_REVIEW==='before'){process.env.SHARK_REVIEW='before';process.env.SAKURA_PARITY='before';}
scaffold+=`\nconst browser=await chromium.launch({channel:'msedge',headless:true});try{const {review}=await import(${JSON.stringify(pathToFileURL(resolve(here,'serpent-check.mjs')).href)});await review(browser,'http://127.0.0.1:'+http.address().port);}finally{await browser.close();http.close();}`;
mkdirSync(resolve(here,'.generated'),{recursive:true});const file=resolve(here,'.generated/render.mjs');writeFileSync(file,scaffold);await import(pathToFileURL(file));
