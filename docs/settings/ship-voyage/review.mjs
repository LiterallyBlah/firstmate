/** Reuse the established compiled-client host/RPC renderer without any Pixi instrumentation. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
let scaffold=readFileSync(resolve(root,'docs/deck-settings/render.mjs'),'utf8').split('const browser = await chromium.launch')[0];
scaffold=scaffold.replace('const here = dirname(fileURLToPath(import.meta.url));',`const here = ${JSON.stringify(resolve(root,'docs/deck-settings'))};`);
scaffold+=`\nconst browser=await chromium.launch({channel:'msedge',headless:true,...(process.env.VOYAGE_LITE==='1'?{args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}: {})});
try {const {review}=await import(${JSON.stringify(pathToFileURL(resolve(here,'check-scene.mjs')).href)});await review(browser,'http://127.0.0.1:'+http.address().port);} finally {await browser.close();http.close();}\n`;
mkdirSync(resolve(here,'.generated'),{recursive:true});
const path=resolve(here,'.generated/render.mjs');writeFileSync(path,scaffold);await import(pathToFileURL(path));
