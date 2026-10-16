/** Established compiled-client/RPC render host; no Pixi internals. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../../..');
let scaffold=readFileSync(resolve(root,'docs/deck-settings/render.mjs'),'utf8').replaceAll('\r\n','\n').split('const browser = await chromium.launch')[0];
scaffold=scaffold.replace('const here = dirname(fileURLToPath(import.meta.url));',`const here = ${JSON.stringify(resolve(root,'docs/deck-settings'))};`);
scaffold=scaffold.replace('const pack = await server.readDeckSetting(input.id, at);','const pack = structuredClone(await server.readDeckSetting(input.id, at));');
// Review-only 60x voyage preview. All bound layers accelerate together; pose,
// weather and water clocks retain their shipped speed. Native evidence uses 1x.
scaffold=scaffold.replace('if (phaseStripReview) {\n      const directory',`if(process.env.COAST_PREVIEW==='60')for(const e of pack.manifest.ambience)if(e.behaviour.drift?.clock==='voyage')e.behaviour.drift.pxPerSecond=144;\n    if (phaseStripReview) {\n      const directory`);
scaffold+=`\ntry {const {review}=await import(${JSON.stringify(pathToFileURL(resolve(here,'review.mjs')).href)});await review(chromium,'http://127.0.0.1:'+http.address().port);}finally{http.close();}\n`;
mkdirSync(resolve(here,'.generated'),{recursive:true});const file=resolve(here,'.generated/render.mjs');writeFileSync(file,scaffold);await import(pathToFileURL(file));
