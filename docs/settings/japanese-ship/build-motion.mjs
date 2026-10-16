/** Register generated motion layers without touching approved ship/layout pixels. Offline only. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodePng} from '../../../test/png.ts';
import {blank,crop,nearest,encode,quant,paste} from './build-art.mjs';
const here=dirname(fileURLToPath(import.meta.url)),out=resolve(here,'../../../art/settings/japanese-ship');
const registration=JSON.parse(readFileSync(resolve(here,'registration.json')));
const read=name=>decodePng(readFileSync(resolve(out,name+'.png')));
const source=name=>{const bytes=readFileSync(resolve(here,'sources',name+'.png'));registration.sources[name]={sha256:createHash('sha256').update(bytes).digest('hex')};return decodePng(bytes);};
const save=(name,a)=>{const bytes=encode(a);writeFileSync(resolve(out,name+'.png'),bytes);registration.images[name]={path:name+'.png',size:[a.width,a.height],sha256:createHash('sha256').update(bytes).digest('hex')};};
const copy=a=>({width:a.width,height:a.height,rgba:Buffer.from(a.rgba)});
const pixel=(a,x,y)=>a.rgba.subarray((y*a.width+x)*4,(y*a.width+x)*4+4);
const put=(a,x,y,c)=>{if(x>=0&&x<a.width&&y>=0&&y<a.height)a.rgba.set(c,(y*a.width+x)*4);};
const palette=a=>[...new Set(Array.from({length:a.width*a.height},(_,i)=>a.rgba[i*4+3]?[...a.rgba.subarray(i*4,i*4+3)].join(','):null).filter(Boolean))].map(c=>c.split(',').map(Number));

// A single backdrop cutout, filled exactly by the fixed rig, topmast and approved cloth frame.
// This avoids the engine's bounding cutout accidentally dropping spars/ropes between separate rectangles.
const ship=read('ship'),rig=crop(ship,55,30,352,184),sail=blank(202,114);
const clothRows=Array.from({length:114},(_,dy)=>{
  const xs=[];for(let x=148;x<=338;x++){const c=pixel(ship,x,75+dy);if(c[0]>=155&&c[1]>=125)xs.push(x);}
  return [Math.min(...xs)-1,Math.max(...xs)+1];
});
const cloth=(x,y)=>y>=75&&y<189&&x>=clothRows[y-75][0]&&x<=clothRows[y-75][1]&&pixel(ship,x,y)[3];
for(let y=75;y<189;y++)for(let x=145;x<347;x++)if(cloth(x,y)){put(sail,x-145,y-75,pixel(ship,x,y));put(rig,x-55,y-30,[0,0,0,0]);}
const mast=crop(ship,214,30,51,37);
for(let y=0;y<37;y++)for(let x=0;x<51;x++)put(rig,214+x-55,y,[0,0,0,0]);
save('rig-fixed',rig);save('masthead',mast);
const billow=copy(sail),generated=quant(nearest(source('sail-billow'),480,320),48,JSON.parse(readFileSync(resolve(here,'ship-palette.json'))));
// Generated folds, registered onto the approved cloth, with fixed top/bottom attachment rows.
// A one/two-pixel lateral belly is encoded in the second frame, never in hull/anchor transforms.
for(let y=1;y<113;y++){
  const shift=Math.round(2*Math.sin(Math.PI*y/113));
  for(let x=0;x<202;x++)if(pixel(sail,x,y)[3])put(billow,x,y,[0,0,0,0]);
  for(let x=0;x<202;x++)if(pixel(sail,x,y)[3]){
    const from=pixel(generated,Math.round(149+(x+145-149)*201/188),75+y);
    const edge=x<6||x>189||y<5||y>108;
    put(billow,x+shift,y,!edge&&from[0]>150&&from[1]>120?from:pixel(sail,x,y));
  }
}
const sails=blank(404,114);paste(sails,sail,0,0);paste(sails,billow,202,0);save('sail-billow',sails);
// Recompose frame zero and prove every approved upper-rig pixel is retained.
const composed=copy(rig);
for(const [layer,dx,dy]of [[mast,159,0],[sail,90,45]])for(let y=0;y<layer.height;y++)for(let x=0;x<layer.width;x++)if(pixel(layer,x,y)[3])put(composed,x+dx,y+dy,pixel(layer,x,y));
assert.ok(composed.rgba.equals(crop(ship,55,30,352,184).rgba),'frame zero preserves approved rig pixels');

// Detach the original generated clouds; only their footprints are patched from imagegen's clear skies.
// Island, mountain, sea, stars outside these boxes and all layout/anchors remain byte-for-byte pixels.
const boxes=[[7,39,158,47],[224,79,94,22],[375,32,76,22]];
const coast=read('coast'),night=read('coast-night');
const cloudPalette=[[126,187,237],[199,223,240],[248,237,224]];
const cloudNames=['cloud-bank','cloud-puff','cloud-wisp'];
const cloudInk=c=>c[0]>150&&c[1]>=c[0]-15&&c[2]>=c[1]-20;
for(const [n,[left,top,w,h]]of boxes.entries()){
  const layer=blank(w,h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const c=pixel(coast,left+x,top+y);
    if(cloudInk(c))put(layer,x,y,c);
  }
  save(cloudNames[n],quant(layer,3,cloudPalette));
}
let changedSky=0;
for(const [name,original]of [['coast',coast],['coast-night',night]]){
  const generatedSky=nearest(source(name+'-clear'),600,400),next=copy(original);
  for(const [left,top,w,h]of boxes){
    // Colour-transfer the generated clear sky onto the surrounding approved sky before palette mapping.
    // Patching only cloud ink avoids rectangular generation seams in the original sky texture.
    const clean=blank(w,h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const c=pixel(generatedSky,left+x,top+y),a=pixel(generatedSky,left-2,top+y),b=pixel(generatedSky,left+w+1,top+y);
      const oldA=pixel(original,left-2,top+y),oldB=pixel(original,left+w+1,top+y),t=x/(w-1);
      put(clean,x,y,[...Array.from({length:3},(_,k)=>Math.max(0,Math.min(255,Math.round(c[k]-a[k]*(1-t)-b[k]*t+oldA[k]*(1-t)+oldB[k]*t)))),255]);
    }
    quant(clean,64,palette(original));
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const d=pixel(coast,left+x,top+y),c=pixel(original,left+x,top+y);
      if(cloudInk(d)||(name==='coast-night'&&c[2]>100&&c[0]>20&&c[0]<80&&c[1]>c[0])){put(next,left+x,top+y,pixel(clean,x,y));changedSky++;}
    }
  }
  save(name,next);
  // A same-placement foreground keeps every moving cloud behind the approved island and mountains.
  const front=copy(next);
  for(let y=0;y<175;y++)for(let x=0;x<600;x++){
    const c=pixel(coast,x,y),isSky=c[2]>200&&c[1]>150&&c[2]>c[1]+25&&c[1]>c[0]+25;
    const inCloud=boxes.some(([left,top,w,h])=>x>=left&&x<left+w&&y>=top&&y<top+h);
    if(isSky||(inCloud&&cloudInk(c)))put(front,x,y,[0,0,0,0]);
  }
  save(name+'-front',front);
}

// Small registered whole-pixel cycles from the generated wake and shark; no new colour or silhouette design.
// First frames stay exact. The bubble/head and the wake attachment stay fixed across frames.
for(const [name,count]of [['wake',3],['reply-shark',4]]){
  const base=read(name),atlas=blank(base.width*count,base.height);
  for(let f=0;f<count;f++){
    const frame=blank(base.width,base.height);
    for(let y=0;y<base.height;y++)for(let x=0;x<base.width;x++){
      let dx=0,dy=0;
      if(name==='wake'&&f>0){const gain=Math.min(1,x/35);dy=Math.round(Math.sin(x*.13+f*2.1)*gain);dx=Math.round(Math.sin(y*.4+f*2.1)*gain);}
      if(name==='reply-shark'&&f>0&&y>=25&&x<20)dy=Math.round(Math.sin(f*Math.PI/2)*(20-x)/16);
      if(pixel(base,x,y)[3])put(frame,x+dx,y+dy,pixel(base,x,y));
    }
    paste(atlas,frame,f*base.width,0);
  }
  save(name+'-motion',atlas);
}
writeFileSync(resolve(here,'registration.json'),JSON.stringify(registration,null,2)+'\n');
writeFileSync(resolve(here,'motion-art-audit.json'),JSON.stringify({approved:'815bcca39e91f9775d2ee975ce7286da71225fc6',rigFrameZero:'pixel-identical',shipImage:'unchanged',cloudPatchBoxes:boxes,cloudPatchPixels:changedSky,cloudPalette,notes:['Generated billow registered to the original 48-colour sail; fixed spar attachment rows.','Original cloud sprites detached; generated clean-sky pixels used only under cloud footprints.','Island, mountains, water and original hull retained; no engine changes.','Wake/shark cycles are whole-pixel registrations of existing generated art, frame zero unchanged.']},null,2)+'\n');
console.log('Registered billow, rig, clouds, wake and shark frames.');
