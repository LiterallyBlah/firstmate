/** Re-register existing pixels only: a rigid basket and a downward rain loop. Run after build-art. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {decodePng} from '../../../test/png.ts';
import {blank} from '../japanese-ship/build-art.mjs';
import {indexed} from './indexed-png.mjs';

const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..'),pack=resolve(root,'art/settings/ghost-ship');
const manifestPath=resolve(pack,'setting.json'),registrationPath=resolve(here,'registration.json');
const manifest=JSON.parse(readFileSync(manifestPath)),registration=JSON.parse(readFileSync(registrationPath));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=id=>decodePng(readFileSync(resolve(pack,manifest.images[id].path)));
function save(id,image){
 const bytes=indexed(image),definition={path:id+'.png',size:[image.width,image.height],sha256:sha(bytes)};
 writeFileSync(resolve(pack,definition.path),bytes);
 manifest.images[id]=definition;registration.images[id]=definition;
}

// The flag's commissioned plate accidentally includes the basket's right half.
// Its lower-left 22 x 30 rectangle belongs to the mast, never the wind warp.
// Copy the original visible pixels into the fixed stage, then warp only cloth.
// A rerun preserves the already transferred pixels rather than erasing them.
const cloth=read('flag-main-0'),fixed=read('fixed');
const [flagX,flagY]=manifest.stage.parts.find(p=>p.id==='flag-main').at;
for(let y=28;y<58;y++)for(let x=0;x<22;x++){
 const from=(y*cloth.width+x)*4,to=((y+flagY)*fixed.width+x+flagX)*4;
 if(cloth.rgba[from+3])fixed.rgba.set(cloth.rgba.subarray(from,from+4),to);
 cloth.rgba.fill(0,from,from+4);
}
save('fixed',fixed);
for(let frame=0;frame<4;frame++){
 const image=blank(cloth.width,cloth.height);
 for(let y=0;y<cloth.height;y++)for(let x=0;x<cloth.width;x++){
  const dx=x+Math.round(Math.sin(y/cloth.height*Math.PI)*Math.sin(frame*Math.PI/2)*3);
  if(dx<0||dx>=cloth.width)continue;
  const from=(y*cloth.width+x)*4,to=(y*cloth.width+dx)*4;
  image.rgba.set(cloth.rgba.subarray(from,from+4),to);
 }
 save('flag-main-'+frame,image);
}

// Same registration as PR #101: four eight-row downward steps in a 32-row field.
// Reflect the existing streaks to slant with the positive horizontal wind drift.
// The 3 -> 0 transition advances exactly the same distance as the other steps.
// Pin the original streak plate: Ship's current rain was independently re-registered in PR #105.
// Reading that new sequence here would reflect its already corrected slope a second time.
const sourceRevision='df3469c2023013297838e5355e9aef340f91b49a';
const sourcePath='art/settings/ship/rain-0.png';
const sourceBytes=execFileSync('git',['show',sourceRevision+':'+sourcePath],{cwd:root});
assert.equal(sha(sourceBytes),'5e00ba56d634e9361b3a2ce77d24ec34b86ec3e8de5ca92f57fbddd03d436911');
const original=decodePng(sourceBytes);
assert.equal(original.width,96);assert.equal(original.height,64);
for(let frame=0;frame<4;frame++){
 const image=blank(96,64);
 for(let y=0;y<64;y++)for(let x=0;x<96;x++){
  const from=(((y-frame*8+64)%32)*96+95-x)*4;
  image.rgba.set(original.rgba.subarray(from,from+4),(y*96+x)*4);
 }
 const id='rain-'+frame;save(id,image);
 registration.sources[id]={reusedFrom:sourcePath,revision:sourceRevision,
  sha256:sha(sourceBytes),transform:{reflectX:true,periodRows:32,downRows:frame*8}};
}
registration.sources['rigid-crows-nest']={reusedFrom:'flag-main-0',rect:[0,28,22,30],to:'fixed',at:[flagX,flagY+28]};
writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
writeFileSync(registrationPath,JSON.stringify(registration,null,2)+'\n');
console.log('Registered rigid crow’s nest and four downward rain frames; no new painted pixels.');
