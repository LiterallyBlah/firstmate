/** Wrap checks complement, rather than replace, the three real-pane visual reviews. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {decodePng} from '../../../test/png.ts';
import {blank,crop,paste,encode} from '../japanese-ship/build-art.mjs';
const dir='art/settings/ghost-ship/',docs='docs/settings/ghost-ship/';
const m=JSON.parse(readFileSync(dir+'setting.json')),read=id=>decodePng(readFileSync(dir+m.images[id].path));
const pixel=(a,x,y)=>a.rgba.subarray((y*a.width+x)*4,(y*a.width+x)*4+4);
function difference(a,axis,p,q){let sum=0;const n=axis?a.width:a.height;for(let i=0;i<n;i++){const x=pixel(a,axis?i:p,axis?p:i),y=pixel(a,axis?i:q,axis?q:i);for(let c=0;c<4;c++)sum+=Math.abs(x[c]-y[c]);}return sum/(n*4);}
const checks=[];
for(const id of ['storm-fog','storm-sky-overcast','storm-water-0','storm-water-1','storm-water-2']){
 for(let k=0;k<(id.startsWith('storm-water')?4:1);k++){
  const src=read(id),a=id.startsWith('storm-water')?crop(src,k*3,0,384,64):src,axes=[];
  for(const axis of [0,1]){const n=axis?a.height:a.width,interior=Array.from({length:n-1},(_,i)=>difference(a,axis,i,i+1)).sort((a,b)=>a-b),wrap=difference(a,axis,0,n-1),p95=interior[Math.floor(interior.length*.95)];assert.ok(wrap<=interior.at(-1)+.001,`${id} frame ${k} axis ${axis}: seam exceeds normal texture contrast`);axes.push({axis:axis?'vertical':'horizontal',wrapMeanDifference:wrap,interiorP95:p95,interiorMaximum:interior.at(-1)});}
  checks.push({id,frame:k,axes});
  if(k===0&&id!=='storm-sky-overcast'){
   const tile=blank(a.width*2,a.height*2);for(let y=0;y<2;y++)for(let x=0;x<2;x++)paste(tile,a,x*a.width,y*a.height);
   if(id==='storm-fog')for(let i=0;i<tile.rgba.length;i+=4){const alpha=tile.rgba[i+3]/255;for(let c=0;c<3;c++)tile.rgba[i+c]=Math.round(tile.rgba[i+c]*alpha+[4,29,39][c]*(1-alpha));tile.rgba[i+3]=255;}
   writeFileSync(docs+'review/'+id+'-wrap.png',encode(tile));
  }
 }
}
// Widening the calm frame changes only registration, never its rendered pixels.
for(let b=0;b<3;b++)for(let k=0;k<4;k++){const id=`water-${b}-0-${k}`,old=decodePng(execFileSync('git',['show',`e164608:${dir}${id}.png`])),a=read(id);for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++)assert.deepEqual(pixel(a,x,y),pixel(old,x%old.width,y));}
const coast=m.ambience.find(x=>x.id==='coast').behaviour,beam=m.ambience.find(x=>x.id==='lighthouse-beam').behaviour;
assert.equal(m.images[coast.frames.sprites[0].image].size[0]/coast.drift.pxPerSecond,1200);assert.deepEqual(coast.drift,beam.drift);
for(const jelly of m.ambience.filter(x=>x.id.startsWith('jellyfish-'))){assert.equal(jelly.lite,'run');assert.equal(jelly.still,'first-frame');}
writeFileSync(docs+'weather-audit.json',JSON.stringify({checks,calmPixelsUnchanged:true,coastWidth:1800,coastPeriodSeconds:1200,jellyfish:'four submerged, run in full/lite, rest visible in still'},null,2)+'\n');
console.log(JSON.stringify({wrapFrames:checks.length,calmPixelsUnchanged:true}));
