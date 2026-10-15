// Asset contract checks; no app/runtime changes. Run from repository root.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {PNG}=require('../../../.local/storm-tools/node_modules/pngjs');
const root='art/settings/ship/storm',docs='docs/ship-deck-art/storm';
const env=JSON.parse(fs.readFileSync('docs/ship-deck-art/legacy/environment.json','utf8'));
const palette=[...env.palette.deckColours,...env.palette.environmentExtension];
const manifest=JSON.parse(fs.readFileSync(`${docs}/manifest.json`,'utf8'));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read=p=>PNG.sync.read(fs.readFileSync(p));
const hex=c=>'#'+[...c].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();
const reports=[],framesById=new Map();
for(const group of manifest.assets){
  const frames=[];
  for(const file of group.frames){
    const full=`${root}/${file}`,p=read(full);frames.push(p);
    assert.deepEqual([p.width,p.height],group.frameSize,file+' dimensions');
    const colors=new Set(),alphas=new Set();let transparent=0,nonzeroTransparentRgb=0;
    let x0=p.width,y0=p.height,x1=-1,y1=-1;
    for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++){
      const i=(y*p.width+x)*4,a=p.data[i+3];alphas.add(a);
      if(a){const h=hex(p.data.subarray(i,i+3));colors.add(h);assert(palette.includes(h),file+' off-palette '+h);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
      else{transparent++;if(p.data[i]||p.data[i+1]||p.data[i+2])nonzeroTransparentRgb++;}
    }
    assert.deepEqual([...alphas].sort((a,b)=>a-b),group.alpha==='opaque'?[255]:[0,255],file+' alpha');
    assert.equal(nonzeroTransparentRgb,0,file+' transparent RGB');
    const rgba=(x,y)=>p.data.subarray((y*p.width+x)*4,(y*p.width+x)*4+4);
    const xEqual=Array.from({length:p.height},(_,y)=>rgba(0,y).equals(rgba(p.width-1,y))).every(Boolean);
    const yEqual=Array.from({length:p.width},(_,x)=>rgba(x,0).equals(rgba(x,p.height-1))).every(Boolean);
    if(group.tileAxes?.includes('x'))assert(xEqual,file+' horizontal repeat seam');
    if(group.tileAxes?.includes('y'))assert(yEqual,file+' vertical repeat seam');
    if(group.alpha==='binary')assert(x0>=2&&y0>=2&&x1<p.width-2&&y1<p.height-2,file+' clear border');
    let calmDimensionsMatch=null;
    if(group.calmFrames){const calm=read('art/settings/ship/'+group.calmFrames[group.frames.indexOf(file)]);assert.equal(calm.width,p.width);assert.equal(calm.height,p.height);calmDimensionsMatch=true;}
    reports.push({path:file,size:[p.width,p.height],bytes:fs.statSync(full).size,sha256:hash(full),paletteExact:true,colours:[...colors].sort(),alpha:[...alphas].sort((a,b)=>a-b),transparentPixels:transparent,transparentRgbZero:true,visibleBounds:[x0,y0,x1+1,y1+1],oppositeColumnsEqual:xEqual,oppositeRowsEqual:yEqual,calmDimensionsMatch});
  }
  framesById.set(group.id,frames);
}
const transitions=[];
for(const [id,frames] of framesById){
  if(frames.length<2)continue;
  const group=manifest.assets.find(a=>a.id===id);
  for(let f=0;f<(group.loop?frames.length:frames.length-1);f++){
    const a=frames[f],b=frames[(f+1)%frames.length];let changed=0,sum=0;
    for(let i=0;i<a.data.length;i+=4){if(!a.data.subarray(i,i+4).equals(b.data.subarray(i,i+4)))changed++;for(let c=0;c<3;c++)sum+=Math.abs(a.data[i+c]-b.data[i+c]);}
    assert(changed>0,id+' duplicate animation frame');
    transitions.push({id,from:f,to:(f+1)%frames.length,changedPixels:changed,changedFraction:changed/(a.width*a.height),meanAbsoluteRgbDifference:sum/(a.width*a.height*3)});
  }
}
assert.equal(reports.length,19);
const actual=fs.readdirSync(root,{recursive:true}).filter(p=>p.endsWith('.png')).map(p=>p.replaceAll('\\','/')).sort();
assert.deepEqual(actual,reports.map(r=>r.path).sort(),'Only declared runtime frames in shipped folder');
const prov=JSON.parse(fs.readFileSync(`${docs}/provenance.json`,'utf8'));
for(const src of prov.sourceImages)assert.equal(hash(`${docs}/${src.path}`),src.sha256);
const wakeAnchors=framesById.get('heavy-wake').map(p=>p.data[(8*p.width+8)*4+3]);assert(wakeAnchors.every(a=>a===255),'stern anchor is inside all heavy wake frames');
const summary={passed:true,runtimePngCount:reports.length,runtimePngBytes:reports.reduce((s,r)=>s+r.bytes,0),paletteSource:'docs/ship-deck-art/legacy/environment.json',paletteSize:palette.length,wakeAnchorOpaqueAllFrames:true,sourceHashesVerified:prov.sourceImages.length,checks:['exact dimensions and matching calm canvases','exact palette membership','binary/opaque alpha','zero transparent RGB','two-pixel transparent sprite border','sea opposing rows and columns equal','distinct cyclic phases including last-to-first','declared runtime files only','generated source hashes','opaque stern anchor'],assets:reports,transitions,visualReview:{staticContact:true,seaRepeat2x2:true,calmBlendStorm:true,allFourCompositePhases:true,runtimePluginTest:false,notes:'Generated sea/wake key poses morph; numeric edge equality does not establish fluid continuity. Visual repeat/composite inspection complements it.'}};
fs.writeFileSync(`${docs}/verification.json`,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({passed:true,runtimePngCount:summary.runtimePngCount,runtimePngBytes:summary.runtimePngBytes,transitions},null,2));
