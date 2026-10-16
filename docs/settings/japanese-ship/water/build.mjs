/** Offline registration of generated water/star art. No runtime or engine changes. */
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {crc32,deflateSync} from 'node:zlib';
import {blank,nearest,quant,encode,paste} from '../build-art.mjs';
import {decodePng} from '../../../../test/png.ts';
import {registerWorldCoast} from './anchor/register.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../../..'),out=resolve(root,'art/settings/japanese-ship');
// Pinned input keeps rebuilding independent of concurrent upstream pack work.
const baseline='b1458b4';
const p=JSON.parse(execFileSync('git',['show',baseline+':art/settings/japanese-ship/setting.json'],{cwd:root}));
const sha=b=>createHash('sha256').update(b).digest('hex');
const source=name=>decodePng(readFileSync(resolve(here,'sources',name+'.png')));
function indexed(a){
  const colours=[],ids=new Map(),raw=Buffer.alloc((a.width+1)*a.height);
  for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++){
    const c=[...a.rgba.subarray((y*a.width+x)*4,(y*a.width+x)*4+4)],key=c.join(',');
    if(!ids.has(key)){ids.set(key,colours.length);colours.push(c);}
    raw[y*(a.width+1)+x+1]=ids.get(key);
  }
  if(colours.length>256)return encode(a);
  const chunk=(type,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,-4)),b.length-4);return b;};
  const head=Buffer.alloc(13);head.writeUInt32BE(a.width);head.writeUInt32BE(a.height,4);head.set([8,3],8);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('PLTE',Buffer.from(colours.flatMap(c=>c.slice(0,3)))),chunk('tRNS',Buffer.from(colours.map(c=>c[3]))),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
