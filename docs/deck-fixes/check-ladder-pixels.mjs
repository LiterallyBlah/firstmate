/** Evidence only: neither masks nor accepts a difference in the exact-hash gate. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { decodePng } from '../../test/png.ts';

const here=dirname(fileURLToPath(import.meta.url)), root=resolve(here,'../..');
const gate=JSON.parse(readFileSync(resolve(root,'docs/deck-settings/gate-results.json'),'utf8'));
assert.equal(gate.shots,81); assert.equal(gate.maskToolbar,false); assert.deepEqual(gate.pageErrors,[]);
assert.equal(gate.passed,true); assert.deepEqual(gate.flakes,[]);
const dataRevision=execFileSync('git',['log','-1','--format=%h','--','art/settings/ship/setting.json'],{cwd:root,encoding:'utf8'}).trim();
assert.equal(gate.compiledBranch,dataRevision,'review the capture from this data change');
const revision=/^compiled main ([a-f0-9]+)$/.exec(gate.base)?.[1];
assert.ok(revision);
const before=JSON.parse(execFileSync('git',['show',`${revision}:art/settings/ship/setting.json`],{cwd:root,encoding:'utf8'}));
const after=JSON.parse(readFileSync(resolve(root,'art/settings/ship/setting.json'),'utf8'));
const normalized=structuredClone(after);
normalized.version=before.version;
const originalLadder=before.stage.parts.find(p=>p.id==='access-ladder');
const ladder=normalized.stage.parts.find(p=>p.id==='access-ladder');
assert.deepEqual(ladder.at,[204,-38]);
ladder.at=originalLadder.at;
assert.equal(normalized.stage.parts.length,before.stage.parts.length);
normalized.stage.parts.sort((a,b)=>before.stage.parts.findIndex(p=>p.id===a.id)-before.stage.parts.findIndex(p=>p.id===b.id));
const post=m=>m.zones.zones.flatMap(z=>z.posts).find(p=>p.id==='mast-fore');
assert.deepEqual(post(after).transit.path,[[211,98],[211,-35],[218,-35]]);
post(normalized).transit.path=post(before).transit.path;
assert.deepEqual(normalized,before,'only the ladder position/order, access path and pack version may change');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const [id,asset] of Object.entries(after.images)) {
  assert.equal(hash(readFileSync(resolve(root,'art/settings/ship',asset.path))),before.images[id].sha256,id);
}

function encode({width,height,rgba}) {
  const raw=Buffer.alloc((width*4+1)*height);
  for(let y=0;y<height;y++)raw.set(rgba.subarray(y*width*4,(y+1)*width*4),y*(width*4+1)+1);
  const chunk=(type,data)=>{
    const head=Buffer.alloc(8);head.writeUInt32BE(data.length);head.write(type,4,'latin1');
    const tail=Buffer.alloc(4);tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4),data]))>>>0);
    return Buffer.concat([head,data,tail]);
  };
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header.set([8,6,0,0,0],8);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}

const directory=resolve(root,'docs/ship-deck-canvas/.generated/gate');
const review=resolve(root,'.generated/ladder-gate-review');mkdirSync(review,{recursive:true});
const canvas=[12,92,1428,839], shots=[], pairs=[];
for(const scenario of gate.scenarios)for(const shot of scenario.shots) {
  const name=`${scenario.scenario}/${shot.shot}`;assert.equal(shot.canvasMatchesMain,true,name);
  if(shot.identical){shots.push({name,identical:true,outsideCanvas:0});continue;}
  const read=side=>{
    const bytes=readFileSync(resolve(directory,`${scenario.scenario}-${shot.shot}.${side}.png`));
    return {sha:hash(bytes).slice(0,16),image:decodePng(bytes)};
  };
  const a=read('main'), b=read('branch');assert.deepEqual([a.sha,b.sha],shot.sha);
  const scale=a.image.width/1440;assert.equal(a.image.height,900*scale);
  let count=0, outside=0, belowDeck=0, outsideMastStrip=0;
  for(let y=0;y<a.image.height;y++)for(let x=0;x<a.image.width;x++) {
    if(a.image.at(x,y)===b.image.at(x,y))continue;
    count++;
    if(x<canvas[0]*scale||y<canvas[1]*scale||x>=canvas[2]*scale||y>=canvas[3]*scale)outside++;
    // The union of old/new ladder columns in this fixed 1440px gate, with 2px for rounding.
    // Focus moves that column with the camera; its four full-scene comparisons are reviewed separately.
    if(scenario.scenario!=='focus'&&(x<695*scale||x>=768*scale))outsideMastStrip++;
    // The settled sleeping-room shot: its hull targets and the sea below them must stay identical.
    if(scenario.scenario==='still-all-idle'&&y>=730*scale)belowDeck++;
  }
  assert.equal(count,shot.differingPixels,name);assert.equal(outside,0,name);assert.equal(belowDeck,0,name);
  assert.equal(outsideMastStrip,0,name);
  shots.push({name,sha:shot.sha,differingPixels:count,box:shot.box,outsideCanvas:outside,belowDeck,outsideMastStrip:scenario.scenario==='focus'?null:outsideMastStrip});
  pairs.push({name,prefix:`${scenario.scenario}-${shot.shot}`});
}

// Every differing frame: four full-scene rows per page, main / branch / red differences.
const pages=[];
for(let start=0;start<pairs.length;start+=4) {
  const group=pairs.slice(start,start+4), page={width:1440,height:group.length*300,rgba:Buffer.alloc(1440*group.length*300*4)};
  for(const [row,pair] of group.entries())for(const [col,side] of ['main','branch','diff'].entries()) {
    const png=decodePng(readFileSync(resolve(directory,`${pair.prefix}.${side}.png`)));
    for(let y=0;y<300;y++)for(let x=0;x<480;x++) {
      const source=(Math.floor(y*png.height/300)*png.width+Math.floor(x*png.width/480))*4;
      page.rgba.set(png.rgba.subarray(source,source+4),((row*300+y)*page.width+col*480+x)*4);
    }
  }
  const file=`page-${String(pages.length+1).padStart(2,'0')}.png`;
  writeFileSync(resolve(review,file),encode(page));pages.push({file,rows:group.map(p=>p.name)});
}
writeFileSync(resolve(review,'index.json'),JSON.stringify(pages,null,2)+'\n');
writeFileSync(resolve(here,'ladder-pixels.json'),JSON.stringify({base:gate.base,compiledBranch:gate.compiledBranch,unchangedImages:Object.keys(after.images).length,onlyManifestChanges:['version','access-ladder placement and order','mast-fore transit path'],outsideCanvas:0,shots},null,2)+'\n');
console.log(JSON.stringify({shots:shots.length,unchangedImages:Object.keys(after.images).length,outsideCanvas:0,pages:pages.length}));
