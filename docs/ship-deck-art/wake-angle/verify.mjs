import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../../..');
const read=p=>fs.readFileSync(path.resolve(root,p));
const json=p=>JSON.parse(read(p));
const write=(p,v)=>fs.writeFileSync(path.resolve(root,p),JSON.stringify(v,null,2)+'\n');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const crc=b=>{let c=0xffffffff;for(const x of b){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
const u32=v=>{const b=Buffer.alloc(4);b.writeUInt32BE(v);return b;};
const chunk=(name,data)=>{const body=Buffer.concat([Buffer.from(name),data]);return Buffer.concat([u32(data.length),body,u32(crc(body))]);};
function png(p){
  const b=read(p), chunks=[]; let pos=8;
  while(pos<b.length){const n=b.readUInt32BE(pos),name=b.toString('ascii',pos+4,pos+8),data=b.subarray(pos+8,pos+8+n);assert.equal(crc(b.subarray(pos+4,pos+8+n)),b.readUInt32BE(pos+8+n));chunks.push({name,data});pos+=12+n;}
  const h=chunks[0].data,w=h.readUInt32BE(0),height=h.readUInt32BE(4),type=h[9],channels=type===6?4:type===2?3:0;
  assert.equal(h[8],8);assert.ok(channels);assert.equal(h[12],0);
  const raw=zlib.inflateSync(Buffer.concat(chunks.filter(c=>c.name==='IDAT').map(c=>c.data))),stride=w*channels,out=Buffer.alloc(w*height*4);assert.equal(raw.length,(stride+1)*height);
  let prev=Buffer.alloc(stride),offset=0;
  for(let y=0;y<height;y++){
    const filter=raw[offset++],row=Buffer.alloc(stride);
    for(let x=0;x<stride;x++){
      const a=x>=channels?row[x-channels]:0,b=prev[x],c=x>=channels?prev[x-channels]:0;let predict=0;
      if(filter===1)predict=a;if(filter===2)predict=b;if(filter===3)predict=Math.floor((a+b)/2);
      if(filter===4){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);predict=pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
      assert.ok(filter<=4);row[x]=(raw[offset++]+predict)&255;
    }
    for(let x=0;x<w;x++){const d=(y*w+x)*4,s=x*channels;out[d]=row[s];out[d+1]=row[s+1];out[d+2]=row[s+2];out[d+3]=channels===4?row[s+3]:255;}
    prev=row;
  }
  return {w,h:height,data:out,chunks,sha256:hash(b)};
}
function apng(files,dest){
  const frames=files.map(png),parts=[read(files[0]).subarray(0,8),chunk('IHDR',frames[0].chunks[0].data),chunk('acTL',Buffer.concat([u32(frames.length),u32(0)]))];let seq=0;
  frames.forEach((f,i)=>{
    assert.equal(f.w,frames[0].w);assert.equal(f.h,frames[0].h);
    const control=Buffer.alloc(26);control.writeUInt32BE(seq++);control.writeUInt32BE(f.w,4);control.writeUInt32BE(f.h,8);control.writeUInt16BE(240,20);control.writeUInt16BE(1000,22);
    parts.push(chunk('fcTL',control));
    const data=Buffer.concat(f.chunks.filter(c=>c.name==='IDAT').map(c=>c.data));parts.push(i===0?chunk('IDAT',data):chunk('fdAT',Buffer.concat([u32(seq++),data])));
  });parts.push(chunk('IEND',Buffer.alloc(0)));fs.writeFileSync(path.resolve(root,dest),Buffer.concat(parts));
  const saved=png(dest);assert.equal(saved.chunks.filter(c=>c.name==='fcTL').length,frames.length);
  const payloads=saved.chunks.filter(c=>c.name==='IDAT'||c.name==='fdAT');
  payloads.forEach((c,i)=>assert.deepEqual(zlib.inflateSync(c.name==='fdAT'?c.data.subarray(4):c.data),zlib.inflateSync(Buffer.concat(frames[i].chunks.filter(v=>v.name==='IDAT').map(v=>v.data)))));
  assert.equal(saved.chunks.find(c=>c.name==='acTL').data.readUInt32BE(4),0);
}
const base='docs/ship-deck-art/wake-angle',manifestPath='docs/ship-deck-art/water/manifest.json';
const m=json(manifestPath),palette=new Set(m.palette.colours),runtime=json('art/ship-deck/extras.json').water;
const records=[];
function stats(p){
  const f=png(p),colours=new Set(),alpha=new Set();let minx=f.w,miny=f.h,maxx=-1,maxy=-1,opaque=0;
  for(let y=0;y<f.h;y++)for(let x=0;x<f.w;x++){
    const k=(y*f.w+x)*4,a=f.data[k+3];alpha.add(a);assert.ok(a===0||a===255);
    if(a===0){assert.equal(f.data.readUInt32BE(k),0);continue;}
    const colour='#'+f.data.subarray(k,k+3).toString('hex').toUpperCase();assert.ok(palette.has(colour));colours.add(colour);opaque++;minx=Math.min(x,minx);maxx=Math.max(x,maxx);miny=Math.min(y,miny);maxy=Math.max(y,maxy);
  }
  return {path:p,size:[f.w,f.h],sha256:f.sha256,palette:[...colours].sort(),alpha:[...alpha].sort((a,b)=>a-b),opaquePixels:opaque,bounds:[minx,miny,maxx+1,maxy+1],paletteSubset:true,transparentRgbZero:true};
}
for(const kind of ['sea','foam','wake']){
  const spec=m.assets[kind],served=runtime[kind];assert.deepEqual(spec.size,served.frameSize);assert.equal(spec.frameMs,served.frameMs);assert.equal(spec.count,served.frames.length);
  for(const [i,p] of served.frames.entries()){
    assert.equal(p,'water/'+spec.frames[i].path);const s=stats('art/ship-deck/'+p);assert.deepEqual(s.size,spec.size);records.push(s);
    if(kind==='wake'){assert.ok(s.bounds[0]>0&&s.bounds[1]>0&&s.bounds[2]<240&&s.bounds[3]<96);spec.frames[i].sha256=s.sha256;spec.frames[i].palette=s.palette;}
    else assert.equal(s.sha256,spec.frames[i].sha256);
  }
}
assert.deepEqual(runtime.wake.anchor,[8,8]);assert.deepEqual(runtime.wake.position,[392,151]);assert.deepEqual(m.placement.wake.anchor,runtime.wake.anchor);assert.deepEqual(m.placement.wake.worldAnchor,runtime.wake.position);assert.deepEqual(m.placement.wake.topLeft,[384,143]);
const files=runtime.wake.frames.map(p=>'art/ship-deck/'+p),frames=files.map(png),old=[0,1,2].map(i=>png(`${base}/before/frame-${i}.png`));
const strip=png('docs/ship-deck-art/water/wake/strip.png');
for(let i=0;i<3;i++)for(let y=0;y<96;y++)for(let x=0;x<240;x++)assert.equal(frames[i].data.readUInt32BE((y*240+x)*4),strip.data.readUInt32BE((y*720+x+i*240)*4));
for(let i=1;i<3;i++)for(let y=0;y<96;y++)for(let x=0;x<20;x++)assert.equal(frames[0].data.readUInt32BE((y*240+x)*4),frames[i].data.readUInt32BE((y*240+x)*4));
function delta(a,b){let n=0,alpha=0;for(let k=0;k<a.data.length;k+=4){if(a.data.readUInt32BE(k)!==b.data.readUInt32BE(k))n++;if(a.data[k+3]!==b.data[k+3])alpha++;}return {changedPixels:n,changedCanvasPercent:+(100*n/23040).toFixed(2),alphaChangedPixels:alpha};}
function angle(f){let sum=0,count=0;for(let x=160;x<=195;x++){for(let y=0;y<96;y++){const k=(y*240+x)*4;if(f.data[k+3]===255){sum+=Math.atan2(y-8,x-8)*180/Math.PI;count++;break;}}}return +(sum/count).toFixed(2);}
const angles={method:'Mean angle from fixed anchor (8,8) to first opaque pixel in columns 160..195; positive is down-right on screen.',before:old.map(angle),after:frames.map(angle)};
for(let i=0;i<3;i++)assert.ok(angles.after[i]>angles.before[i]+5);
apng(files,`${base}/review/wake-cycle.png`);apng([0,1,2].map(i=>`${base}/review/hull-fit-${i}.png`),`${base}/review/hull-fit-cycle.png`);
const selected=['04-contact.png','07-phase1-quiet.png','08-phase2-quiet.png'];
const sources=fs.readdirSync(path.join(here,'source')).sort().map((name,i)=>({path:'source/'+name,promptIndex:i,sha256:hash(fs.readFileSync(path.join(here,'source',name))),selectedFrame:selected.includes(name)?selected.indexOf(name):null}));
write(`${base}/provenance.json`,{tool:'image_gen__imagegen',calls:8,backendModel:'Not disclosed by built-in tool',date:'2026-10-15',prompts:'prompts.json',sources,referenceChain:[[`${base}/before/frame-0.png`,'art/ship-deck/water/foam/frame-0.png','docs/ship-deck-art/water/review/hull-fit-2x.png'],['source/01-angle.png'],['source/02-thin.png',`${base}/before/frame-0.png`],['source/03-detail.png'],['source/04-contact.png'],['source/04-contact.png','source/05-phase1.png'],['source/04-contact.png','source/05-phase1.png'],['source/04-contact.png','source/07-phase1-quiet.png']],mechanicalPreparation:'prepare.ps1: identical uniform 8.2:1 block median sampling, source origin (8,40); alpha >=192 with majority coverage, exact original wake palette, transparent RGB zero. Generated phase-zero first 20 columns locked across phases. No drawn, rotated, sheared or procedurally synthesized trail geometry.',upstreamSeaAndFoamProvenance:'../water/provenance.json'});
const validation={date:'2026-10-15',scope:'All ten current water PNGs decoded and checked; sea and foam hashes unchanged. Offline hull previews, no install or live runtime test.',assets:records,angle:angles,animation:[0,1,2].map(i=>({from:i,to:(i+1)%3,...delta(frames[i],frames[(i+1)%3])})),checks:{frameCount:3,size:[240,96],anchor:[8,8],worldAnchor:[392,151],topLeft:[384,143],frameMs:240,loopMs:720,allWakeBordersTransparent:true,contactFirst20ColumnsIdentical:true,stripMatchesFrames:true,binaryAlpha:true,exactPalette:true,transparentRgbZero:true,seaAndFoamUnchanged:true,runtimeManifestMatches:true,apngCrcsAndDecodedFramesMatch:true},review:['review/before-after-3x.png','review/hull-fit-2x.png','review/wake-cycle.png','review/hull-fit-cycle.png'],limitation:'Generated local foam details differ from the old trail. Narrower disturbed-water wedge and slightly finer foam; subtle shimmer rather than physically advected fluid. Offline composite uses bare Hull C, no live-app claim.'};
write(`${base}/verification.json`,validation);
m.assets.wake.stripSha256=strip.sha256;m.assets.wake.verdict='usable';m.assets.wake.limitation=validation.limitation;
m.assets.wake.angleRevision={date:'2026-10-15',note:'Regenerated steeper down-right flow, unchanged 3 frames, 240x96 canvas, names, anchor, placement and 240ms timing.',measurement:angles,provenance:'../wake-angle/provenance.json'};
m.placement.wake.direction='Steeper V opens right and down aft of left-moving hull; far ridge approximately 16 degrees down-right, previously approximately 7 degrees.';
m.placement.wake.contactOverlap='Compact fixed contact knot overlaps the nominal waterline; first 20 columns are identical across phases. Keep the unchanged anchor (8,8), world (392,151).';
m.cleanup.wake={sources:selected.map(s=>'../wake-angle/source/'+s),cropOrigin:[8,40],uniformSourcePixelsPerOutputPixel:8.2,output:[240,96],registration:'Same crop and uniform sample scale for all three frames; generated frame-zero first 20 columns held fixed. No rotations, shears or drawn geometry.',preparation:'../wake-angle/prepare.ps1'};
m.verification='../wake-angle/verification.json';m.provenance='../wake-angle/provenance.json';
m.review.static=['../wake-angle/review/before-after-3x.png','review/sea-repeat-2x2.png','../wake-angle/review/hull-fit-2x.png'];
m.review.animated=['review/sea-cycle.png','review/foam-cycle.png','../wake-angle/review/wake-cycle.png','review/sea-repeat-cycle.png','../wake-angle/review/hull-fit-cycle.png'];
write(manifestPath,m);console.log(JSON.stringify({angle:angles,animation:validation.animation,checks:validation.checks},null,2));