function save(name,a){const b=indexed(a);writeFileSync(resolve(out,name+'.png'),b);p.images[name]={path:name+'.png',size:[a.width,a.height],sha256:sha(b)};return a;}
const original=quant(nearest(source('swell'),384,128),12);
const rgb=hex=>hex.match(/../g).map(v=>parseInt(v,16));
const palettes={dawn:['273954','788D9D'],morning:['175D77','70B9C1'],midday:['14576F','89C8CC'],afternoon:['27586F','9DBAC3'],dusk:['343852','B397AE'],night:['081C37','427295']};
const count=6;
// Generated shapes stay registered across the cyclic displacement; palette mapping and
// edge overlaps make a genuine repeating texture instead of duplicating its last row.
function texture(w,h){
  const ox=24,oy=8,a=nearest(original,w+ox,h+oy),b=blank(w,h);
  const luma=(x,y)=>{const i=(y*a.width+x)*4;return a.rgba[i]*.21+a.rgba[i+1]*.72+a.rgba[i+2]*.07;};
  const horizontal=(x,y)=>x<ox?luma(x+w,y)*(1-x/(ox-1))+luma(x,y)*x/(ox-1):luma(x,y);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const value=y<oy?horizontal(x,y+h)*(1-y/(oy-1))+horizontal(x,y)*y/(oy-1):horizontal(x,y);
    const n=Math.max(0,Math.min(1,(value-55)/120));
    const i=(y*w+x)*4;b.rgba.set([Math.round(n*255),0,0,255],i);
  }
  return b;
}
function atlas(w,h,phase,fade=false,storm=false){
  const mask=texture(w,h),a=blank(w*count,h),[lo,hi]=palettes[phase].map(rgb);
  for(let f=0;f<count;f++)for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const t=f/count*Math.PI*2;
    const sx=(x+Math.round(2*Math.sin(t+y/h*2*Math.PI))+w)%w;
    const sy=(y+Math.round(Math.sin(t+x/w*4*Math.PI))+h)%h;
    const n=Math.round(mask.rgba[(sy*w+sx)*4]/255*7)/7;
    const edge=fade?Math.min(1,y/10,(h-1-y)/12):1;
    const alpha=Math.round((storm?12+135*n:fade?24+100*n:Math.max(0,n-.2)*100)*edge/16)*16;
    const col=lo.map((c,i)=>Math.round(c+(hi[i]-c)*n));
    a.rgba.set([...col,alpha],(y*a.width+f*w+x)*4);
  }
  return a;
}
const frames=(id,w,h)=>Array.from({length:count},(_,f)=>({image:id,rect:[f*w,0,w,h]}));
p.ambience=p.ambience.filter(e=>e.id!=='sea-ripples');
for(const [name,w,h,top,speed,order]of [['far',256,32,212,.55,5],['mid',256,64,232,1.35,5.1]]){
  const byPhase={};
  for(const phase of ['midday','dusk','night']){const id='bay-'+name+'-'+phase;save(id,atlas(w,h,phase,true));byPhase[phase]=frames(id,w,h);}
  byPhase.dawn=byPhase.dusk;byPhase.morning=byPhase.midday;byPhase.afternoon=byPhase.midday;
  for(const phase of ['dawn','morning','afternoon'])try{unlinkSync(resolve(out,'bay-'+name+'-'+phase+'.png'));}catch(e){if(e.code!=='ENOENT')throw e;}
  p.ambience.push({id:'bay-'+name,slot:'back',order,lite:'run',still:'first-frame',behaviour:{kind:'phase-strip',frames:{sprites:byPhase.midday,frameMs:320,clock:'water'},byPhase,top,span:[-4096,4608],drift:{pxPerSecond:speed,clock:'water'}}});
}
// Transparent near swells let the existing six-phase sea colour show through, and tile
// to the visible bottom in both slots. The front is cropped on the same origin.
save('bay-near',atlas(384,96,'midday'));save('bay-near-storm',atlas(384,96,'night',false,true));
p.ambience.push({id:'bay-near',slot:'back',order:5.2,lite:'run',still:'first-frame',behaviour:{kind:'tile',frames:{sprites:frames('bay-near',384,96),frameMs:320,clock:'water'},drift:{pxPerSecond:2.7,clock:'water'},origin:276,bands:[{slot:'back',fromRow:276},{slot:'front',fromRow:290}],variants:[{id:'rough',frames:frames('bay-near-storm',384,96),blend:'crossfade',opacity:[[.35,0],[1,1]]}]}});
// A full backdrop-sized field uses the same horizon placement as the coast. That
// placement covers the visible top and sides at every aspect, with no world-row cap.
const star=nearest(source('stars'),600,400),field=blank(600,400);
for(let y=0;y<180;y++)for(let x=0;x<600;x++){
  const i=(y*600+x)*4,n=Math.max(star.rgba[i],star.rgba[i+1],star.rgba[i+2]);
  if(n>80){const v=Math.round(n/32)*32;field.rgba.set([Math.min(235,v),Math.min(240,v+8),Math.min(250,v+24),Math.min(220,Math.round((n-65)/32)*32)],i);}
}
save('bay-stars',field);
p.ambience.push({id:'bay-stars',slot:'back',order:-1.5,lite:'run',still:'first-frame',behaviour:{kind:'overlay',image:'bay-stars',space:'coast',alpha:'night',hiddenBy:['overcast']}});
// Replace the two dense clusters with sparse bright twinkles, leaving the field's
// faint stars fixed. Their existing behind-coast placement preserves day fades.
for(const [id,dim]of [['stars',false],['stars-dim',true]]){
  const a=blank(96,64);
  const bright=[];
  for(let y=3;y<177;y++)for(let x=3;x<597;x++){const i=(y*600+x)*4;if(field.rgba[i]>180&&field.rgba[i+3]>150&&bright.every(([sx,sy])=>Math.hypot(x-sx,y-sy)>70))bright.push([x,y]);}
  for(const [j,[dx,dy]]of [[10,12],[70,38],[40,54]].entries())for(let y=0;y<5;y++)for(let x=0;x<5;x++){
    const [sx,sy]=bright[j].map(v=>v-2);
    const si=((sy+y)*600+sx+x)*4,di=((dy+y)*96+dx+x)*4;
    if(field.rgba[si+3]>0)a.rgba.set([...field.rgba.subarray(si,si+3),Math.round(field.rgba[si+3]*(dim?.45:1))],di);
  }
  save(id,a);
}
delete p.images.ripples;try{unlinkSync(resolve(out,'ripples.png'));}catch(e){if(e.code!=='ENOENT')throw e;}
// The old rise variant multiplied two weather fades (15% body at intensity .9).
// Register sinking crops from the existing opaque dome, clipped at its waterline.
const spirit=decodePng(readFileSync(resolve(out,'umibozu.png'))),sink=blank(72*3,80);
for(let f=0;f<2;f++)for(let y=0;y<78;y++)for(let x=0;x<72;x++){
  const dy=y+(f+1)*8;if(dy>=78)continue;
  sink.rgba.set(spirit.rgba.subarray((y*spirit.width+x)*4,(y*spirit.width+x)*4+4),(dy*sink.width+f*72+x)*4);
}
save('umibozu-sink',sink);
const spiritElement=p.ambience.find(e=>e.id==='umibozu');
spiritElement.lite='hide';
const pose=i=>({image:'umibozu',rect:[i*72,0,72,80]}),submerge=i=>({image:'umibozu-sink',rect:[i*72,0,72,80]});
spiritElement.behaviour.frames={sprites:[pose(2),pose(2),pose(3),pose(1),pose(0),submerge(0),submerge(1),submerge(2),submerge(2),submerge(1),submerge(0),pose(0),pose(1),pose(3),pose(2)],frameMs:500,clock:'swell'};
// A near-step reveal, below the first attainable storm target (19/24). No stable
// crew intensity lies inside this interval, so the body cannot hang half-faded.
spiritElement.behaviour.opacity={curve:[[.78,0],[.780001,1]]};
delete spiritElement.behaviour.variants;
registerWorldCoast(p);
p.requires=[...new Set([...p.requires,'phase-strip@1'])].sort();p.version='1.1.0';
writeFileSync(resolve(out,'setting.json'),JSON.stringify(p,null,2)+'\n');
writeFileSync(resolve(here,'registration.json'),JSON.stringify({baseline,sourceHashes:Object.fromEntries(['swell','stars'].map(n=>[n,sha(readFileSync(resolve(here,'sources',n+'.png')))])),imageBytes:Object.values(p.images).reduce((n,i)=>n+readFileSync(resolve(out,i.path)).length,0)},null,2)+'\n');
