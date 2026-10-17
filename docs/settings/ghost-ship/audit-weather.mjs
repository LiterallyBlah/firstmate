/** Numeric registration/loop evidence; spatial acceptance still requires native-size renders. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodePng} from '../../../test/png.ts';
import {crop} from '../japanese-ship/build-art.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..'),dir=resolve(root,'art/settings/ghost-ship');
const out=resolve(root,process.env.GHOST_EVIDENCE??'.local/ghost-ship-fixes/integrated');mkdirSync(out,{recursive:true});
const m=JSON.parse(readFileSync(resolve(dir,'setting.json'))),checks=[];
const diff=(a,b)=>{let sum=0;for(let i=0;i<a.rgba.length;i++)sum+=Math.abs(a.rgba[i]-b.rgba[i]);return sum/a.rgba.length;};
for(const id of ['sea-far','sea-mid','sea-near','sea-deep','sea-storm-far','sea-storm-mid','sea-storm-near','sea-storm-deep']){
 const source=decodePng(readFileSync(resolve(dir,m.images[id].path))),height=id.endsWith('deep')?96:64,count=id.endsWith('deep')?8:16;
 assert.equal(source.width,384*8);assert.equal(source.height,height*count/8);
 const frames=Array.from({length:count},(_,i)=>crop(source,i%8*384,Math.floor(i/8)*height,384,height));
 const changes=frames.map((a,i)=>diff(a,frames[(i+1)%count]));
 // A small loop delta cannot certify invisible spatial tiling; record either problem.
 checks.push({id,count,cell:[384,height],stepMeanRgbaDifferences:changes,loopDifference:changes.at(-1),largestOrdinaryStep:Math.max(...changes.slice(0,-1))});
}
const surface=m.ambience.find(e=>e.id==='sea-surface').behaviour;
assert.deepEqual(surface.bands,[{slot:'back',fromRow:265},{slot:'front',fromRow:448}]);assert.equal(surface.origin,265);
assert.ok(!m.ambience.some(e=>/jellyfish|underwater|deep-water/.test(e.id)));
const coast=m.ambience.find(e=>e.id==='coast').behaviour,beam=m.ambience.find(e=>e.id==='lighthouse-beam').behaviour;
assert.deepEqual(coast.drift,beam.drift);
const payloadBytes=Object.values(m.images).reduce((n,image)=>n+readFileSync(resolve(dir,image.path)).length,0);
assert.ok(payloadBytes<=1000000);
writeFileSync(resolve(out,'weather-audit.json'),JSON.stringify({checks,payloadBytes,coastPeriodSeconds:1800/coast.drift.pxPerSecond,
 surface:{origin:surface.origin,bands:surface.bands},reviewRequired:'Inspect the deep field at native size in tall panes; numeric edge/loop bounds do not certify invisible repetition.'},null,2)+'\n');
console.log(JSON.stringify({atlases:checks.length,payloadBytes}));
