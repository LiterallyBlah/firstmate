/** Offline registration of commissioned raster art. Nothing here ships or runs in the client. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {crc32,deflateSync} from 'node:zlib';
import {decodePng} from '../../../test/png.ts';
import {blank,crop,nearest,quant,encode,paste} from '../japanese-ship/build-art.mjs';
const here=dirname(fileURLToPath(import.meta.url)),out=resolve(here,'../../../art/settings/ghost-ship');
mkdirSync(out,{recursive:true});
const images={},sources={},lanes={},parts={};
const sha=b=>createHash('sha256').update(b).digest('hex');
const source=n=>{const b=readFileSync(resolve(here,'sources',n+'.png'));sources[n]={sha256:sha(b)};return decodePng(b);};
const clone=a=>({width:a.width,height:a.height,rgba:Buffer.from(a.rgba)});
const pixel=(a,x,y)=>a.rgba.subarray((y*a.width+x)*4,(y*a.width+x)*4+4);
const put=(a,x,y,c)=>{if(x>=0&&y>=0&&x<a.width&&y<a.height)a.rgba.set(c,(y*a.width+x)*4);};
function pal(a,n=32,alpha=true){const al=[];for(let i=3;i<a.rgba.length;i+=4){al.push(a.rgba[i]<70?0:alpha?Math.min(255,Math.round(a.rgba[i]/51)*51):255);a.rgba[i]=al.at(-1)?255:0;}quant(a,n);for(let i=3,j=0;i<a.rgba.length;i+=4,j++)a.rgba[i]=al[j];return a;}
function indexed(a){const cols=[],map=new Map(),raw=Buffer.alloc((a.width+1)*a.height);for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++){const p=[...pixel(a,x,y)],k=p[3]?p.join(','):'0,0,0,0';let id=map.get(k);if(id===undefined){id=cols.length;map.set(k,id);cols.push(k.split(',').map(Number));}if(id>255)return encode(a);raw[y*(a.width+1)+1+x]=id;}const chunk=(s,b)=>{const h=Buffer.alloc(8),t=Buffer.alloc(4);h.writeUInt32BE(b.length);h.write(s,4);t.writeUInt32BE(crc32(Buffer.concat([h.subarray(4),b]))>>>0);return Buffer.concat([h,b,t]);};const h=Buffer.alloc(13);h.writeUInt32BE(a.width);h.writeUInt32BE(a.height,4);h.set([8,3,0,0,0],8);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('PLTE',Buffer.from(cols.flatMap(c=>c.slice(0,3)))),chunk('tRNS',Buffer.from(cols.map(c=>c[3]))),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);}
const save=(id,a)=>{const b=indexed(a);writeFileSync(resolve(out,id+'.png'),b);images[id]={path:id+'.png',size:[a.width,a.height],sha256:sha(b)};return a;};
const cells=(a,c,r)=>Array.from({length:c*r},(_,i)=>{const x=Math.round(i%c*a.width/c),y=Math.round(Math.floor(i/c)*a.height/r),x2=Math.round((i%c+1)*a.width/c),y2=Math.round((Math.floor(i/c)+1)*a.height/r);return crop(a,x,y,x2-x,y2-y);});
function bounds(a,threshold=100){let x0=a.width,y0=a.height,x1=-1,y1=-1;for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++)if(pixel(a,x,y)[3]>=threshold){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}return x1<0?[0,0,1,1]:[x0,y0,x1-x0+1,y1-y0+1];}
function fit(a,w,h,n=24){a=crop(a,...bounds(a));const s=Math.min(w/a.width,h/a.height),b=pal(nearest(a,Math.max(1,Math.round(a.width*s)),Math.max(1,Math.round(a.height*s))),n),c=blank(w,h);paste(c,b,Math.floor((w-b.width)/2),h-b.height);return c;}
function tint(a,mul,alpha=1){a=clone(a);for(let i=0;i<a.rgba.length;i+=4){for(let c=0;c<3;c++)a.rgba[i+c]=Math.min(255,Math.round(a.rgba[i+c]*mul[c]));a.rgba[i+3]=Math.round(a.rgba[i+3]*alpha);}return a;}
const warp=(a,k,amp=2)=>{const b=blank(a.width,a.height);for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++)put(b,x+Math.round(Math.sin(y/a.height*Math.PI)*Math.sin(k*Math.PI/2)*amp),y,pixel(a,x,y));return b;};
const phases=['dawn','morning','midday','afternoon','dusk','night'];
// Add sixteen logical rows to the working deck; keep the approved hull and mast proportions elsewhere.
const raw=pal(nearest(source('stage'),760,428),64,false),ship=blank(800,520);
for(let y=0;y<444;y++){const sy=y<282?y:y<318?282+Math.floor((y-282)*20/36):y-16;for(let x=0;x<760;x++)put(ship,x+20,y+20,pixel(raw,x,sy));}
save('ship',ship);
const fixed=clone(ship);
function plate(id,rect,select=(p)=>p[3]>0,amp=2){const a=crop(ship,...rect);for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++){if(!select(pixel(a,x,y),x,y))put(a,x,y,[0,0,0,0]);else put(fixed,x+rect[0],y+rect[1],[0,0,0,0]);}parts[id]=rect;for(let k=0;k<4;k++)save(id+'-'+k,warp(a,k,amp));}
const cloth=p=>p[3]>0&&p[1]>p[0]*1.18&&p[1]>p[2]*.94;
plate('sail-main',[235,96,230,190],cloth,3);
plate('sail-aft',[480,114,184,150],cloth,3);
plate('flag-main',[302,30,122,58],()=>true,3);
plate('flag-aft',[538,50,106,55],()=>true,2);
plate('rig',[110,105,550,191],p=>p[3]>0&&p[0]>p[2]*1.5&&p[0]>p[1]*1.02,1);
save('fixed',fixed);
// Opaque cloth at the transit crossing is a foreground depth piece; its ladder never paints over cloth.
save('sail-screen',crop(ship,304,115,23,150));
const seam=blank(800,520);for(let y=338;y<465;y++)for(let x=25;x<780;x++){const p=pixel(ship,x,y);if(p[1]>p[0]*1.8&&p[1]>90&&p[2]>50)put(seam,x,y,p);}
for(let k=0;k<4;k++)save('seam-'+k,tint(seam,[1,1,1],[.18,.45,.7,.4][k]));
// Uniform pose cells keep hit geometry stable across eight genuinely different silhouettes.
const crew=cells(source('crew'),8,8),poses=['stand','walk-a','walk-b','haul-a','haul-b','wait','climb','fall'];
for(let row=0;row<8;row++){const atlas=blank(24*8,28),lane={};for(let col=0;col<8;col++){const a=fit(crew[row*8+col],22,25,24);for(let i=3;i<a.rgba.length;i+=4)a.rgba[i]=Math.round(a.rgba[i]*.72);paste(atlas,a,col*24+1,2);lane[poses[col]]={rect:[col*24,0,24,28],feet:[12,27]};}save('crew-'+row,atlas);lanes['ghost-'+row]=lane;}
const sky=cells(source('skies-framed'),3,2);phases.forEach((p,i)=>save('sky-'+p,pal(nearest(sky[i],320,240),24,false)));
const coast0=source('coast'),coast=fit(coast0,800,168,40),coastPlate=blank(1000,168);paste(coastPlate,coast,100,0);
const coastTints=[[1.12,1.04,1.1],[1.15,1.2,1.18],[1.1,1.18,1.17],[1.12,1.1,1.05],[.94,.86,1],[.75,1,.95]];
phases.forEach((p,i)=>{const a=tint(coastPlate,coastTints[i]);for(let j=0;j<a.rgba.length;j+=4)if(a.rgba[j+1]>a.rgba[j]*1.65&&a.rgba[j+1]>70){const gain=p==='night'?1.9:p==='dusk'?1.2:.45;for(let c=0;c<3;c++)a.rgba[j+c]=Math.min(255,Math.round(a.rgba[j+c]*gain));}save('coast-'+p,pal(a,48));});
const water=cells(source('water'),2,3);
for(let band=0;band<3;band++)for(let storm=0;storm<2;storm++){const a=pal(nearest(water[band*2+storm],192,64),32,false);for(let k=0;k<4;k++){const b=blank(192,64);for(let y=0;y<64;y++)for(let x=0;x<192;x++)put(b,x,y,pixel(a,(x+k*3+Math.round(Math.sin((y+k*8)/64*Math.PI*2)*2)+192)%192,y));save('water-'+band+'-'+storm+'-'+k,b);}}
const ambience=cells(source('ambience'),4,4);
const sprites=[['cloud-wisp',0,40,12],['cloud-bank',1,52,28],['fog',2,160,42],['hatch-mist',3,36,42],['raven-rest',4,16,18],['raven-turn',5,24,18],['bat-up',6,20,16],['bat-down',7,20,16],['jelly-wide',8,28,42],['jelly-narrow',9,28,42],['candle',10,20,28],['spectral-ship',11,140,100],['lightning',12,70,160],['ripple',13,90,24],['beam',14,170,22],['sleeper',15,18,12]];
const cutSprites={};for(const [id,i,w,h]of sprites)cutSprites[id]=fit(ambience[i],w,h,24);
for(const id of ['cloud-wisp','cloud-bank']){const a=cutSprites[id];quant(a,3,[[64,84,100],[110,140,150],[190,212,208]]);save(id,a);}
for(const id of ['raven-rest','raven-turn','bat-up','bat-down','jelly-wide','jelly-narrow','sleeper','spectral-ship','lightning','ripple'])save(id,id==='sleeper'?tint(cutSprites[id],[1,1,1],.72):cutSprites[id]);
for(const id of ['fog','hatch-mist','candle'])for(let k=0;k<4;k++){
 const a=warp(cutSprites[id],k,id==='fog'?5:2);
 if(id==='candle'){const moving=blank(a.width,a.height);for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++)put(moving,x,y+[0,1,2,1][k],pixel(a,x,y));save(id+'-'+k,moving);}
 else save(id+'-'+k,tint(a,[1,1,1],id==='fog'?.3:[.5,.8,1,.7][k]));
 if(id==='fog')save('night-fog-'+k,tint(a,[.8,1,.95],.55));
}
for(let k=0;k<16;k++){const a=blank(960,80);paste(a,cutSprites[k%2?'bat-up':'bat-down'],20+k*58,24+Math.round(Math.sin(k*.6)*10));save('bat-flight-'+k,a);}save('bat-flight-clear',blank(960,80));
for(let k=0;k<8;k++){const a=blank(800,110);paste(a,tint(cutSprites['spectral-ship'],[1,1,1],Math.sin((k+1)/9*Math.PI)*.7),k*80,4);save('ship-passage-'+k,a);}save('ship-passage-clear',blank(800,110));
for(let k=0;k<4;k++){const a=blank(1000,24);paste(a,tint(cutSprites.beam,[1,1,1],[.15,.6,1,.5][k]),820,1);save('beam-'+k,a);}save('beam-clear',blank(1000,24));
// The full-body carrier is split by the existing renderer, with its own surface-clock ripple.
cells(source('anglerfish'),2,2).forEach((a,i)=>save('angler-'+i,pal(nearest(a,64,56),32)));
const kraken=cells(source('kraken'),4,2);kraken.forEach((a,i)=>{
 const registered=blank(156,132),scaled=pal(nearest(a,156,132),32),dy=i<4?1:15;
 for(let y=0;y<132;y++)for(let x=0;x<156;x++){const p=[...pixel(scaled,x,y)];if(y+dy>=110){p[0]=Math.round(p[0]*.5);p[1]=Math.round(p[1]*.8);p[3]=Math.round(p[3]*.55);}put(registered,x,y+dy,p);}
 save('kraken-'+i,registered);save('distant-kraken-'+i,pal(nearest(registered,78,66),20));
});
// The generated whale atlas has unequal row heights. Crop beyond the first row's waterline,
// then register both rows to one surface; never let its ripple leak into a later sky frame.
const whale=source('whale');for(let i=0;i<6;i++){
 const top=i<3?0:560,h=i<3?560:464,water=i<3?520:920;
 const a=pal(nearest(crop(whale,(i%3)*512,top,512,h),154,Math.round(h*.3)),32),b=blank(174,162),dy=148-Math.round((water-top)*.3);
 for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++)put(b,x+10,y+dy,pixel(a,x,y));save('whale-'+i,b);
}
save('fog-clear',blank(160,42));save('distant-kraken-clear',blank(78,66));save('whale-clear',blank(174,162));save('kraken-clear',blank(156,132));save('ship-clear',blank(140,100));save('bat-clear',blank(20,16));
save('underwater',pal(nearest(source('underwater'),520,100),24));
const deep=blank(96,64);for(let y=0;y<64;y++)for(let x=0;x<96;x++)put(deep,x,y,[4,29,39,255]);save('deep-water',deep);
// Generic rain art is reused, unchanged, from the existing shipped Ship; retain explicit provenance.
const original=JSON.parse(readFileSync(resolve(here,'../../../art/settings/ship/setting.json')));
for(const id of ['rain-clear','rain-0','rain-1','rain-2','rain-3','storm-sky-overcast']){const def=original.images[id],b=readFileSync(resolve(here,'../../../art/settings/ship',def.path));save(id,id==='storm-sky-overcast'?tint(nearest(decodePng(b),320,240),[.4,.62,.56]):decodePng(b));sources[id]={reusedFrom:'art/settings/ship/'+def.path,sha256:sha(b),transform:id==='storm-sky-overcast'?'resize; charcoal-green tint':null};}
const preview=resolve(here,'review/midday-wide.png');if(existsSync(preview))save('preview',pal(nearest(decodePng(readFileSync(preview)),384,216),96,false));else save('preview',pal(nearest(source('stage'),384,216),64));
writeFileSync(resolve(here,'registration.json'),JSON.stringify({sources,images,lanes,parts},null,2)+'\n');
writeFileSync(resolve(here,'stage-registration.png'),encode(ship));
console.log(JSON.stringify({images:Object.keys(images).length,bytes:Object.values(images).reduce((s,a)=>s+readFileSync(resolve(out,a.path)).length,0)}));




