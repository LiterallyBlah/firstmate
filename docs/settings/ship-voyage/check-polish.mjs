/** Verify the follow-up stays confined to the approved sea, sky and storm brief. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodePng} from '../../../test/png.ts';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
const base='b1458b4f99a00a366ba008e8bdccab7b4aca7ac1';
const git=path=>execFileSync('git',['show',base+':'+path],{cwd:root,maxBuffer:8*1024*1024});
const old=JSON.parse(git('art/settings/ship/setting.json')),current=JSON.parse(readFileSync(resolve(root,'art/settings/ship/setting.json')));
const sha=b=>createHash('sha256').update(b).digest('hex');
const sections=['id','copy','stage','floor','zones','cast','portals','effects','attentionCarrier','dayCycle','atmosphere','palette'];
for(const key of sections)assert.deepEqual(current[key],old[key],key+' remains approved');
const revised=new Set(['sky','overcast','sea','sea-still','spindrift','weather-kraken','rain']);
const ambience=old.ambience.filter(e=>!revised.has(e.id));
for(const e of ambience)assert.deepEqual(current.ambience.find(n=>n.id===e.id),e,e.id+' behavior remains approved');
const changed=/^(sky-|moon$|sea-water-tile$|water-(sea|wake)-|storm-(sea|sky|spray|wake)-|enrichment-kraken)/;
const retained=Object.keys(old.images).filter(id=>!changed.test(id));
for(const id of retained){assert.deepEqual(current.images[id],old.images[id],id);assert.equal(sha(readFileSync(resolve(root,'art/settings/ship',current.images[id].path))),old.images[id].sha256,id+' bytes');}
// Padding must not silently rescale/repaint approved moon and stars.
for(const id of ['moon','sky-stars']){
 const before=decodePng(git('art/settings/ship/'+old.images[id].path));
 const after=decodePng(readFileSync(resolve(root,'art/settings/ship',current.images[id].path)));
 assert.equal(after.width,before.width);assert.ok(Buffer.from(after.rgba.subarray(0,before.rgba.length)).equals(before.rgba),id+' visible pixels');
 assert.ok(after.rgba.subarray(before.rgba.length).every(v=>v===0),id+' transparent padding');
}
const prohibited=execFileSync('git',['diff',base,'--name-only','--','client','server','shared','test/fixtures/ship-baseline','test/fixtures/ship-baseline.json','docs/deck-settings/expected-changes.json'],{cwd:root,encoding:'utf8'}).trim();
assert.equal(prohibited,'','no production engine or baseline edits');
const report={base,manifestSha256:sha(readFileSync(resolve(root,'art/settings/ship/setting.json'))),unchangedSections:sections,unchangedAmbience:ambience.map(e=>e.id),unchangedImages:retained,moonAndStarsVisiblePixels:'identical; transparent canvas padding only',engineAndFrozenBaseline:'unchanged'};
writeFileSync(resolve(here,'polish-preservation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({sections:sections.length,ambience:ambience.length,images:retained.length,passed:true}));
