/** Aspect evidence using the established compiled-client/RPC harness, without renderer instrumentation. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../../..');
let scaffold = readFileSync(resolve(root, 'docs/deck-settings/render.mjs'), 'utf8').split('const browser = await chromium.launch')[0];
scaffold = scaffold.replace('const here = dirname(fileURLToPath(import.meta.url));', `const here = ${JSON.stringify(resolve(root, 'docs/deck-settings'))};`);
scaffold += `\nconst browser = await chromium.launch({channel:'msedge',headless:true,args:process.env.GHOST_LITE==='1'?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[]});
try { const {review} = await import(${JSON.stringify(pathToFileURL(resolve(here, 'acceptance.mjs')).href)}); await review(browser, 'http://127.0.0.1:'+http.address().port); }
finally { await browser.close(); http.close(); }\n`;
mkdirSync(resolve(here, '.generated'), {recursive:true});
const file = resolve(here, '.generated/render.mjs');
writeFileSync(file, scaffold);
await import(pathToFileURL(file));


