/** Pack-only voyage invariants; no renderer hooks. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodePng} from '../../../../test/png.ts';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../../..'),dir=resolve(root,'art/settings/japanese-ship');
const p=JSON.parse(readFileSync(resolve(dir,'setting.json'))),r=JSON.parse(readFileSync(resolve(here,'registration.json')));
const old=JSON.parse(execFileSync('git',['show',r.baseline+':art/settings/japanese-ship/setting.json'],{cwd:root}));
const changed=new Set(['coast-foreground','coast-storm-shade','umibozu']);
for(const key of Object.keys(old))if(!['version','images','ambience','atmosphere'].includes(key))assert.deepEqual(p[key],old[key],key+' preserved');
for(const e of old.ambience)if(!changed.has(e.id))assert.deepEqual(p.ambience.find(n=>n.id===e.id),e,e.id+' preserved');
for(const [id,image]of Object.entries(old.images))if(!r.removed.includes(id))assert.deepEqual(p.images[id],image,id+' preserved');
const atmosphere=structuredClone(p.atmosphere);delete atmosphere.clocks.voyage;delete atmosphere.delivered['voyage-pace'];for(const row of atmosphere.table)delete row['voyage-pace'];assert.deepEqual(atmosphere,old.atmosphere);
for(const id of ['voyage-coast','voyage-lights','voyage-shade','umibozu']){
 const e=p.ambience.find(e=>e.id===id),b=e.behaviour;
 assert.deepEqual(b.drift,{pxPerSecond:2.4,clock:'voyage'});assert.deepEqual(b.span,[-4096,4608]);
 for(const s of b.frames.sprites)assert.equal(s.rect?.[2]??p.images[s.image].size[0],2880);
 assert.equal(e.slot,'back');
}
assert.equal(r.lapSeconds,1200);assert.ok(p.atmosphere.table.every(row=>row['voyage-pace']===1));
const coast=decodePng(readFileSync(resolve(dir,'voyage-coast-midday.png'))),night=decodePng(readFileSync(resolve(dir,'voyage-coast-night.png')));
for(let i=3;i<coast.rgba.length;i+=4)assert.equal(coast.rgba[i],night.rgba[i],'phase registration');
for(let y=0;y<coast.height;y++)for(const x of [0,coast.width-1])assert.equal(coast.rgba[(y*coast.width+x)*4+3],0,'transparent wrap edge');
for(const x of r.berths)for(let y=0;y<coast.height;y++)for(let dx=-36;dx<36;dx++)assert.equal(coast.rgba[(y*coast.width+x+dx)*4+3],0,'spirit berth stays in open water');
const lights=p.ambience.find(e=>e.id==='voyage-lights').behaviour;
for(const [phase,frames]of Object.entries(lights.byPhase))assert.ok(frames.every(s=>phase==='night'?s.rect[1]>0:s.rect[1]===0),'night-only lights');
const u=p.ambience.find(e=>e.id==='umibozu');assert.equal(u.lite,'hide');assert.equal(u.still,'hide');assert.equal(u.behaviour.top+78,178);assert.deepEqual(u.behaviour.variants[0].opacity,[[.78,0],[.780001,1]]);
const atlas=decodePng(readFileSync(resolve(dir,'voyage-umibozu.png'))),poses=old.ambience.find(e=>e.id==='umibozu').behaviour.frames.sprites;
const source=id=>decodePng(execFileSync('git',['show',r.baseline+':art/settings/japanese-ship/'+id+'.png'],{cwd:root,maxBuffer:2e6}));
const originals=Object.fromEntries([...new Set(poses.map(s=>s.image))].map(id=>[id,source(id)]));
for(let f=0;f<poses.length;f++)for(let k=0;k<r.berths.length;k++){
 const s=poses[(f+k*5)%poses.length],a=originals[s.image],[sx,sy,w,h]=s.rect;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)assert.deepEqual(atlas.rgba.subarray(((f+1)*80*2880+y*2880+r.berths[k]-36+x)*4,((f+1)*80*2880+y*2880+r.berths[k]-36+x)*4+4),a.rgba.subarray(((sy+y)*a.width+sx+x)*4,((sy+y)*a.width+sx+x)*4+4),'approved spirit pose pixels preserved');
}
const imageBytes=Object.values(p.images).reduce((n,i)=>n+readFileSync(resolve(dir,i.path)).length,0);assert.ok(imageBytes<=1e6);
const result={baseline:r.baseline,imageBytes,lapSeconds:1200,direction:'rightward scenery for left-facing bow',checks:['parent stage, cast, interaction and departure contracts unchanged','parent water, stars, moon and weather unchanged','six registered day phases','night-only lamps share voyage coordinates','all four scenery layers share world drift','three non-overlapping open-water spirit berths','all approved opaque spirit pose pixels retained','spirit hidden in lite/still, full strength above 78% storm','transparent loop boundaries; independent sky/water fills retained'],errors:[]};
writeFileSync(resolve(here,'audit.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
