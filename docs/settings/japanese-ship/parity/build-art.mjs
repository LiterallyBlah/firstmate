/** Offline registration of generated parity sprites. Uses the pack's established pixel/alpha pipeline. */
import {readFileSync,writeFileSync,unlinkSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {decodePng} from '../../../../test/png.ts';
import {blank,crop,nearest,bounds,paste,quant,encode} from '../build-art.mjs';
const here=dirname(fileURLToPath(import.meta.url)),out=resolve(here,'../../../../art/settings/japanese-ship');
const registration={images:{},lanes:{},sources:{}};
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=name=>decodePng(readFileSync(resolve(out,name+'.png')));
const source=name=>{const b=readFileSync(resolve(here,'sources',name+'.png'));registration.sources[name]=sha(b);return decodePng(b);};
function save(name,a){const b=encode(a);writeFileSync(resolve(out,name+'.png'),b);registration.images[name]={path:name+'.png',size:[a.width,a.height],sha256:sha(b)};return a;}
function cell(a,x,y,cols,rows){const x0=Math.round(x*a.width/cols),x1=Math.round((x+1)*a.width/cols),y0=Math.round(y*a.height/rows),y1=Math.round((y+1)*a.height/rows);return crop(a,x0,y0,x1-x0,y1-y0);}
function fit(a,w,h,colours=24){const cut=crop(a,...bounds(a));return quant(nearest(cut,w,h),colours);}
const dragon=source('sea-dragon'),spirit=source('umibozu');
for(const [name,a,w,h]of [['dragon',dragon,80,72],['umibozu',spirit,72,80]]){
  // Shared source-cell registration keeps emergence heights, never independently stretches each pose.
  const cells=Array.from({length:4},(_,i)=>cell(a,i,0,4,1));
  const boxes=cells.map(bounds),top=Math.min(...boxes.map(b=>b[1])),bottom=Math.max(...boxes.map(b=>b[1]+b[3]));
  const left=Math.min(...boxes.map(b=>b[0])),right=Math.max(...boxes.map(b=>b[0]+b[2]));
  const strip=blank(w*4,h);
  const scale=Math.min(w/(right-left),h/(bottom-top)),fw=Math.round((right-left)*scale),fh=Math.round((bottom-top)*scale);
  for(let i=0;i<4;i++)paste(strip,quant(nearest(crop(cells[i],left,top,right-left,bottom-top),fw,fh),24),i*w+Math.floor((w-fw)/2),h-fh);
  save(name,strip);
}
const accessories=source('accessories');
const dimensions=[['plank',12,38],['perch',30,24],['chochin',9,16],['petal',6,5],['crane-up',32,24],['crane-mid',32,24],['crane-down',32,24],['moon',24,24],['splash-impact',48,32],['splash-burst',48,32],['lightning-a',24,48],['lightning-b',24,48]];
for(const [i,[name,w,h]]of dimensions.entries()){
  const a=fit(cell(accessories,i%4,Math.floor(i/4),4,3),w,h,name==='petal'?3:16);
  save(name,a);
}
// A lantern is generated art registered into the engine's flickering pixel-glyph vocabulary.
const lamp=quant(read('chochin'),3,[[22,30,48],[255,214,136],[148,62,65]]);
registration.lantern=Array.from({length:lamp.height},(_,y)=>Array.from({length:lamp.width},(_,x)=>{const i=(y*lamp.width+x)*4;return lamp.rgba[i+3]===0?'.':lamp.rgba[i]===22?'a':lamp.rgba[i]===255?'b':'c';}).join(''));
// The native flicker glyph consumes all lantern pixels; its intermediate PNG does not ship.
delete registration.images.chochin;unlinkSync(resolve(out,'chochin.png'));
const climbers=source('climbers'),newCrew=source('crew-variety');
const base=JSON.parse(readFileSync(resolve(here,'../registration.json')));
const poseIds=['stand','front-a','front-pass','front-b','side-idle','side-a','side-pass','side-b','pull-a','pull-b','waiting','rest'];
for(const [li,look]of ['indigo','russet','moss','plum','ochre','teal'].entries()){
  const atlas=blank(480,36),lane={};
  if(li<2){paste(atlas,read('crew-'+look),0,0);Object.assign(lane,base.lanes[look]);}
  else for(let i=0;i<12;i++){
    const c=cell(newCrew,i,li-2,12,4),body=crop(c,...bounds(c));
    const scale=Math.min((i===11?24:i===8||i===9?30:32)/body.height,28/body.width);
    const figure=quant(nearest(body,Math.max(1,Math.round(body.width*scale)),Math.max(1,Math.round(body.height*scale))),24);
    const x=Math.floor((32-figure.width)/2),y=34-figure.height;paste(atlas,figure,i*32+x,y);
    lane[poseIds[i]]={rect:[i*32+x,y,figure.width,figure.height],feet:[16-x,figure.height]};
  }
  for(let i=0;i<3;i++){
    const c=cell(climbers,li,i,6,3),body=crop(c,...bounds(c));
    const scale=Math.min(32/body.height,28/body.width),figure=quant(nearest(body,Math.round(body.width*scale),Math.round(body.height*scale)),24);
    const x=Math.floor((32-figure.width)/2),y=34-figure.height;paste(atlas,figure,(12+i)*32+x,y);
    lane[['climb-a','climb-b','lookout'][i]]={rect:[(12+i)*32+x,y,figure.width,figure.height],feet:[16-x,figure.height]};
  }
  save('crew-'+look,atlas);registration.lanes[look]=lane;
}
const weather=source('weather');
save('stars',fit(cell(weather,0,0,2,2),96,64,4));
const overcast=blank(600,400);paste(overcast,fit(cell(weather,1,0,2,2),600,180,24),0,0);save('overcast',overcast);
for(let i=0;i<2;i++)save('rain-'+i,fit(cell(weather,i,1,2,2),96,64,6));
save('clear-weather',blank(96,64));
const stars=read('stars');for(let i=0;i<stars.rgba.length;i+=4)for(let c=0;c<3;c++)stars.rgba[i+c]=Math.round(stars.rgba[i+c]*.55);save('stars-dim',stars);
const moon=blank(600,400);paste(moon,read('moon'),130,55);save('moon-sky',moon);
delete registration.images.moon;unlinkSync(resolve(out,'moon.png'));
// Register the generated dusk palette onto the original pixels. Geometry and alpha stay exact.
const day=read('coast'),dusk=nearest(source('dusk-reference'),600,400);
const sums=new Map();for(let i=0;i<day.rgba.length;i+=4){const k=day.rgba.subarray(i,i+3).join(',');let s=sums.get(k);if(!s){s=[0,0,0,0];sums.set(k,s);}for(let c=0;c<3;c++)s[c]+=dusk.rgba[i+c];s[3]++;}
const map=new Map([...sums].map(([k,s])=>[k,s.slice(0,3).map(v=>Math.round(v/s[3]))]));
for(const [phase,mix]of [['dawn',.65],['morning',.08],['afternoon',.22],['dusk',1]])for(const suffix of ['', '-front']){
  const a=read('coast'+suffix);for(let i=0;i<a.rgba.length;i+=4){if(!a.rgba[i+3])continue;const rgb=map.get(a.rgba.subarray(i,i+3).join(','));if(rgb)for(let c=0;c<3;c++)a.rgba[i+c]=Math.round(a.rgba[i+c]*(1-mix)+rgb[c]*mix);}
  save('coast-'+phase+suffix,a);
}
// Three-colour petal masks are recoloured by the existing drifter day palette.
save('petal',quant(read('petal'),3,[[181,91,129],[236,157,185],[255,221,225]]));
const preview=resolve(here,'review/after/day.png');
if(existsSync(preview))save('preview',nearest(decodePng(readFileSync(preview)),384,202));
writeFileSync(resolve(here,'registration.json'),JSON.stringify(registration,null,2)+'\n');
console.log(JSON.stringify({images:Object.keys(registration.images).length,sources:Object.keys(registration.sources)}));
