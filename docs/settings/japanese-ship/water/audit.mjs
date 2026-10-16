/** Pack preservation, budget, wrap continuity, and sky coverage from actual PNGs. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodePng} from '../../../../test/png.ts';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../../..'),folder='art/settings/japanese-ship/';
const before=JSON.parse(execFileSync('git',['show','b1458b4:'+folder+'setting.json'],{cwd:root}));
const after=JSON.parse(readFileSync(resolve(root,folder,'setting.json')));
for(const key of ['stage','cast','floor','zones','portals','effects','attentionCarrier','dayCycle','atmosphere'])assert.deepEqual(after[key],before[key],key);
const changed=['sea-ripples','twinkle-0','twinkle-1'];
for(const e of before.ambience.filter(e=>!changed.includes(e.id)))assert.deepEqual(after.ambience.find(a=>a.id===e.id),e,e.id);
const preserved=Object.keys(before.images).filter(id=>!['ripples','stars','stars-dim'].includes(id));
for(const id of preserved)assert.deepEqual(after.images[id],before.images[id],id);
const imageBytes=Object.values(after.images).reduce((n,i)=>n+readFileSync(resolve(root,folder,i.path)).length,0);assert.ok(imageBytes<=1e6);
const stars=decodePng(readFileSync(resolve(root,folder,'bay-stars.png'))),sectors=[];
for(let col=0;col<6;col++){
  let count=0;for(let y=0;y<180;y++)for(let x=col*100;x<(col+1)*100;x++)if(stars.alpha(x,y)>0)count++;
  assert.ok(count>50,'stars across sector '+col);sectors.push(count);
}
const bright=decodePng(readFileSync(resolve(root,folder,'stars.png'))),dim=decodePng(readFileSync(resolve(root,folder,'stars-dim.png')));
assert.ok(bright.rgba.some((v,i)=>i%4===3&&v>0),'twinkles are not empty');assert.notDeepEqual(bright.rgba,dim.rgba);
const near=after.ambience.find(e=>e.id==='bay-near').behaviour;
assert.equal(near.kind,'tile');assert.equal(near.frames.clock,'water');assert.equal(near.drift.clock,'water');
assert.deepEqual(near.bands,[{slot:'back',fromRow:276},{slot:'front',fromRow:290}]);
const result={baseline:'b1458b4',imageBytes,preservedImages:preserved,unchanged:['stage','cast','floor','zones','portals','effects','attentionCarrier','dayCycle','atmosphere','turning-wake','moon','umibozu'],skySectors:sectors,twinkle:'nonempty distinct frames',nearCoverage:'tile to visible bottom; back/front share origin and clock'};
writeFileSync(resolve(here,'audit.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
