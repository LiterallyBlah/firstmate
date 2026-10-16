/** Verify the generated raster contract; preview assembly never changes runtime pixels. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
const {PNG}=createRequire(resolve(root,'docs/board-list/package.json'))('pngjs');
const pack=resolve(root,'art/settings/ship');
const manifest=JSON.parse(readFileSync(resolve(pack,'setting.json'),'utf8'));
const palette=new Set(JSON.parse(readFileSync(resolve(here,'../water/manifest.json'),'utf8')).palette.colours);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=path=>PNG.sync.read(readFileSync(path));
const hex=(data,i)=>'#'+[...data.subarray(i,i+3)].map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase();
const generated=Object.entries(manifest.images).filter(([id])=>id.startsWith('polish-')||/^(water|storm)-sea-frame-/.test(id)||/^water-foam-frame-/.test(id)||['gull-flap-strip','sea-water-tile','sea-foam-strip'].includes(id));
const runtime=generated.map(([id,entry])=>{
  const bytes=readFileSync(resolve(pack,entry.path)),png=PNG.sync.read(bytes),colours=new Set();
  assert.deepEqual([png.width,png.height],entry.size,id);assert.equal(hash(bytes),entry.sha256,id);
  for(let i=0;i<png.data.length;i+=4){
    assert.ok(png.data[i+3]===0||png.data[i+3]===255,`${id}: binary alpha`);
    if(png.data[i+3]===0)assert.equal(png.data.readUInt32BE(i),0,`${id}: clear RGB`);
    else {const colour=hex(png.data,i);assert.ok(palette.has(colour),`${id}: palette ${colour}`);colours.add(colour);}
  }
  return {id,...entry,bytes:bytes.length,colours:colours.size};
});
for(const look of manifest.cast.looks){
  const frames=manifest.cast.lanes[look.lane],png=read(resolve(pack,manifest.images[look.image].path));
  assert.deepEqual([png.width,png.height],[128,160]);
  assert.equal(frames['front-idle'].rect[3],32);
  for(const [pose,frame] of Object.entries(frames)){
    const [x,y,w,h]=frame.rect;assert.ok(w<=30&&h<=36,`${look.id}/${pose}`);
    assert.equal(frame.feet[1],h);assert.ok(frame.feet[0]>0&&frame.feet[0]<=w);
    assert.ok(x>=0&&y>=0&&x+w<=128&&y+h<=160);
  }
  const distinct=poses=>new Set(poses.map(pose=>{
    const [x,y,w,h]=frames[pose].rect,out=new PNG({width:32,height:40});
    PNG.bitblt(png,out,x,y,w,h,Math.floor((32-w)/2),36-h);return hash(out.data);
  })).size;
  assert.equal(distinct(manifest.cast.roles.walkFront),4,`${look.id}: front cycle`);
  assert.equal(distinct(manifest.cast.roles.walkSide),4,`${look.id}: side cycle`);
  assert.equal(distinct(['climb-a','climb-b']),2,`${look.id}: climbing cycle`);
}
// Compare the join with ordinary adjacent columns/rows, then inspect the 2x2 tiling visually.
const seams=[];
for(const id of ['water-sea-frame-0','storm-sea-frame-0']){
  const png=read(resolve(pack,manifest.images[id].path));
  const distance=(a,b)=>[0,1,2].reduce((sum,c)=>sum+Math.abs(png.data[a+c]-png.data[b+c]),0)/3;
  let horizontal=0,vertical=0;
  for(let y=0;y<png.height;y++)horizontal+=distance(y*png.width*4,(y*png.width+png.width-1)*4);
  for(let x=0;x<png.width;x++)vertical+=distance(x*4,((png.height-1)*png.width+x)*4);
  seams.push({id,meanJoinRgbDistance:{horizontal:horizontal/png.height,vertical:vertical/png.width}});
  const tiled=new PNG({width:png.width*2,height:png.height*2});
  for(let y=0;y<2;y++)for(let x=0;x<2;x++)PNG.bitblt(png,tiled,0,0,png.width,png.height,x*png.width,y*png.height);
  writeFileSync(resolve(here,`${id}-tiled.png`),PNG.sync.write(tiled));
}
const sources=readdirSync(resolve(here,'source')).sort().map(file=>{
  const bytes=readFileSync(resolve(here,'source',file)),png=PNG.sync.read(bytes);
  return {path:`source/${file}`,size:[png.width,png.height],sha256:hash(bytes)};
});
assert.equal(sources.length,13);
const record={tool:'Built-in image_gen__imagegen (generation and reference edits)',prompts:'prompts.json',normalization:'build.mjs',sources,runtime,seams,
  checks:['all sizes and manifest SHA-256 digests match','binary alpha; zero transparent RGB; existing 64-colour palette','eight registered 128x160 atlases; standing height 32; pose height at most 36','four distinct frames per directional walk; two distinct climb poses for every look'],
  packPngBytes:Object.values(manifest.images).reduce((sum,image)=>sum+readFileSync(resolve(pack,image.path)).length,0)};
writeFileSync(resolve(here,'provenance.json'),JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({sources:sources.length,runtime:runtime.length,packPngBytes:record.packPngBytes,seams}));
