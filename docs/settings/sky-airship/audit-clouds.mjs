/** Registration invariants for the cloud-only revision; no runtime hooks. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodePng} from '../../../test/png.ts';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..'),folder='art/settings/sky-airship';
const old=JSON.parse(execFileSync('git',['show','9ced243:'+folder+'/setting.json'],{cwd:root,encoding:'utf8'}));
const now=JSON.parse(readFileSync(resolve(root,folder,'setting.json')));
const kept=['stage','floor','zones','cast','portals','effects','attentionCarrier','dayCycle','atmosphere','palette'];
for(const section of kept)assert.deepEqual(now[section],old[section],section+' preserves approved data');
const removed=['cloud-bank','cloud-puff','cloud-wisp',...Array.from({length:4},(_,i)=>'cloud-sea-'+i)];
const unchanged=Object.keys(old.images).filter(id=>id!=='preview'&&!removed.includes(id));
for(const id of unchanged)assert.equal(now.images[id].sha256,old.images[id].sha256,id+' preserves approved art');
const read=id=>decodePng(readFileSync(resolve(root,folder,now.images[id].path)));
const banks={};
for(const name of ['sea-far','sea-mid','sea-near']){
 const day=read(name),storm=read(name+'-storm');
 assert.equal(day.width,storm.width);assert.equal(day.height,storm.height);
 for(let i=3;i<day.rgba.length;i+=4)assert.equal(day.rgba[i],storm.rgba[i],name+' alpha registration');
 for(const a of [day,storm])for(let y=0;y<a.height;y++)for(let c=0;c<4;c++){
  assert.equal(a.rgba[(y*a.width)*4+c],a.rgba[(y*a.width+a.width-1)*4+c],name+' loop join');
  assert.equal(a.rgba[(y*a.width+a.width/2-1)*4+c],a.rgba[(y*a.width+a.width/2)*4+c],name+' continuation join');
 }
 const luminance=a=>{let sum=0,n=0;for(let i=0;i<a.rgba.length;i+=4)if(a.rgba[i+3]){sum+=.2126*a.rgba[i]+.7152*a.rgba[i+1]+.0722*a.rgba[i+2];n++;}return Math.round(sum/n);};
 assert.ok(luminance(storm)<luminance(day)*.7,name+' darkens throughout');
 const b=now.ambience.find(x=>x.id===name).behaviour;
 assert.deepEqual(b.variants[0].opacity,[[.35,0],[.95,1]]);
 banks[name]={size:[day.width,day.height],baseDrift:b.drift.pxPerSecond,dayLuminance:luminance(day),stormLuminance:luminance(storm),alphaIdentical:true,loopAndContinuationEdgesIdentical:true};
}
const imageBytes=Object.values(now.images).reduce((n,a)=>n+statSync(resolve(root,folder,a.path)).size,0);assert.ok(imageBytes<=1000000);
writeFileSync(resolve(here,'cloud-preservation.json'),JSON.stringify({base:'9ced243db43668292903140f8fcaecd1dcf60cfd',unchangedSections:kept,unchangedImages:unchanged,removedImages:removed,banks,imageCount:Object.keys(now.images).length,imageBytes,engineChanges:false},null,2)+'\n');
console.log(JSON.stringify({imageBytes,banks}));
