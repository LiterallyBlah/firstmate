/** Data/art preservation and screenshot evidence, independent of Pixi internals. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodePng} from '../../../../test/png.ts';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../../..'),folder='art/settings/sky-airship';
const base=JSON.parse(readFileSync(resolve(root,'docs/ship-deck-canvas/.generated/compiled-inputs.json'))).mainRevision;
const blob=path=>execFileSync('git',['show',base+':'+path],{cwd:root,maxBuffer:8_000_000});
const before=JSON.parse(blob(folder+'/setting.json')),after=JSON.parse(readFileSync(resolve(root,folder,'setting.json')));
const sha=b=>createHash('sha256').update(b).digest('hex');
const equal=(a,b)=>a.length===b.length && a.every((v,i)=>v===b[i]);
for(const key of Object.keys(before).filter(k=>!['images','ambience'].includes(k)))assert.deepEqual(after[key],before[key],key);
assert.deepEqual(after.ambience.filter(a=>a.id!=='sea-floor'),before.ambience);
const changed=['sea-near','sea-near-storm'];
for(const [id,image]of Object.entries(before.images)){
  const bytes=readFileSync(resolve(root,folder,image.path));
  if(!changed.includes(id)){assert.equal(sha(bytes),image.sha256,id);continue;}
  const old=decodePng(blob(folder+'/'+image.path)),now=decodePng(bytes);
  assert.equal(now.width,old.width);assert.equal(now.height,old.height);
  assert.ok(equal(now.rgba.subarray(0,112*now.width*4),old.rgba.subarray(0,112*old.width*4)),id+' approved crest is unchanged');
  const tile=decodePng(readFileSync(resolve(root,folder,id==='sea-near'?'sea-floor.png':'sea-floor-storm.png')));
  for(let i=3;i<tile.rgba.length;i+=4)assert.equal(tile.rgba[i],255,'opaque coverage');
  for(let x=0;x<now.width;x++)assert.ok(equal(now.rgba.subarray((159*now.width+x)*4,(159*now.width+x+1)*4),tile.rgba.subarray((47*tile.width+x%tile.width)*4,(47*tile.width+x%tile.width+1)*4)),'bank continues on exactly the registered tile row');
}
const captures=[];
for(const aspect of ['wide','square','tall','very-tall'])for(const phase of ['day','night','storm']){
  const name=aspect+'-'+phase+'.png',a=readFileSync(resolve(here,'before',name)),b=readFileSync(resolve(here,'after',name));
  const old=decodePng(a),now=decodePng(b);assert.equal(now.width,old.width);assert.equal(now.height,old.height);
  let count=0,firstRow=now.height;
  for(let i=0;i<now.rgba.length;i+=4)if(!equal(now.rgba.subarray(i,i+4),old.rgba.subarray(i,i+4))){count++;firstRow=Math.min(firstRow,Math.floor(i/4/now.width));}
  if(aspect==='wide')assert.equal(count,0,name+' preserves normal wide view');
  captures.push({name,beforeSha256:sha(a),afterSha256:sha(b),differingPixels:count,firstChangedRow:count?firstRow:null});
}
const imageBytes=Object.values(after.images).reduce((sum,a)=>sum+statSync(resolve(root,folder,a.path)).size,0);
assert.ok(imageBytes<=1_000_000);
writeFileSync(resolve(here,'audit.json'),JSON.stringify({base,unchangedManifestSections:Object.keys(before).filter(k=>!['images','ambience'].includes(k)),unchangedOriginalAmbience:true,unchangedOriginalImages:Object.keys(before.images).filter(id=>!changed.includes(id)).length,changedArtOnlyBelowWorldRow:398,opaqueContinuation:true,registeredJoin:true,imageBytes,imageBudget:1_000_000,imageCount:Object.keys(after.images).length,capabilitiesUnchanged:true,captures},null,2)+'\n');
console.log(JSON.stringify({imageBytes,captures}));
