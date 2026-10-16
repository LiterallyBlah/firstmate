/** Keep the approved island at world scale; only the empty sky/sea plate covers the viewport. */
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {crc32,deflateSync} from 'node:zlib';
import {blank,nearest,quant,encode} from '../../build-art.mjs';
import {decodePng} from '../../../../../test/png.ts';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../../../..'),out=resolve(root,'art/settings/japanese-ship');
export function indexed(a){
 const colours=[],ids=new Map(),raw=Buffer.alloc((a.width+1)*a.height);
 for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++){
  const i=(y*a.width+x)*4,c=[...a.rgba.subarray(i,i+4)],key=c.join(',');if(!ids.has(key)){ids.set(key,colours.length);colours.push(c);}raw[y*(a.width+1)+x+1]=ids.get(key);
 }
 if(colours.length>256)return encode(a);
 const chunk=(t,d)=>{const b=Buffer.alloc(d.length+12);b.writeUInt32BE(d.length);b.write(t,4);d.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,-4)),b.length-4);return b;};
 const head=Buffer.alloc(13);head.writeUInt32BE(a.width);head.writeUInt32BE(a.height,4);head.set([8,3],8);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('PLTE',Buffer.from(colours.flatMap(c=>c.slice(0,3)))),chunk('tRNS',Buffer.from(colours.map(c=>c[3]))),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
export function registerWorldCoast(p){
 const old=id=>decodePng(execFileSync('git',['show','500ac77:art/settings/japanese-ship/'+id+'.png'],{cwd:root,maxBuffer:3e6}));
 const save=(id,a)=>{const bytes=indexed(a);writeFileSync(resolve(out,id+'.png'),bytes);p.images[id]={path:id+'.png',size:[a.width,a.height],sha256:createHash('sha256').update(bytes).digest('hex')};};
 const day=old('coast'),source=nearest(decodePng(readFileSync(resolve(here,'sources/open-bay.png'))),600,400),byPhase={};
 for(const phase of ['dawn','morning','midday','afternoon','dusk','night']){
  const id=phase==='midday'?'coast':'coast-'+phase,reference=old(id),fill=blank(600,400);
  // Match the existing six phase palettes using corresponding original sky/sea pixels.
  const pairs=new Map();for(let y=0;y<400;y++)for(let x=0;x<140;x++){
   const i=(y*600+x)*4,key=[...day.rgba.subarray(i,i+3)].join(',');if(!pairs.has(key))pairs.set(key,{rgb:[...day.rgba.subarray(i,i+3)],sum:[0,0,0],n:0});const c=pairs.get(key);for(let k=0;k<3;k++)c.sum[k]+=reference.rgba[i+k];c.n++;
  }
  const colours=[...pairs.values()],memo=new Map();
  for(let i=0;i<fill.rgba.length;i+=4){
   const rgb=[...source.rgba.subarray(i,i+3)],key=rgb.join(',');let colour=memo.get(key);
   if(!colour){const nearest=colours.reduce((best,c)=>{const d=c.rgb.reduce((n,v,k)=>n+(v-rgb[k])**2,0);return d<best.d?{d,c}:best;},{d:Infinity});colour=nearest.c.sum.map((v,k)=>Math.max(0,Math.min(255,Math.round(rgb[k]+v/nearest.c.n-nearest.c.rgb[k]))));memo.set(key,colour);}
   fill.rgba.set([...colour,255],i);
  }
  quant(fill,32);save(id,fill);
  const original=old(id+'-front'),island=blank(1200,280);
  for(let y=0;y<280;y++)for(let x=0;x<1200;x++){
   const sx=x<600?x:1199-x,i=(y*600+sx)*4,j=(y*1200+x)*4;
   island.rgba.set(original.rgba.subarray(i,i+4),j);
   // The shore/reflections stay intact; water feathers into the independent fill.
   if(y>245)island.rgba[j+3]=Math.min(255,Math.round(island.rgba[j+3]*Math.max(0,(279-y)/34)/32)*32);
  }
  save(id+'-front',island);byPhase[phase]=[{image:id+'-front'}];
 }
 // At night the stars and moon are between the opaque base and this transparent sky.
 const night=decodePng(readFileSync(resolve(out,'coast-night.png')));for(let y=0;y<180;y++)night.rgba.fill(0,y*600*4,(y+1)*600*4);save('open-night-sea',night);
 p.ambience.find(e=>e.id==='coast').behaviour.phases.night='open-night-sea';
 const coast=p.ambience.find(e=>e.id==='coast-foreground');coast.behaviour={kind:'phase-strip',top:-30,span:[-4096,4608],frames:{sprites:byPhase.midday,frameMs:1000},byPhase,drift:{pxPerSecond:0}};
 // Phase strips have no intensity tint; a registered transparent weather matte keeps
 // this same world coastline storm-dark without shading the later spirit or ship.
 const land=decodePng(readFileSync(resolve(out,'coast-front.png'))),shade=blank(2400,280);
 for(let y=0;y<280;y++)for(let x=0;x<1200;x++){const alpha=land.rgba[(y*1200+x)*4+3];if(alpha)shade.rgba.set([32,52,76,alpha],(y*2400+x+1200)*4);}
 save('coast-storm-shade',shade);
 p.ambience.push({id:'coast-storm-shade',slot:'back',order:4.1,lite:'run',still:'hide',behaviour:{kind:'strip',top:-30,span:[-4096,4608],frames:{sprites:[{image:'coast-storm-shade',rect:[0,0,1200,280]}],frameMs:1000},drift:{pxPerSecond:0},variants:[{id:'storm',frames:[{image:'coast-storm-shade',rect:[1200,0,1200,280]}],blend:'over',opacity:[[.35,0],[1,.5]]}]}});
 if(!p.requires.includes('strip@1'))p.requires.push('strip@1');
 const spirit=p.ambience.find(e=>e.id==='umibozu');spirit.behaviour.at=[100,178];spirit.lite='hide';
}
