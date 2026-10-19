/** Check the delivered pixels against the existing pack contract and record provenance. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../../test/png.ts';

const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../..');
const configs=JSON.parse(readFileSync(resolve(here,'settings.json')));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=file=>{const bytes=readFileSync(file),image=decodePng(bytes);return {path:relative(here,file).replaceAll('\\','/'),size:[image.width,image.height],sha256:sha(bytes),bytes:bytes.length};};
const report=[],sources=[],runtime=[],references=[];
const hex=(r,g,b)=>'#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();
for(const config of configs) {
  const folder=resolve(here,'output',config.id),m=JSON.parse(readFileSync(resolve(folder,'manifest.json')));
  const packBytes=readFileSync(resolve(root,m.sourcePack.path)),pack=JSON.parse(packBytes);
  assert.equal(sha(packBytes),m.sourcePack.sha256,'source pack changed');
  assert.deepEqual(m.lane,pack.cast.lanes[config.lane],'lane rectangles and feet must be byte-for-byte equivalent data');
  assert.deepEqual(m.roles,pack.cast.roles,'pose roles stay unchanged');
  assert.deepEqual(m.breath,pack.cast.breath??null,'breath rows stay unchanged');
  assert.equal(sha(readFileSync(resolve(root,m.reference.path))),m.reference.sha256,'reference image changed');
  const sourceFile=resolve(here,'sources',config.id+'.png'),source=decodePng(readFileSync(sourceFile));
  assert(source.rgba.some((v,i)=>i%4===3&&v===0),'generated source must have real transparent alpha');
  sources.push({...record(sourceFile),setting:config.id,sourceGrid:config.sourceGrid});
  references.push({...record(resolve(root,m.reference.path)),setting:config.id});
  const palette=new Set(m.palette.colours),summaries=[],allowed=new Set();
  if(config.paletteRecord)for(const colour of JSON.parse(readFileSync(resolve(root,config.paletteRecord))).palette.colours)allowed.add(colour);
  else for(const look of pack.cast.looks){const a=decodePng(readFileSync(resolve(root,'art/settings',config.id,pack.images[look.image].path)));for(let i=0;i<a.rgba.length;i+=4)if(a.rgba[i+3])allowed.add(hex(...a.rgba.subarray(i,i+3)));}
  for(const colour of palette)assert(allowed.has(colour),'palette colour not found in the existing pack: '+colour);
  assert(palette.size<=(config.paletteRecord?64:32),'fixed palette cap');
  let atlas;
  for(const [name,declared]of Object.entries(m.images)) {
    const file=resolve(folder,name),bytes=readFileSync(file),a=decodePng(bytes),colours=new Set(),alphas=new Set();
    assert.deepEqual([a.width,a.height],declared.size,name+' dimensions');
    assert.equal(sha(bytes),declared.sha256,name+' hash');
    for(let i=0;i<a.rgba.length;i+=4){const alpha=a.rgba[i+3];alphas.add(alpha);
      assert(alpha===0||alpha===config.alpha,name+' alpha');
      if(alpha===0)assert.deepEqual(Array.from(a.rgba.subarray(i,i+3)),[0,0,0],name+' transparent RGB');
      else {const colour=hex(...a.rgba.subarray(i,i+3));assert(palette.has(colour),name+' palette '+colour);colours.add(colour);}
    }
    assert(alphas.has(0)&&alphas.has(config.alpha),name+' nonempty silhouette and transparent margin');
    runtime.push({...record(file),setting:config.id,colours:colours.size,alpha:[...alphas].sort((a,b)=>a-b)});
    if(name==='firstmate.png')atlas=a;
  }
  assert.deepEqual([atlas.width,atlas.height],pack.images[config.referenceImage].size,'native atlas size');
  const coverage=new Uint8Array(atlas.width*atlas.height),poseHashes=new Map();
  for(const [name,{rect,feet}]of Object.entries(m.lane)) {
    const [x0,y0,w,h]=rect;
    assert(x0>=0&&y0>=0&&x0+w<=atlas.width&&y0+h<=atlas.height,name+' frame grid');
    assert(feet[0]>=0&&feet[0]<=w&&feet[1]>=0&&feet[1]<=h,name+' feet');
    let painted=0,bottom=-1;const pixels=[];
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const at=(y0+y)*atlas.width+x0+x;coverage[at]=1;
      const px=Array.from(atlas.rgba.subarray(at*4,at*4+4));pixels.push(...px);
      if(px[3]){painted++;bottom=Math.max(bottom,y);}
    }
    assert(painted>25,name+' nonempty pose');
    assert.equal(bottom,feet[1]-1,name+' sole/wisp baseline at inherited feet');
    const digest=sha(Buffer.from(pixels));poseHashes.set(name,digest);
    summaries.push({name,rect,feet,paintedPixels:painted,bottomRow:bottom,sha256:digest});
  }
  for(let i=0;i<coverage.length;i++)if(!coverage[i])assert.equal(atlas.rgba[i*4+3],0,'paint outside existing lane rectangles');
  // Distinct source poses survive reduction, including front/side walks and ladder cycle.
  for(const names of [m.roles.walkFront,m.roles.walkSide,m.poses.filter(p=>p.name.startsWith('climb')).map(p=>p.name)]) {
    const unique=[...new Set(names)];assert.equal(new Set(unique.map(n=>poseHashes.get(n))).size,unique.length,'collapsed animation frames');
  }
  const directions=decodePng(readFileSync(resolve(folder,m.standing.image))),[,,w,h]=m.standing.right.rect;
  assert.deepEqual(m.standing.right.feet,m.lane[m.standing.sourcePose].feet);
  assert.deepEqual(m.standing.left.feet,[w-m.standing.right.feet[0],m.standing.right.feet[1]]);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)assert.equal(directions.at(x,y),directions.at(2*w-1-x,y),'left/right pixel mirror');
  const packBytesTotal=Object.values(pack.images).reduce((sum,img)=>sum+statSync(resolve(root,'art/settings',config.id,img.path)).size,0);
  const addedAtlasBytes=statSync(resolve(folder,'firstmate.png')).size;
  assert(packBytesTotal+addedAtlasBytes<=2_000_000,'future atlas registration exceeds serving budget');
  report.push({setting:config.id,lane:config.lane,nativeSize:[atlas.width,atlas.height],uniquePoses:m.poses.length,poseNames:summaries.length,
    standingDirections:2,raisedHand:!!m.raisedHand,paletteSize:palette.size,paintedAlpha:config.alpha,packBytesBefore:packBytesTotal,addedAtlasBytes,
    checks:['native dimensions and grid','identical lane/feet/roles/breath','all poses nonempty','sole/wisp baselines','no pixels outside lane','fixed existing palette','native alpha and zero transparent RGB','distinct walk/climb frames','left/right mirror and anchor','SHA-256 digests','future pack payload budget'],poses:summaries});
}
const promptRecord=JSON.parse(readFileSync(resolve(here,'prompts.json')));
const generationInputs=promptRecord.prompts.map(p=>({setting:p.setting,generatedFile:p.generatedFile,source:p.source,
  references:(p.references??[p.reference]).map(f=>record(resolve(root,f)))}));
const provenance={tool:'Built-in image_gen__imagegen (reference edits)',prompts:'prompts.json',normalization:'build.mjs',verification:'verify.mjs',sources,references,generationInputs,runtime,
  reviews:['contact-sheet.png','standing-comparison.png'].map(f=>record(resolve(here,f))),
  checks:report.map(({poses,...r})=>r),status:'Assets only. No runtime manifest, engine, layout or post changes.'};
writeFileSync(resolve(here,'provenance.json'),JSON.stringify(provenance,null,2)+'\n');
writeFileSync(resolve(here,'validation.json'),JSON.stringify({settings:report,review:'Visually inspected generated sources and nearest-neighbour contact/comparison sheets on dark and light backgrounds.'},null,2)+'\n');
console.log(JSON.stringify(report.map(({poses,...r})=>r),null,2));
