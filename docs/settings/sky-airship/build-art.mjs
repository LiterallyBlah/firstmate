/** Offline registration and finite animation of generated source art. No runtime code. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {decodePng} from '../../../test/png.ts';
import {blank,crop,nearest,encode,quant,paste,bounds} from '../japanese-ship/build-art.mjs';
const here=dirname(fileURLToPath(import.meta.url)),out=resolve(here,'../../../art/settings/sky-airship');
mkdirSync(out,{recursive:true});
const images={},sources={},lanes={};
const sha=b=>createHash('sha256').update(b).digest('hex');
const source=n=>{const b=readFileSync(resolve(here,'sources',n+'.png'));sources[n]={sha256:sha(b)};return decodePng(b);};
const save=(n,a)=>{const b=encode(a);writeFileSync(resolve(out,n+'.png'),b);images[n]={path:n+'.png',size:[a.width,a.height],sha256:sha(b)};return a;};
const clone=a=>({width:a.width,height:a.height,rgba:Buffer.from(a.rgba)});
const put=(a,x,y,c)=>{if(x>=0&&y>=0&&x<a.width&&y<a.height)a.rgba.set(c,(y*a.width+x)*4);};
const pixel=(a,x,y)=>a.rgba.subarray((y*a.width+x)*4,(y*a.width+x)*4+4);
const clean=a=>{for(let i=0;i<a.rgba.length;i+=4)if(a.rgba[i+3]<240)a.rgba.fill(0,i,i+4);return a;};
const trim=a=>crop(a,...bounds(clean(a)));
const fit=(a,w,h,pal=24)=>{a=trim(a);const s=Math.min(w/a.width,h/a.height),b=quant(nearest(a,Math.max(1,Math.round(a.width*s)),Math.max(1,Math.round(a.height*s))),pal),c=blank(w,h);paste(c,b,Math.floor((w-b.width)/2),h-b.height);return c;};
const cells=(a,cols,rows)=>Array.from({length:cols*rows},(_,i)=>{const x=Math.round(i%cols*a.width/cols),y=Math.round(Math.floor(i/cols)*a.height/rows),r=Math.round((i%cols+1)*a.width/cols),b=Math.round((Math.floor(i/cols)+1)*a.height/rows);return crop(a,x,y,r-x,b-y);});
const frames=(name,list)=>{list.forEach((a,i)=>save(name+'-'+i,a));};
// Preserve level deck; compress only the balloon and lengthen its suspension region.
const original=quant(nearest(clean(source('stage')),480,320),48),ship=blank(480,320);
for(let y=0;y<320;y++){const sy=y<55?y:y<125?55+Math.floor((y-55)*95/70):y<211?150+Math.floor((y-125)*61/86):y;for(let x=0;x<480;x++)put(ship,x,y,pixel(original,x,sy));}
save('ship',ship);
// Every dynamic plate is made from generated pixels. Frame zero reconstructs its region.
const pieces={balloon:[45,48,394,82],rig:[66,130,322,81],flag:[240,4,64,35],'sail-left':[31,102,57,61],'sail-right':[401,102,57,61],propeller:[453,211,24,66]};
const fixed=clone(ship);
for(const [name,rect]of Object.entries(pieces)){
  const base=crop(ship,...rect),list=[];
  for(let y=0;y<base.height;y++)for(let x=0;x<base.width;x++){
    const gx=x+rect[0],gy=y+rect[1];
    const rigInk=name!=='rig'||[[111,122],[181,198],[242,253],[303,317],[367,380]].some(([a,b])=>gx>=a&&gx<b);
    const later=Object.entries(pieces).slice(Object.keys(pieces).indexOf(name)+1).some(([n,[a,b,w,h]])=>n!=='rig'&&gx>=a&&gx<a+w&&gy>=b&&gy<b+h);
    if(!rigInk||later)put(base,x,y,[0,0,0,0]);
    else if(pixel(base,x,y)[3])put(fixed,gx,gy,[0,0,0,0]);
  }
  for(let f=0;f<4;f++){const b=blank(base.width,base.height),phase=Math.sin(f*Math.PI/2);
    for(let y=0;y<base.height;y++)for(let x=0;x<base.width;x++){
      let dx=0,dy=0;
      if(name==='balloon'){dx=Math.round(phase);dy=Math.round(phase*Math.sin(Math.PI*y/base.height));}
      else if(name==='propeller'){const scale=[1,.32,.85,.32][f];dy=Math.round((y-base.height/2)*scale+base.height/2)-y;}
      else if(name==='flag'){dy=Math.round(phase*2*Math.sin(x/base.width*Math.PI));}
      else if(name.startsWith('sail')){dx=Math.round(phase*2*Math.sin(y/base.height*Math.PI));}
      else dx=Math.round(phase*Math.sin(y/base.height*Math.PI));
      if(pixel(base,x,y)[3])put(b,x+dx,y+dy,pixel(base,x,y));
    }list.push(b);
  }frames(name,list);
}
save('fixed',fixed);
// Native white-cap cast: 16 separately trimmed generated poses, same anchored atlas cell.
const poses=['stand','front-a','front-pass','front-b','side-idle','side-a','side-pass','side-b','crank-a','crank-b','waiting','rest','climb-a','climb-b','lookout','fall'];
const crew=cells(source('crew'),4,4),atlas=blank(512,36),lane={};
for(let i=0;i<16;i++){const body=fit(crew[i],28,i===11?24:30,24);paste(atlas,body,i*32+2,34-body.height);lane[poses[i]]={rect:[i*32+2,34-body.height,28,body.height],feet:[14,body.height]};}
save('crew-navy',atlas);lanes.navy=lane;
const russet=clone(atlas);for(let i=0;i<russet.rgba.length;i+=4){const [r,g,b]=russet.rgba.subarray(i,i+3);if(b>r*1.3&&b>g*1.05){russet.rgba[i]=Math.min(180,Math.round(b*1.35));russet.rgba[i+1]=Math.round(g*.85);russet.rgba[i+2]=Math.round(r*.8);}}save('crew-russet',russet);lanes.russet=lane;
// Both generated backdrops share geometry. Warm intermediary phases are palette transfers, not new scenery.
const day=save('sky-day',quant(nearest(source('sky'),600,400),64));
save('sky-night',quant(nearest(source('sky-night'),600,400),64));
for(const [name,mul,add]of [['dawn',[1,.78,.78],[18,6,19]],['dusk',[.86,.62,.72],[28,5,12]]]){const a=clone(day);for(let i=0;i<a.rgba.length;i+=4)for(let c=0;c<3;c++)a.rgba[i+c]=Math.min(255,Math.round(a.rgba[i+c]*mul[c]+add[c]));save('sky-'+name,a);}
const a=source('atlas');
// Source atlas has a wider first cloud cell; explicit reviewed boxes prevent neighbouring sprites leaking.
const boxes=[[0,80,460,260],[475,110,260,220],[765,180,420,130],[1200,20,330,330],[60,380,300,270],[435,400,310,250],[775,395,385,260],[1200,350,330,310],...Array.from({length:4},(_,i)=>[i*384,675,384,349])];
const bits=boxes.map(b=>crop(a,...b));
const cloudPalette=[[110,143,194],[185,204,235],[255,241,214]];
for(const [i,n,w,h]of [[0,'cloud-bank',128,48],[1,'cloud-puff',64,38],[2,'cloud-wisp',96,24]])save(n,quant(fit(bits[i],w,h),3,cloudPalette));
save('sleep-window',fit(bits[7],14,16,16));
for(const [i,n,w,h]of [[4,'gull-up',24,20],[5,'gull-down',24,20],[6,'distant-airship',48,30]])save(n,fit(bits[i],w,h));
frames('serpent',bits.slice(8).map(b=>fit(b,110,86,24)));
const smoke=fit(bits[3],24,44,8),wisp=fit(bits[2],80,20,8);
for(const [name,base]of [['smoke',smoke],['vapour',wisp]])frames(name,[0,1,2,3].map(f=>{const b=blank(base.width,base.height);for(let y=0;y<base.height;y++)for(let x=0;x<base.width;x++){const dx=Math.round(Math.sin((y+f*5)/8)*1.5),sy=(y+f*2)%base.height;put(b,x+dx,y,pixel(base,x,sy));}return b;}));
const whales=cells(source('whales'),4,3);
frames('carrier',whales.slice(0,4).map(b=>fit(b,56,44,20)));
// A shared cell scale for departure preserves the rise in the generated pose heights.
frames('whale',whales.slice(4,8).map(b=>{const body=quant(nearest(clean(b),96,80),24);return body;}));
frames('puff',whales.slice(8,12).map(b=>fit(b,64,48,8)));
// Cloud sea and mist are generated cloud pixels, tiled/animated independently of the backdrop.
const sea=quant(fit(bits[0],160,48,16),3,cloudPalette);frames('cloud-sea',[0,1,2,3].map(f=>{const b=clone(sea);for(let y=0;y<b.height;y++)for(let x=0;x<b.width;x++)put(b,x,y,pixel(sea,(x+Math.round(Math.sin(y/9+f*Math.PI/2)*2)+sea.width)%sea.width,y));return b;}));
const mist=quant(fit(bits[2],160,16,8),3,cloudPalette);frames('mist',[0,1,2,3].map(f=>{const b=blank(160,18);paste(b,mist,0,f%2);return b;}));
const weather=source('weather');
save('thunderhead',fit(crop(weather,0,75,1045,405),180,64,12));
save('lightning-0',fit(crop(weather,1050,0,480,515),70,105,5));
save('lightning-1',fit(crop(weather,160,515,500,509),70,105,5));
const rain=quant(nearest(clean(crop(weather,800,530,720,480)),96,64),4);
save('rain-clear',blank(96,64));
frames('rain',[0,1,2,3].map(f=>{const b=blank(96,64);for(let y=0;y<64;y++)for(let x=0;x<96;x++)put(b,x,y,pixel(rain,(x+f*3)%96,(y+f*7)%64));return b;}));
const preview=resolve(here,'review/day-canvas.png');if(existsSync(preview))save('preview',nearest(decodePng(readFileSync(preview)),384,256));
writeFileSync(resolve(here,'registration.json'),JSON.stringify({sources,images,lanes,pieces},null,2)+'\n');
console.log(JSON.stringify({images:Object.keys(images).length,bytes:Object.values(images).reduce((n,a)=>n+readFileSync(resolve(out,a.path)).length,0)}));
