/** Evidence only: never masks or accepts a difference in the exact-hash gate. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../..');
const {PNG}=createRequire(resolve(root,'docs/board-list/package.json'))('pngjs');
const gate=JSON.parse(readFileSync(resolve(root,'docs/deck-settings/gate-results.json'),'utf8'));
assert.equal(gate.shots,81);assert.equal(gate.maskToolbar,false);assert.deepEqual(gate.pageErrors,[]);
assert.equal(gate.base,'compiled main dfecf41');
const before=JSON.parse(execFileSync('git',['show','dfecf41:art/settings/ship/setting.json'],{cwd:root,encoding:'utf8'}));
const after=JSON.parse(readFileSync(resolve(root,'art/settings/ship/setting.json'),'utf8'));
const unchangedSections=['floor','portals','effects','ambience','atmosphere','dayCycle','attentionCarrier','copy'];
for(const key of unchangedSections)assert.deepEqual(after[key],before[key],key);
const unchangedStage=['size','fit','backdrop','props','motion','lights','palette'];
for(const key of unchangedStage)assert.deepEqual(after.stage[key],before.stage[key],key);
const generated=new Set(JSON.parse(readFileSync(resolve(root,'docs/ship-deck-art/polish/provenance.json'),'utf8')).runtime.map(image=>image.id));
const unchangedImages=Object.entries(after.images).filter(([id])=>!generated.has(id)).map(([id,image])=>{
  assert.deepEqual(image,before.images[id],id);
  assert.equal(createHash('sha256').update(readFileSync(resolve(root,'art/settings/ship',image.path))).digest('hex'),image.sha256);
  return id;
});
assert.equal(unchangedImages.length,61);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex').slice(0,16);
const canvas=[12,92,1428,839],shots=[];
const preview=resolve(root,'.generated/polish-gate-review');mkdirSync(preview,{recursive:true});
const pairs=[];
for(const scenario of gate.scenarios)for(const shot of scenario.shots){
  assert.equal(shot.canvasMatchesMain,true);
  const name=`${scenario.scenario}/${shot.shot}`;
  if(shot.identical){shots.push({name,identical:true,outsideCanvas:0});continue;}
  const read=side=>{const bytes=readFileSync(resolve(root,`docs/ship-deck-canvas/.generated/gate/${scenario.scenario}-${shot.shot}.${side}.png`));return {hash:hash(bytes),image:PNG.sync.read(bytes)};};
  const a=read('main'),b=read('branch');assert.deepEqual([a.hash,b.hash],shot.sha,'only inspect the current gate pair');
  const scale=a.image.width/1440;assert.equal(a.image.height,900*scale);
  let count=0,outside=0;
  for(let y=0;y<a.image.height;y++)for(let x=0;x<a.image.width;x++){
    const i=(y*a.image.width+x)*4;
    if(a.image.data.readUInt32BE(i)===b.image.data.readUInt32BE(i))continue;
    count++;
    if(x<canvas[0]*scale||y<canvas[1]*scale||x>=canvas[2]*scale||y>=canvas[3]*scale)outside++;
  }
  assert.equal(count,shot.differingPixels,name);assert.equal(outside,0,name);
  shots.push({name,sha:shot.sha,differingPixels:count,outsideCanvas:outside});
  pairs.push({name,images:[a.image,b.image,read('diff').image]});
}
// Four rows per page, main / branch / red differences, in the recorded index order.
const pages=[];
for(let start=0;start<pairs.length;start+=4){
  const group=pairs.slice(start,start+4),page=new PNG({width:1440,height:group.length*300});
  for(const [row,pair] of group.entries())for(const [col,png] of pair.images.entries()){
    for(let y=0;y<300;y++)for(let x=0;x<480;x++){
      const source=(Math.floor(y*png.height/300)*png.width+Math.floor(x*png.width/480))*4;
      page.data.set(png.data.subarray(source,source+4),((row*300+y)*page.width+col*480+x)*4);
    }
  }
  const file=`page-${String(pages.length+1).padStart(2,'0')}.png`;
  writeFileSync(resolve(preview,file),PNG.sync.write(page));pages.push({file,rows:group.map(pair=>pair.name)});
}
writeFileSync(resolve(preview,'index.json'),JSON.stringify(pages,null,2)+'\n');
const record={base:gate.base,compiledBranch:gate.compiledBranch,unchangedSections,unchangedStage,unchangedImages,viewport:[1440,900],canvas,shots,outsideCanvas:0};
writeFileSync(resolve(here,'polish-pixels.json'),JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({shots:shots.length,outsideCanvas:0,pages:pages.length}));
