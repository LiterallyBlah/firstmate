/** Pack preservation, budget, wrap continuity, and sky coverage from actual PNGs. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodePng} from '../../../../test/png.ts';
import {curveAt,variantBlend} from '../../../../client/deck-variants.ts';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../../..'),folder='art/settings/japanese-ship/';
const before=JSON.parse(execFileSync('git',['show','b1458b4:'+folder+'setting.json'],{cwd:root}));
const after=JSON.parse(readFileSync(resolve(root,folder,'setting.json')));
for(const key of ['stage','cast','floor','zones','portals','effects','attentionCarrier','dayCycle','atmosphere'])assert.deepEqual(after[key],before[key],key);
const changed=['sea-ripples','twinkle-0','twinkle-1','umibozu','coast','coast-foreground'];
for(const e of before.ambience.filter(e=>!changed.includes(e.id)))assert.deepEqual(after.ambience.find(a=>a.id===e.id),e,e.id);
const preserved=Object.keys(before.images).filter(id=>!['ripples','stars','stars-dim'].includes(id)&&!id.startsWith('coast'));
for(const id of preserved)assert.deepEqual(after.images[id],before.images[id],id);
const imageBytes=Object.values(after.images).reduce((n,i)=>n+readFileSync(resolve(root,folder,i.path)).length,0);assert.ok(imageBytes<=1e6);
const stars=decodePng(readFileSync(resolve(root,folder,'bay-stars.png'))),sectors=[];
for(let col=0;col<6;col++){
  let count=0;for(let y=0;y<180;y++)for(let x=col*100;x<(col+1)*100;x++)if(stars.alpha(x,y)>0)count++;
  assert.ok(count>50,'stars across sector '+col);sectors.push(count);
}
const bright=decodePng(readFileSync(resolve(root,folder,'stars.png'))),dim=decodePng(readFileSync(resolve(root,folder,'stars-dim.png')));
assert.ok(bright.rgba.some((v,i)=>i%4===3&&v>0),'twinkles are not empty');assert.notDeepEqual(bright.rgba,dim.rgba);
const near=after.ambience.find(e=>e.id==='bay-near').behaviour;
assert.equal(near.kind,'tile');assert.equal(near.frames.clock,'water');assert.equal(near.drift.clock,'water');
assert.deepEqual(near.bands,[{slot:'back',fromRow:276},{slot:'front',fromRow:290}]);
const spirit=after.ambience.find(e=>e.id==='umibozu');
assert.equal(spirit.slot,'back');assert.equal(spirit.order,6.5);assert.deepEqual(spirit.behaviour.at,[100,178]);
assert.equal(spirit.lite,'hide');assert.equal(spirit.still,'hide');
const coast=after.ambience.find(e=>e.id==='coast-foreground').behaviour;
assert.equal(coast.kind,'phase-strip');assert.equal(coast.top,-30);assert.equal(coast.drift.pxPerSecond,0);
for(const id of ['coast-front','coast-night-front','coast-dawn-front','coast-morning-front','coast-afternoon-front','coast-dusk-front']){
 const original=decodePng(execFileSync('git',['show','b1458b4:'+folder+id+'.png'],{cwd:root})),fixed=decodePng(readFileSync(resolve(root,folder,id+'.png')));
 for(let y=0;y<=245;y++)assert.deepEqual(fixed.rgba.subarray(y*fixed.width*4,(y*fixed.width+600)*4),original.rgba.subarray(y*600*4,(y+1)*600*4),'approved island pixels '+id);
}
assert.equal(spirit.behaviour.variants,undefined);assert.equal(spirit.behaviour.opacity.curve.at(-1)[1],1);
const oldSpirit=before.ambience.find(e=>e.id==='umibozu').behaviour;
const oldBodyAlpha=curveAt(oldSpirit.opacity.curve,.9)*variantBlend(oldSpirit.variants,.9).layers[0];
const stableAlphas=Array.from({length:25},(_,i)=>curveAt(spirit.behaviour.opacity.curve,i/24));
assert.ok(stableAlphas.every(a=>a===0||a===1),'no attainable stationary crew intensity leaves a translucent body');
assert.deepEqual(spirit.behaviour.frames.sprites[0],{image:'umibozu',rect:[144,0,72,80]},'full cycle keeps risen pose');
for(const image of ['umibozu','umibozu-sink']){const a=decodePng(readFileSync(resolve(root,folder,image+'.png')));assert.ok(a.rgba.every((v,i)=>i%4!==3||v===0||v===255),'body art has binary alpha');}
const result={baseline:'b1458b4',imageBytes,preservedImages:preserved,unchanged:['stage','cast','floor','zones','portals','effects','attentionCarrier','dayCycle','atmosphere','turning-wake','moon','rain-spray','overcast'],skySectors:sectors,twinkle:'nonempty distinct frames',nearCoverage:'tile to visible bottom; back/front share origin and clock',umibozu:{before:'element opacity 0..0.85 times rise-variant crossfade',oldBodyAlphaAt90Percent:oldBodyAlpha,after:'one opaque rise/settle/submerge cycle; full strength above 0.780001; no stable crew intensity in reveal interval',stableAlphas,frames:spirit.behaviour.frames.sprites.length,worldWaterline:spirit.behaviour.at,coastSpace:'stationary world phase strip',hidden:['lite','still','reduced motion']}};
writeFileSync(resolve(here,'audit.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
