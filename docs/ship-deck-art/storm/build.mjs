// Mechanical extraction of generated raster art only; no drawn wave/cloud geometry.
// Run at repo root after: npm.cmd install --prefix .local/storm-tools pngjs@7.0.0
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PNG } = require('../../../.local/storm-tools/node_modules/pngjs');
const root = 'art/settings/ship/storm';
const docs = 'docs/ship-deck-art/storm';
const read = p => PNG.sync.read(fs.readFileSync(p));
const source = id => read(`${docs}/source/${id}.png`);
const blank = (w,h) => new PNG({width:w,height:h});
const put = (p,x,y,c) => { if(x>=0&&x<p.width&&y>=0&&y<p.height) p.data.set(c,(y*p.width+x)*4); };
const pixel = (p,x,y) => [...p.data.subarray((y*p.width+x)*4,(y*p.width+x)*4+4)];
const hex = c => '#'+c.slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();
const rgb = h => [1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const waterPalette = ['#151E2D','#182B47','#1D314E','#22395A','#2C4869','#45617A','#536E87','#64849A','#8FA8B4','#A8B9BD','#BECAC6','#D9D4BE'].map(rgb);
const cloudPalette = ['#1D314E','#45617A','#7795A5'].map(rgb);
const sprayPalette = ['#536E87','#8FA8B4','#BECAC6','#D9D4BE'].map(rgb);
const lightningPalette = ['#64849A','#8FA8B4','#BECAC6','#D9D4BE'].map(rgb);
const skyPalette = ['#1D314E','#2C4869','#45617A','#536E87','#64849A','#7795A5','#8FA8B4','#A8B9BD'].map(rgb);
const nearest = (c,pal) => pal.reduce((a,b)=>dist(c,a)<=dist(c,b)?a:b);
const dist = (a,b) => a.slice(0,3).reduce((s,v,i)=>s+(v-b[i])**2,0);
const median = a => a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
function bounds(p,rect=[0,0,p.width,p.height],threshold=192) {
  let x0=p.width,y0=p.height,x1=-1,y1=-1;
  for(let y=rect[1];y<rect[1]+rect[3];y++)for(let x=rect[0];x<rect[0]+rect[2];x++){
    if(p.data[(y*p.width+x)*4+3]>=threshold){x0=Math.min(x,x0);y0=Math.min(y,y0);x1=Math.max(x,x1);y1=Math.max(y,y1);}
  }
  return [x0,y0,x1-x0+1,y1-y0+1];
}
// Block median; majority coverage gives hard binary alpha; no dithering.
function sample(p,rect,w,h,pal,threshold=192,clip=[0,0,p.width,p.height]) {
  const out=blank(w,h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const channels=[[],[],[]];let total=0,n=0;
    for(let sy=Math.floor(rect[1]+y*rect[3]/h);sy<Math.floor(rect[1]+(y+1)*rect[3]/h);sy++)
      for(let sx=Math.floor(rect[0]+x*rect[2]/w);sx<Math.floor(rect[0]+(x+1)*rect[2]/w);sx++){
        total++;
        if(sx<clip[0]||sy<clip[1]||sx>=clip[0]+clip[2]||sy>=clip[1]+clip[3]||sx<0||sy<0||sx>=p.width||sy>=p.height)continue;
        const c=pixel(p,sx,sy);if(c[3]<threshold)continue;
        n++;for(let i=0;i<3;i++)channels[i].push(c[i]);
      }
    if(n&&n>=total*.5)put(out,x,y,[...nearest(channels.map(median),pal),255]);
  }
  return out;
}
function paste(dst,src,ox,oy,opacity=1){
  for(let y=0;y<src.height;y++)for(let x=0;x<src.width;x++){
    if(x+ox<0||y+oy<0||x+ox>=dst.width||y+oy>=dst.height)continue;
    const a=pixel(src,x,y),b=pixel(dst,x+ox,y+oy),alpha=a[3]/255*opacity;
    if(!alpha)continue;
    const outA=alpha+b[3]/255*(1-alpha);
    put(dst,x+ox,y+oy,[...a.slice(0,3).map((v,i)=>Math.round((v*alpha+b[i]*b[3]/255*(1-alpha))/outA)),Math.round(outA*255)]);
  }
}
function clearBorder(p,n=2){for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++)if(x<n||y<n||x>=p.width-n||y>=p.height-n)put(p,x,y,[0,0,0,0]);}
function repeatEdges(p,pal){
  // Reconcile opposite pairs, fading into generated pixels over 8 columns / 6 rows.
  for(const [axis,width] of [['x',8],['y',6]]){
    const count=axis==='x'?p.height:p.width, span=axis==='x'?p.width:p.height;
    for(let t=0;t<count;t++)for(let d=0;d<width;d++){
      const a=axis==='x'?[d,t]:[t,d],b=axis==='x'?[span-1-d,t]:[t,span-1-d];
      const ca=pixel(p,...a),cb=pixel(p,...b),strength=(1-d/width)/2;
      put(p,...a,[...nearest(ca.slice(0,3).map((v,i)=>v*(1-strength)+cb[i]*strength),pal),255]);
      put(p,...b,[...nearest(cb.slice(0,3).map((v,i)=>v*(1-strength)+ca[i]*strength),pal),255]);
    }
  }
}
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const recipes=[];
const outputs=[];
// Lossless indexed PNG packing: same RGBA pixels, no quantization at this stage.
function indexed(p){
  const colours=[],lookup=new Map(),rows=Buffer.alloc((p.width+1)*p.height);
  for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++){
    const c=pixel(p,x,y),key=c.join(',');
    if(!lookup.has(key)){lookup.set(key,colours.length);colours.push(c);}
    rows[y*(p.width+1)+x+1]=lookup.get(key);
  }
  if(colours.length>256)throw Error('Too many colours');
  function chunk(type,data){
    const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);
    let crc=0xffffffff;for(const v of b.subarray(4,-4)){crc^=v;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    b.writeUInt32BE((crc^0xffffffff)>>>0,b.length-4);return b;
  }
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(p.width,0);ihdr.writeUInt32BE(p.height,4);ihdr[8]=8;ihdr[9]=3;
  const result=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('PLTE',Buffer.from(colours.flatMap(c=>c.slice(0,3)))),chunk('tRNS',Buffer.from(colours.map(c=>c[3]))),chunk('IDAT',deflateSync(rows,{level:9})),chunk('IEND',Buffer.alloc(0))]);
  if(!PNG.sync.read(result).data.equals(p.data))throw Error('Indexed encode changed pixels');
  return result;
}
function write(p,name,recipe){const dest=`${root}/${name}`;fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,indexed(p));outputs.push(name);if(recipe)recipes.push({path:name,...recipe});}
function saveReview(p,name){fs.mkdirSync(`${docs}/review`,{recursive:true});fs.writeFileSync(`${docs}/review/${name}`,PNG.sync.write(p));}
function scale(p,n){const out=blank(p.width*n,p.height*n);for(let y=0;y<out.height;y++)for(let x=0;x<out.width;x++)put(out,x,y,pixel(p,Math.floor(x/n),Math.floor(y/n)));return out;}
const seaSource=source('sea');
const seas=[];
for(let i=0;i<4;i++){
  const rect=[Math.floor(i%2*seaSource.width/2),Math.floor(Math.floor(i/2)*seaSource.height/2),Math.floor(seaSource.width/2),Math.floor(seaSource.height/2)];
  const p=sample(seaSource,rect,256,128,waterPalette,128);repeatEdges(p,waterPalette);seas.push(p);
  write(p,`sea/frame-${i}.png`,{source:'sea',rect,sampling:'256x128 block median; opaque; opposing edge reconcile 8 columns / 6 rows'});
}
const cloudSizes={'wisp':[44,12],'puff':[36,14],'cumulus':[62,21],'long-bank':[92,25],'twin-bank':[80,24]};
for(const [id,[w,h]] of Object.entries(cloudSizes)){
  const src=source(id),rect=bounds(src),p=blank(w,h);paste(p,sample(src,rect,w-4,h-4,cloudPalette),2,2);
  write(p,`clouds/${id}.png`,{source:id,rect,sampledSize:[w-4,h-4],offset:[2,2],palette:cloudPalette.map(hex)});
}
const wakeSource=source('wake');
const wakeAnchors=[[50,87],[50,527],[50,973]];
const wakeRegions=[[0,0,1145,475],[0,475,1145,455],[0,930,1145,444]];
for(let i=0;i<3;i++){
  const a=wakeAnchors[i],rect=[a[0]-8*4.8,a[1]-8*4.8,240*4.8,96*4.8];
  const p=sample(wakeSource,rect,240,96,waterPalette,192,wakeRegions[i]);clearBorder(p);
  write(p,`wake/frame-${i}.png`,{source:'wake',rect,clip:wakeRegions[i],sourceAnchor:a,outputAnchor:[8,8],sourcePixelsPerLogicalPixel:4.8,clearBorder:2});
}
// The source sheet's lower row sits higher within its cells. Register the crest base,
// rather than independently resizing each pose (which would make droplets change scale).
const spraySource=source('spray');
const sprayBases=[[320,398],[1160,398],[320,789],[1160,789]];
for(let i=0;i<4;i++){
  const a=sprayBases[i],rect=[a[0]-20*12,a[1]-26*12,64*12,32*12];
  const p=sample(spraySource,rect,64,32,sprayPalette);clearBorder(p);
  write(p,`spray/frame-${i}.png`,{source:'spray',rect,sourceAnchor:a,outputAnchor:[20,26],sourcePixelsPerLogicalPixel:12,clearBorder:2});
}
const lightningSource=source('lightning');
for(let i=0;i<2;i++){
  // Uniform scale preserves the thin fork. Identical registration of top endpoint.
  const a=[i===0?394:1043,82],s=23.3,rect=[a[0]-16*s,a[1]-4*s,32*s,48*s];
  const p=sample(lightningSource,rect,32,48,lightningPalette);clearBorder(p);
  write(p,`lightning/frame-${i}.png`,{source:'lightning',rect,sourceAnchor:a,outputAnchor:[16,4],sourcePixelsPerLogicalPixel:s,clearBorder:2});
}
// Register sky bands to the calm geometry: median generated colour for each original
// pixel colour-region, then exact palette mapping. This is tonal transfer, not painting.
const skySrc=source('sky'),skySample=sample(skySrc,[0,0,skySrc.width,skySrc.height],512,320,skyPalette,128);
const calmSky=read('art/settings/ship/sky/midday.png'),groups=new Map();
for(let y=0;y<320;y++)for(let x=0;x<512;x++){
  const k=hex(pixel(calmSky,x,y));if(!groups.has(k))groups.set(k,[[],[],[]]);
  const c=pixel(skySample,x,y);for(let i=0;i<3;i++)groups.get(k)[i].push(c[i]);
}
const mapping=Object.fromEntries([...groups].map(([k,v])=>[k,nearest(v.map(median),skyPalette)]));
const sky=blank(512,320);for(let y=0;y<320;y++)for(let x=0;x<512;x++)put(sky,x,y,[...mapping[hex(pixel(calmSky,x,y))],255]);
write(sky,'sky/overcast.png',{source:'sky',geometry:'../sky/midday.png',colourRegionMap:Object.fromEntries(Object.entries(mapping).map(([k,v])=>[k,hex(v)]))});
fs.writeFileSync(`${docs}/cleanup.json`,JSON.stringify({alphaThreshold:192,coverageThreshold:0.5,sampling:'block median; nearest RGB palette; no dithering; zero RGB for alpha 0',recipes},null,2)+'\n');
// Contact/repeat/composite renders are review artifacts, never runtime payload.
const contact=blank(1024,800);for(let y=0;y<800;y++)for(let x=0;x<1024;x++)put(contact,x,y,y>=250&&y<335?[143,168,180,255]:[29,49,78,255]);
seas.forEach((p,i)=>paste(contact,p,i*256,0));
for(let i=0;i<3;i++)paste(contact,read(`${root}/wake/frame-${i}.png`),i*250,145);
Object.keys(cloudSizes).forEach((id,i)=>paste(contact,scale(read(`${root}/clouds/${id}.png`),2),i*200,270));
for(let i=0;i<4;i++)paste(contact,scale(read(`${root}/spray/frame-${i}.png`),2),i*170,350);
for(let i=0;i<2;i++)paste(contact,scale(read(`${root}/lightning/frame-${i}.png`),2),740+i*90,350);
paste(contact,sky,0,450);saveReview(contact,'contact.png');
const tiled=blank(512,256);for(let y=0;y<2;y++)for(let x=0;x<2;x++)paste(tiled,seas[0],x*256,y*128);saveReview(scale(tiled,2),'sea-repeat-2x.png');
const deck=read('art/settings/ship/deck.png');const hull=blank(426,161);for(let y=0;y<161;y++)for(let x=0;x<426;x++)put(hull,x,y,pixel(deck,x,y));
function scene(intensity,phase=0){
  const out=blank(768,384),hullX=70,hullY=83,horizon=hullY+96,waterline=hullY+151;
  // Fixed review camera; original sky pixels above its source horizon row 213.
  for(let y=0;y<horizon;y++)for(let x=0;x<768;x++){
    const sx=Math.min(511,Math.floor(x*512/768)),sy=Math.max(0,Math.min(319,y+213-horizon));
    const c=pixel(calmSky,sx,sy),s=pixel(sky,sx,sy),w=intensity*.7;
    put(out,x,y,[...c.slice(0,3).map((v,i)=>Math.round(v*(1-w)+s[i]*w)),255]);
  }
  const cloudIds=Object.keys(cloudSizes);
  cloudIds.forEach((id,i)=>{const c=read(`art/settings/ship/clouds/${id}.png`),s=read(`${root}/clouds/${id}.png`);const merged=blank(c.width,c.height);paste(merged,c,0,0,1-intensity);paste(merged,s,0,0,intensity);paste(out,merged,30+i*145,25+(i%3)*28);});
  const calm=read(`art/settings/ship/water/sea/frame-${phase%4}.png`),storm=seas[phase%4];
  function water(start){for(let y=start;y<384;y++)for(let x=0;x<768;x++){const a=pixel(calm,x%256,(y-horizon)%128),b=pixel(storm,x%256,(y-horizon)%128);put(out,x,y,[...a.slice(0,3).map((v,i)=>Math.round(v*(1-intensity)+b[i]*intensity)),255]);}}
  water(horizon);paste(out,hull,hullX,hullY);water(waterline);
  paste(out,read(`art/settings/ship/water/wake/frame-${phase%3}.png`),hullX+384,hullY+143,1-intensity);
  paste(out,read(`${root}/wake/frame-${phase%3}.png`),hullX+384,hullY+143,intensity);
  const foam=read(`art/settings/ship/water/foam/frame-${phase%3}.png`);
  for(let y=0;y<16;y++)for(let x=68;x<392;x++){const c=pixel(foam,x%256,y);if(c[3])put(out,hullX+x,hullY+142+y,c);}
  if(intensity>0){paste(out,read(`${root}/spray/frame-${phase%4}.png`),hullX+68-20,waterline-26,intensity*.65);paste(out,read(`${root}/spray/frame-${phase%4}.png`),580,310,intensity*.6);}
  return out;
}
const comparison=blank(768,384*3);[0,.5,1].forEach((a,i)=>paste(comparison,scene(a),0,i*384));saveReview(comparison,'calm-blend-storm.png');
for(let i=0;i<4;i++)saveReview(scene(1,i),`storm-phase-${i}.png`);
function apng(images,durations,name){
  function chunk(type,data){const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);let crc=0xffffffff;for(const v of b.subarray(4,-4)){crc^=v;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}b.writeUInt32BE((crc^0xffffffff)>>>0,b.length-4);return b;}
  const header=Buffer.alloc(13);header.writeUInt32BE(images[0].width,0);header.writeUInt32BE(images[0].height,4);header[8]=8;header[9]=6;
  const actl=Buffer.alloc(8);actl.writeUInt32BE(images.length,0);actl.writeUInt32BE(0,4);
  const chunks=[Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('acTL',actl)];let seq=0;
  images.forEach((p,i)=>{
    const ctrl=Buffer.alloc(26);ctrl.writeUInt32BE(seq++,0);ctrl.writeUInt32BE(p.width,4);ctrl.writeUInt32BE(p.height,8);ctrl.writeUInt16BE(durations[i%durations.length],20);ctrl.writeUInt16BE(1000,22);
    chunks.push(chunk('fcTL',ctrl));const rows=Buffer.alloc((p.width*4+1)*p.height);for(let y=0;y<p.height;y++)p.data.copy(rows,y*(p.width*4+1)+1,y*p.width*4,(y+1)*p.width*4);
    const compressed=deflateSync(rows,{level:9});
    if(i===0)chunks.push(chunk('IDAT',compressed));else{const data=Buffer.alloc(compressed.length+4);data.writeUInt32BE(seq++,0);compressed.copy(data,4);chunks.push(chunk('fdAT',data));}
  });chunks.push(chunk('IEND',Buffer.alloc(0)));fs.writeFileSync(`${docs}/review/${name}`,Buffer.concat(chunks));
}
apng(Array.from({length:12},(_,i)=>scene(1,i)),[240],'storm-cycle.png');
apng(seas,[240],'sea-cycle.png');
apng(Array.from({length:3},(_,i)=>read(`${root}/wake/frame-${i}.png`)),[240],'wake-cycle.png');
apng([...Array.from({length:4},(_,i)=>read(`${root}/spray/frame-${i}.png`)),blank(64,32)],[120,120,120,120,1800],'spray-cycle.png');
apng([read(`${root}/lightning/frame-0.png`),read(`${root}/lightning/frame-1.png`),blank(32,48)],[80,120,18000],'lightning-cycle.png');
const reviewSources=JSON.parse(fs.readFileSync(`${docs}/prompts.json`,'utf8'));
fs.writeFileSync(`${docs}/provenance.json`,JSON.stringify({tool:'image_gen__imagegen (built-in)',backendModel:'not disclosed by tool',date:'2026-10-15',calls:reviewSources.length,sourceRoot:docs,sourceImages:reviewSources.map(r=>({id:r.id,path:r.source,sha256:sha(`${docs}/${r.source}`)})),prompts:'prompts.json',cleanup:'cleanup.json',references:['art/settings/ship/deck.png','docs/ship-deck-art/legacy/environment.json','docs/ship-deck-art/water/review/contact.png','docs/ship-deck-art/clouds/review/contact-3x.png','art/settings/ship/sky/midday.png'].map(p=>({path:p,sha256:sha(p)})),authorship:'Generated artwork; mechanical crop, registration, block sampling, alpha cleanup, fixed palette mapping, seam reconciliation and sky colour-region registration. No shapes drawn in code.',license:'Repository MIT; AI-generated, no claim of human authorship or exclusive copyright; no third-party reference art.'},null,2)+'\n');
console.log(JSON.stringify({runtimeFiles:outputs.length,runtimePngBytes:outputs.reduce((s,p)=>s+fs.statSync(`${root}/${p}`).size,0),outputs},null,2));
