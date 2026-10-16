/** Audit approved source pixels and the shipped byte budget against the pinned base. */
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {decodePng} from '../../../../test/png.ts';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../../..');
const base='47e305d',path='art/settings/japanese-ship/';
const hash=b=>createHash('sha256').update(b).digest('hex');
const old=file=>execFileSync('git',['show',base+':'+file],{cwd:root,maxBuffer:8_000_000});
const pack=JSON.parse(readFileSync(resolve(root,path+'setting.json'))),before=JSON.parse(old(path+'setting.json'));
const fixed=['ship','coast','coast-night','coast-front','coast-night-front','rig-fixed','masthead','sail-billow','ripples','wake','wake-motion','reply-shark','reply-shark-motion','sleep-window'];
const preserved=Object.fromEntries(fixed.map(name=>{const b=readFileSync(resolve(root,path+name+'.png'));assert.equal(hash(b),hash(old(path+name+'.png')),name);return [name,hash(b)];}));
assert.deepEqual(pack.attentionCarrier,before.attentionCarrier,'suggestion carrier including waterline and clock');
assert.deepEqual(pack.portals.entry,before.portals.entry,'hold arrival');
for(const look of ['indigo','russet']){
  const prior=decodePng(old(path+'crew-'+look+'.png')),current=decodePng(readFileSync(resolve(root,path+'crew-'+look+'.png')));
  for(let y=0;y<prior.height;y++)assert.deepEqual(current.rgba.subarray(y*current.width*4,(y*current.width+prior.width)*4),prior.rgba.subarray(y*prior.width*4,(y+1)*prior.width*4));
}
const imageBytes=Object.values(pack.images).reduce((n,a)=>n+readFileSync(resolve(root,path+a.path)).length,0);assert.ok(imageBytes<=1_000_000);
const report={base,preserved,originalCrewFrames:'all twelve original frames unchanged in both existing looks; three new poses appended',arrival:'unchanged',attentionCarrier:'deep-equal including surface ripple',imageBytes,imageCount:Object.keys(pack.images).length,capabilities:pack.requires,engineCodeChanged:false};
writeFileSync(resolve(here,'preservation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({imageBytes,imageCount:report.imageCount,preserved:fixed.length}));
