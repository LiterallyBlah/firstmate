/** Additional evidence after reviewing the 81 unmasked screenshots. This does not accept or mask gate differences. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)), root=resolve(here,'../..');
const {PNG}=createRequire(resolve(root,'docs/board-list/package.json'))('pngjs');
const gate=JSON.parse(readFileSync(resolve(root,'docs/deck-settings/gate-results.json'),'utf8'));
assert.equal(gate.shots,81);assert.equal(gate.maskToolbar,false);assert.deepEqual(gate.pageErrors,[]);
// CSS pixels of the reviewed 1440x900 fixture: the carrier in the sea and the existing footer line.
// The gate continues to compare every pixel, including every pixel inside these rectangles, by exact hashes.
const regions={carrier:[120,680,315,820],footer:[12,870,800,890]};
const hash=b=>createHash('sha256').update(b).digest('hex').slice(0,16);
const shots=[];
for(const scenario of gate.scenarios)for(const shot of scenario.shots){
  assert.equal(shot.canvasMatchesMain,true);
  const name=`${scenario.scenario}/${shot.shot}`;
  if(shot.identical){shots.push({name,identical:true,outsideAdditionRegions:0});continue;}
  const read=side=>{const b=readFileSync(resolve(root,`docs/ship-deck-canvas/.generated/gate/${scenario.scenario}-${shot.shot}.${side}.png`));return {hash:hash(b),image:PNG.sync.read(b)};};
  const a=read('main'),b=read('branch');assert.deepEqual([a.hash,b.hash],shot.sha,'only inspect the current gate pair');
  assert.equal(a.image.width,b.image.width);assert.equal(a.image.height,b.image.height);
  const scale=a.image.width/1440;assert.equal(a.image.height,900*scale);
  const inside=(x,y,[l,t,r,d])=>x>=l*scale&&x<r*scale&&y>=t*scale&&y<d*scale;
  let outside=0,count=0;
  for(let y=0;y<a.image.height;y++)for(let x=0;x<a.image.width;x++){
    const i=(y*a.image.width+x)*4;
    if(a.image.data.readUInt32BE(i)===b.image.data.readUInt32BE(i))continue;
    count++;
    if(!Object.values(regions).some(rect=>inside(x,y,rect)))outside++;
  }
  assert.equal(count,shot.differingPixels,name);assert.equal(outside,0,name);
  shots.push({name,sha:shot.sha,differingPixels:count,outsideAdditionRegions:outside});
}
const result={base:gate.base,compiledBranch:gate.compiledBranch,viewport:[1440,900],regions,shots,outsideAdditionRegions:0};
writeFileSync(resolve(here,'reply-shark-pixels.json'),JSON.stringify(result,null,2)+'\n');
console.log('81 shots: zero changed pixels outside the reviewed carrier and footer regions. No masks used in the gate.');
