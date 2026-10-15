/** Offline raster assembly only; never shipped or imported by the scene engine.
 * npm install --prefix .local/office-art-tools sharp@0.35.5 pngjs@7.0.0
 * node docs/settings/office/build-art.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { crc32 } from 'node:zlib';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const require = createRequire(path.join(root, '.local/office-art-tools/package.json'));
const sharp = require('sharp');
const { PNG } = require('pngjs');
const contract = JSON.parse(fs.readFileSync(path.join(here, 'art-contract.json')));
const palettes = Object.fromEntries(Object.entries(contract.palettes).map(([k,v]) => [k,v.map(hex)]));
const out = path.join(here, 'art');
const review = path.join(here, 'review');
fs.mkdirSync(review, {recursive:true});
const images = new Map();
function hex(s) { return [1,3,5].map(i=>parseInt(s.slice(i,i+2),16)).concat(255); }
const base = palettes.base;
function canvas(w,h,c=[0,0,0,0]) { const a={w,h,data:Buffer.alloc(w*h*4)}; for(let i=0;i<w*h;i++) a.data.set(c,i*4); return a; }
function copy(a) {return {w:a.w,h:a.h,data:Buffer.from(a.data)};}
function pix(a,x,y) {return Array.from(a.data.subarray((y*a.w+x)*4,(y*a.w+x)*4+4));}
function put(a,x,y,c) {if(x>=0&&y>=0&&x<a.w&&y<a.h) a.data.set(c,(y*a.w+x)*4);}
function rect(a,x,y,w,h,c) {for(let yy=y;yy<y+h;yy++) for(let xx=x;xx<x+w;xx++) put(a,xx,yy,c);}
function crop(a,x,y,w,h) {let b=canvas(w,h);for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++)put(b,xx,yy,pix(a,x+xx,y+yy));return b;}
function paste(a,b,x,y) {for(let yy=0;yy<b.h;yy++) for(let xx=0;xx<b.w;xx++) {const c=pix(b,xx,yy); if(c[3]) put(a,x+xx,y+yy,c);} }
function nearest(a,w,h) {const b=canvas(w,h); for(let y=0;y<h;y++)for(let x=0;x<w;x++)put(b,x,y,pix(a,Math.min(a.w-1,Math.floor((x+.5)*a.w/w)),Math.min(a.h-1,Math.floor((y+.5)*a.h/h))));return b;}
function bbox(a) {let x0=a.w,y0=a.h,x1=-1,y1=-1;for(let y=0;y<a.h;y++)for(let x=0;x<a.w;x++) if(a.data[(y*a.w+x)*4+3]>=192) {x0=Math.min(x,x0);y0=Math.min(y,y0);x1=Math.max(x,x1);y1=Math.max(y,y1);} if(x1<0)throw Error('empty source');return [x0,y0,x1-x0+1,y1-y0+1];}
function mainSilhouette(a) {
  const b=copy(a),seen=new Uint8Array(a.w*a.h),groups=[];
  for(let i=0;i<seen.length;i++) if(!seen[i]&&a.data[i*4+3]>=192) {
    const group=[i];seen[i]=1;
    for(let n=0;n<group.length;n++){const k=group[n],x=k%a.w,y=Math.floor(k/a.w);for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy,j=ny*a.w+nx;if(nx>=0&&nx<a.w&&ny>=0&&ny<a.h&&!seen[j]&&a.data[j*4+3]>=192){seen[j]=1;group.push(j);}}}
    groups.push(group);
  }
  groups.sort((x,y)=>y.length-x.length);
  for(const g of groups.slice(1)) if(g.length<groups[0].length*.03) for(const i of g)b.data.fill(0,i*4,i*4+4);
  return b;
}
function quant(a,p=base,threshold=192) {const b=copy(a);const memo=new Map();for(let i=0;i<b.data.length;i+=4){if(b.data[i+3]<threshold) {b.data.fill(0,i,i+4);continue;}const key=b.data[i]*65536+b.data[i+1]*256+b.data[i+2];let c=memo.get(key);if(!c){let best=Infinity;for(const q of p){const d=(b.data[i]-q[0])**2*.3+(b.data[i+1]-q[1])**2*.59+(b.data[i+2]-q[2])**2*.11;if(d<best){best=d;c=q;}}memo.set(key,c);}b.data.set(c,i);}return b;}
function removeSpecks(a,passes=1) {let b=copy(a);for(let p=0;p<passes;p++){const old=copy(b);for(let y=1;y<a.h-1;y++)for(let x=1;x<a.w-1;x++){
  const counts=new Map();for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const c=pix(old,x+dx,y+dy),k=c.join();counts.set(k,(counts.get(k)||0)+1);}
  const current=pix(old,x,y).join(),winner=[...counts].sort((a,b)=>b[1]-a[1])[0];if(counts.get(current)<=2&&winner[1]>=5)put(b,x,y,winner[0].split(',').map(Number));
}}return b;}
async function source(name) {const {data,info}=await sharp(path.join(here,'sources',name+'.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true});return {w:info.width,h:info.height,data};}
async function object(name,w,h) {const a=await source(name);return quant(nearest(crop(a,...bbox(a)),w,h));}
function png(a) {const data=PNG.sync.write({width:a.w,height:a.h,data:a.data,gamma:0.45455},{colorType:6,inputColorType:6,bitDepth:8,deflateLevel:9});const srgb=Buffer.alloc(13);srgb.writeUInt32BE(1,0);srgb.write('sRGB',4);srgb[8]=0;srgb.writeUInt32BE(crc32(srgb.subarray(4,9)),9);return Buffer.concat([data.subarray(0,33),srgb,data.subarray(33)]);}
function save(rel,a) {const dest=path.join(out,rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,png(a));images.set(rel,a);}
function reviewSave(rel,a) {fs.writeFileSync(path.join(review,rel),png(a));}
function strip(frames) {const a=canvas(frames[0].w*frames.length,frames[0].h);frames.forEach((f,i)=>paste(a,f,i*f.w,0));return a;}

// Source crops are allowed; delivered cells are always full contract size.
const castFrames = new Map();
for(const name of ['navy','teal','ochre','plum','rust','slate']) {
  const src=await source(name);const frames=[];
  for(let i=0;i<10;i++) {
    const col=i%5,row=Math.floor(i/5);const x0=Math.round(col*src.w/5),x1=Math.round((col+1)*src.w/5);
    const y0=Math.round(row*src.h/2),y1=Math.round((row+1)*src.h/2);
    const cell=mainSilhouette(crop(src,x0,y0,x1-x0,y1-y0));const b=bbox(cell);const part=crop(cell,...b);
    const targetHeight=i===5||i===6?25:i===9?24:31;
    const scale=Math.min(targetHeight/part.h,22/part.w);
    const figure=quant(nearest(part,Math.max(1,Math.round(part.w*scale)),Math.max(1,Math.round(part.h*scale))));
    if(name==='rust')for(let y=Math.floor(figure.h*.33);y<figure.h*.64;y++)for(let x=0;x<figure.w;x++){
      const c=pix(figure,x,y);if(c[3]&&c.slice(0,3).join()===base[9].slice(0,3).join())put(figure,x,y,base[23]);
    }
    const frame=canvas(24,32);paste(frame,figure,Math.round(12-figure.w/2),32-figure.h);frames.push(frame);
  }
  // Register the typing pair precisely. Only its small hand rectangle can change.
  const typingB=copy(frames[5]);
  for(let y=15;y<23;y++) for(let x=15;x<23;x++) put(typingB,x,y,pix(frames[6],x,y));
  frames[6]=typingB;
  castFrames.set(name,frames);save('cast/'+name+'.png',strip(frames));
}
for(const [name,w,h] of [['printer',20,24],['help-desk',32,24],['coffee-counter',32,28]]) save('props/'+name+'.png',await object(name,w,h));
save('desk-front.png',await object('desk-front',260,22));

// Generated architecture is remapped piecewise onto the explicit room coordinates.
// Sample original floor separately, keeping furniture out of reserved walk/crowd space.
const roomSrc=await source('room');
const room=canvas(420,240,base[2]);
paste(room,quant(nearest(crop(roomSrc,0,0,roomSrc.w,Math.round(roomSrc.h*.37)),420,88)),0,0);
paste(room,removeSpecks(quant(nearest(crop(roomSrc,Math.round(roomSrc.w*.075),Math.round(roomSrc.h*.40),Math.round(roomSrc.w*.85),Math.round(roomSrc.h*.60)),420,152)),3),0,88);
// Replacement wall strips cover generated window frames before exact re-registration.
const panel=quant(nearest(crop(roomSrc,Math.round(roomSrc.w*.83),0,Math.round(roomSrc.w*.025),Math.round(roomSrc.h*.26)),420,64));
paste(room,panel,0,0);
for(const [x,y,w,h] of contract.stage.windows) {
  rect(room,x-3,y-3,w+6,h+7,base[8]);rect(room,x-2,y-2,w+4,h+4,base[0]);
  rect(room,x-1,y-1,w+2,h+2,base[3]);rect(room,x,y,w,h,[0,0,0,0]);
  rect(room,x-3,y+h+2,w+6,2,base[10]);
}
rect(room,0,66,388,22,base[8]);rect(room,0,86,388,2,base[9]);
const [gx,gy,gw,gh]=contract.stage.interiorGlass;
rect(room,gx-2,gy-2,gw+4,gh+3,base[1]);rect(room,gx,gy,gw,gh,[0,0,0,0]);
// Clock and lift wall remain plain; the well is opaque, its overlay controls opening.
rect(room,276,66,112,22,base[2]);rect(room,388,64,32,48,base[0]);
if(fs.existsSync(path.join(here,'sources/desk-back.png'))) {
  const station=await object('desk-back',32,18);
  for(const y of [102,132])for(const x of [44,84,124,164,204,244])paste(room,station,x-16,y-18);
}
// Enforce the four exact holes after all backdrop assembly.
for(const r of [...contract.stage.windows,contract.stage.interiorGlass])rect(room,...r,[0,0,0,0]);
save('room.png',room);

// Reviewer sheet, enlarged with nearest-neighbour only (never installed art).
let contact=canvas(240,6*40,base[6]);let row=0;
for(const name of castFrames.keys()) {paste(contact,images.get('cast/'+name+'.png'),0,row*40+4);row++;}
reviewSave('cast.png',nearest(contact,1200,1200));

// One generated city determines every geometry pixel. Phase variants are palette-index
// remaps, never independently generated skylines, so crossfades cannot double rooflines.
const citySource=nearest(await source('city'),420,180),cityRaw=canvas(420,180);
// Raise the generated distant architecture into the contractual window view while
// retaining the 420x180 stage registration and the common horizon anchor [210,120].
for(let y=0;y<180;y++)for(let x=0;x<420;x++)put(cityRaw,x,y,pix(citySource,x,Math.min(179,Math.floor(y<40?y*2:80+(y-40)*100/140))));
const city=removeSpecks(quant(cityRaw,palettes['sky:midday']),2);
const lights=canvas(420,180);
for(let y=0;y<180;y++)for(let x=0;x<420;x++){
  const c=pix(city,x,y),q=pix(cityRaw,x,y);
  const isWindow=y>=55&&q[0]>q[1]*1.07&&q[1]>q[2]*1.18;
  if(isWindow){put(lights,x,y,palettes.lights[(x+y)%3===0?1:0]);put(city,x,y,palettes['sky:midday'][9]);}
}
const roles=new Map(palettes['sky:midday'].map((c,i)=>[c.join(),i]));
for(const phase of ['dawn','morning','midday','afternoon','dusk','night']){
  const variant=copy(city),p=palettes['sky:'+phase];
  for(let y=0;y<180;y++)for(let x=0;x<420;x++)put(variant,x,y,p[roles.get(pix(city,x,y).join())]);
  save('city/'+phase+'.png',variant);
}
save('city/lights.png',lights);

// Quiet architecture and furniture are identical beneath the added busy silhouettes.
const quietSrc=await source('quiet');
const quiet=quant(nearest(crop(quietSrc,0,0,quietSrc.w,240),248,18));
const busy=copy(quiet);
for(const [i,x]of [25,57,94,129,165,195,223].entries()){
  let figure=nearest(castFrames.get(['navy','teal','ochre'][i%3])[i%2?0:5],6,12);
  for(let k=0;k<figure.data.length;k+=4)if(figure.data[k+3])figure.data.set(base[(figure.data[k]+figure.data[k+1])>260?3:1],k);
  paste(busy,figure,x,6);
}
save('background/quiet.png',quiet);save('background/busy.png',busy);

// Bird sheet retains one global vertical sampling grid, keeping its body registered
// while the wings move above and below it.
const birdSource=await source('pigeon');const birds=[];
for(let i=0;i<3;i++){
  const x0=Math.round(i*birdSource.w/3),x1=Math.round((i+1)*birdSource.w/3);
  birds.push(quant(nearest(crop(birdSource,x0,240,x1-x0,560),24,16)));
}
save('pigeon.png',strip(birds));

// Generated clock face, with integer-pixel hand rotations around the exact anchor.
const clockFace=await object('clock',16,16);
rect(clockFace,5,4,6,8,base[6]);
function line(a,x0,y0,x1,y1,c){const dx=Math.abs(x1-x0),sx=x0<x1?1:-1,dy=-Math.abs(y1-y0),sy=y0<y1?1:-1;let err=dx+dy;for(;;){put(a,x0,y0,c);if(x0===x1&&y0===y1)break;const e=2*err;if(e>=dy){err+=dy;x0+=sx;}if(e<=dx){err+=dx;y0+=sy;}}}
const clockFaces=[];
for(let hour=0;hour<12;hour++) {const face=copy(clockFace),angle=hour*Math.PI/6;line(face,8,8,8,3,base[0]);line(face,8,8,Math.round(8+Math.sin(angle)*3),Math.round(8-Math.cos(angle)*3),base[2]);put(face,8,8,base[0]);clockFaces.push(face);}
save('clock.png',strip(clockFaces));

const steamSrc=await source('coffee-steam'),steams=[];
for(let i=0;i<3;i++){
  const x0=Math.round(i*steamSrc.w/3),x1=Math.round((i+1)*steamSrc.w/3);
  const cell=crop(steamSrc,x0,0,x1-x0,steamSrc.h),part=crop(cell,...bbox(cell));
  const shape=quant(nearest(part,5,10+i*4),palettes.steam,96);const f=canvas(16,20);
  paste(f,shape,6,20-shape.h);put(f,8,19,palettes.steam[0]);steams.push(f);
}
save('coffee-steam.png',strip(steams));

// Slice and translate generated door leaves; the opening is real transparency.
const closed=await object('lift-doors',32,48),doors=[];
for(const gap of [26,14,0]){
  const f=canvas(32,48);paste(f,crop(closed,0,0,32,3),0,0);paste(f,crop(closed,0,3,2,45),0,3);paste(f,crop(closed,30,3,2,45),30,3);
  if(gap<26){const shift=Math.round(gap/2);for(let y=3;y<48;y++)for(let x=2;x<30;x++){
    const target=x<16?x-shift:x+shift;if(target>=2&&target<30)put(f,target,y,pix(closed,x,y));
  }}doors.push(f);
}
save('effects/lift-doors.png',strip(doors));

const confettiSrc=await source('confetti'),confettis=[];
for(let i=0;i<3;i++){
  const x0=Math.round(i*confettiSrc.w/3),x1=Math.round((i+1)*confettiSrc.w/3);
  const cell=crop(confettiSrc,x0,0,x1-x0,confettiSrc.h),part=crop(cell,...bbox(cell));
  const [w,h,x,y]=[[12,14,25,22],[34,30,4,4],[38,32,0,6]][i];
  const f=canvas(48,40);paste(f,quant(nearest(part,w,h)),x,y);confettis.push(f);
}
save('effects/confetti.png',strip(confettis));

// Cup registration: relocate the generated mug, retaining generated cabinet/machine.
const coffee=images.get('props/coffee-counter.png');
// At final size the source mug is x14..21,y5..10. Relocate its rim to [16,4].
const mug=crop(coffee,14,5,8,6);rect(coffee,14,5,8,6,base[2]);paste(coffee,mug,13,4);
save('props/coffee-counter.png',coffee);

function compose(phase='midday',crowd=false){
  const a=canvas(420,240,base[0]);paste(a,images.get('city/'+phase+'.png'),0,-50);
  if(phase==='night')paste(a,lights,0,-50);
  paste(a,images.get('background/'+(crowd?'busy':'quiet')+'.png'),24,68);paste(a,room,0,0);
  paste(a,clockFaces[phase==='night'?10:0],278,70);paste(a,doors[0],388,64);
  const actors=[['navy',5,44,102],['teal',6,164,102],['plum',5,84,132],['ochre',7,350,96],['rust',8,286,126],['slate',9,150,202]];
  if(crowd){actors.pop();const names=[...castFrames.keys()];for(let row=0;row<2;row++)for(let col=0;col<12;col++)actors.push([names[(row*12+col)%6],row%2?0:9,32+col*32,190+row*44]);}
  const pieces=[{y:108,draw:()=>paste(a,images.get('desk-front.png'),24,96)},{y:138,draw:()=>paste(a,images.get('desk-front.png'),24,126)}];
  for(const [name,x,y] of [['printer',352,84],['help-desk',310,112],['coffee-counter',330,138]]){const p=images.get('props/'+name+'.png');pieces.push({y,draw:()=>paste(a,p,x-Math.floor(p.w/2),y-p.h)});}
  for(const [name,i,x,y]of actors)pieces.push({y,draw:()=>paste(a,castFrames.get(name)[i],x-12,y-32)});
  pieces.sort((x,y)=>x.y-y.y).forEach(x=>x.draw());paste(a,steams[1],322,94);return a;
}
const scene=compose();save('preview.png',quant(nearest(scene,210,120)));
reviewSave('office-midday.png',nearest(scene,1260,720));
reviewSave('office-night.png',nearest(compose('night'),1260,720));
reviewSave('office-crowd.png',nearest(compose('midday',true),1260,720));
const effects=canvas(260,150,base[6]);
paste(effects,images.get('pigeon.png'),0,0);paste(effects,images.get('clock.png'),0,20);paste(effects,images.get('coffee-steam.png'),0,40);paste(effects,images.get('effects/lift-doors.png'),60,40);paste(effects,images.get('effects/confetti.png'),0,100);
reviewSave('effects.png',nearest(effects,1040,600));
console.log('Assembly complete:',images.size,'PNGs');
