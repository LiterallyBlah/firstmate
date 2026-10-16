/** Pixel evidence from captured PNGs, never renderer state. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {decodePng} from '../../../../test/png.ts';
import {blank,encode} from '../build-art.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../../..');
const hash=b=>createHash('sha256').update(b).digest('hex');
const reasons={day:'Lookout/perch with ladder behind sail, three chochin, six crew looks, horizontal bow plank, petals and spaced sleepers; approved hull, island, sail, rig and carrier retained.',dusk:'Six-phase dusk palette and phase tint replace the old two-phase interpolation; horizontal bow plank and ladder occluded by sail; new furniture and crew.',night:'Night moon and two star twinkle fields; paper lanterns; lookout, hidden middle ladder, horizontal bow plank and six crew looks. Approved night coast retained.',storm:'Overcast, rain/spray and peak umibozu alongside approved sail/rig/water motion; a 24-worker crowd, horizontal bow plank and ladder behind sail.'};
const changes={base:'47e305d',shots:{}};
for(const name of Object.keys(reasons)){
  const a=readFileSync(join(here,'review/before',name+'.png')),b=readFileSync(join(here,'review/after',name+'.png'));
  const before=decodePng(a),after=decodePng(b);assert.equal(before.width,after.width);assert.equal(before.height,after.height);
  const diff=blank(after.width,after.height);let pixels=0;
  for(let i=0;i<before.rgba.length;i+=4){const changed=[0,1,2,3].some(c=>before.rgba[i+c]!==after.rgba[i+c]);if(changed){pixels++;diff.rgba.set([255,40,60,255],i);}else diff.rgba.set([after.rgba[i]>>2,after.rgba[i+1]>>2,after.rgba[i+2]>>2,255],i);}
  writeFileSync(join(here,'review/after',name+'-difference.png'),encode(diff));
  changes.shots[name]={main:hash(a),branch:hash(b),differingPixels:pixels,reason:reasons[name]};
}
writeFileSync(join(here,'expected-changes.json'),JSON.stringify(changes,null,2)+'\n');
// Still comparisons must reproduce exactly. Record the moving storm separately: an
// asynchronous fleet refresh can select a neighbouring rain/water animation frame.
const repeated={};
for(const name of Object.keys(reasons)){
  const a=readFileSync(join(here,'review/after',name+'.png')),b=readFileSync(join(here,'review/repeat',name+'.png'));
  const x=decodePng(a),y=decodePng(b);assert.equal(x.width,y.width);assert.equal(x.height,y.height);
  let differingPixels=0;for(let i=0;i<x.rgba.length;i+=4)if([0,1,2,3].some(c=>x.rgba[i+c]!==y.rgba[i+c]))differingPixels++;
  const identical=a.equals(b);if(name!=='storm')assert.ok(identical,name+' independently reproduces');
  repeated[name]={sha256:hash(a),repeatSha256:hash(b),identical,differingPixels,...(name==='storm'?{motion:'full',note:'Both captures reach intensity 1.00; rain/water frame timing can differ across asynchronous fleet refreshes. This is not a Ship gate exception.'}:{})};
}
writeFileSync(join(here,'review/repeat/verified.json'),JSON.stringify(repeated,null,2)+'\n');
const shots=[0,4,8,12,16].map(i=>decodePng(readFileSync(join(here,'review/after/night-motion-'+String(i).padStart(3,'0')+'.png'))));
// Same public fit arithmetic as the authoring overlay, in screenshot pixels (DPR 2).
const scale=Math.min(shots[0].width/480,shots[0].height/320)*.94;
const fit={scale,x:Math.round((shots[0].width-480*scale)/2),y:Math.round((shots[0].height-320*scale)/2)};
const rgb=(a,x,y)=>{const i=(Math.floor(fit.y+y*fit.scale)*a.width+Math.floor(fit.x+x*fit.scale))*4;return [...a.rgba.subarray(i,i+3)].join(',');};
const stars=decodePng(readFileSync(join(root,'art/settings/japanese-ship/stars.png'))),dim=decodePng(readFileSync(join(root,'art/settings/japanese-ship/stars-dim.png')));
const twinkling=[];
for(let y=0;y<stars.height;y++)for(let x=0;x<stars.width;x++){
  const i=(y*stars.width+x)*4;if(stars.rgba[i+3]!==255)continue;
  const bright=[...stars.rgba.subarray(i,i+3)].join(','),dark=[...dim.rgba.subarray(i,i+3)].join(',');
  const observed=shots.map(a=>rgb(a,20+x+.5,12+y+.5));
  if(observed.includes(bright)&&observed.includes(dark))twinkling.push({pixel:[x,y],observed});
}
assert.ok(twinkling.length>5,'registered star pixels actually alternate bright and dim in the real night render');
const lantern=shots.map(a=>rgb(a,125.5,223.5));
assert.ok(new Set(lantern).size>1,'the centre of the lantern glass actually changes colour at night');
writeFileSync(join(here,'review/after/night-pixels.json'),JSON.stringify({fit,twinklingPixelCount:twinkling.length,samples:twinkling.slice(0,8),lanternGlass:lantern},null,2)+'\n');
console.log(JSON.stringify({twinklingPixelCount:twinkling.length,lanternGlassColours:new Set(lantern).size,reviewed:Object.keys(changes.shots)}));
