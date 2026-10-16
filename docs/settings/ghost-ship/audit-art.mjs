/** Static registration audit and crop evidence from actual canvas/GIF captures. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {decodePng} from '../../../test/png.ts';
import {blank,crop,nearest,paste,encode} from '../japanese-ship/build-art.mjs';
import {transitDepthAudit} from './geometry.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..'),packDir=resolve(root,'art/settings/ghost-ship'),out=resolve(here,'review');
const manifest=JSON.parse(readFileSync(resolve(packDir,'setting.json'))),sha=b=>createHash('sha256').update(b).digest('hex');
const depth=transitDepthAudit(manifest);assert.ok(depth.sail>depth.climber,'sail must sort above the full transit depth, including the actor x tie-break');
const crew=manifest.cast.looks.map(l=>{const a=decodePng(readFileSync(resolve(packDir,manifest.images[l.image].path))),alphas=new Set();for(let i=3;i<a.rgba.length;i+=4)if(a.rgba[i])alphas.add(a.rgba[i]);assert.ok(alphas.size);assert.ok(Math.max(...alphas)<255);return {look:l.id,visibleAlphas:[...alphas].sort((a,b)=>a-b)};});
const cycles=['sail-main','sail-aft','flag-main','flag-aft','rig','seam','hatch-mist','candle','fog','night-fog','angler'].map(id=>{const hashes=Array.from({length:4},(_,i)=>sha(readFileSync(resolve(packDir,manifest.images[id+'-'+i].path))));assert.ok(new Set(hashes).size>1);return {id,distinct:new Set(hashes).size};});
const bytes=Object.values(manifest.images).reduce((n,i)=>n+readFileSync(resolve(packDir,i.path)).length,0);assert.ok(bytes<=1000000);assert.equal(crew.length,8);
const matrix=JSON.parse(readFileSync(resolve(here,'matrix.json'))),wide=matrix.results.find(x=>x.aspect==='wide'&&x.phase==='midday');
const fromWorld=(a,r)=>{const q=a.width/wide.canvas.width;return crop(a,Math.round((wide.fit.x+r[0]*wide.fit.scale)*q),Math.round((wide.fit.y+r[1]*wide.fit.scale)*q),Math.round(r[2]*wide.fit.scale*q),Math.round(r[3]*wide.fit.scale*q));};
for(const [id,file,r]of [['bow-before','midday-wide.png',[160,270,230,90]],['bow-after-24','crowd-blocked-24.png',[160,270,230,90]],['spectral-crew-close','night-showpiece.png',[200,270,470,75]],['cabins-24-close','crowd-idle-24.png',[260,340,370,70]],['anglerfish-close','night-wide.png',[685,450,90,75]]]){const a=fromWorld(decodePng(readFileSync(resolve(out,file))),r);writeFileSync(resolve(out,id+'.png'),encode(nearest(a,a.width*2,a.height*2)));}
const {GifReader}=createRequire(resolve(root,'.generated/motion-tools/package.json'))('omggif');
for(const [id,file,r,start,step,count,cols]of [['lookout-contact','hatch-and-lookout.gif',[265,45,70,270],0,5,16,8],['kraken-close-contact','plank-kraken-departure.gif',[0,240,210,270],43,2,20,10],['whale-contact','storm-peak-whale-and-ship.gif',[10,125,210,195],0,8,20,10]]){
 const g=new GifReader(readFileSync(resolve(out,file))),frames=[];for(let k=0;k<count;k++){const rgba=Buffer.alloc(g.width*g.height*4);g.decodeAndBlitFrameRGBA(Math.min(g.numFrames()-1,start+k*step),rgba);const a=fromWorld({width:g.width,height:g.height,rgba},r);frames.push(nearest(a,a.width*2,a.height*2));}const sheet=blank(frames[0].width*cols,frames[0].height*Math.ceil(count/cols));frames.forEach((a,i)=>paste(sheet,a,(i%cols)*a.width,Math.floor(i/cols)*a.height));writeFileSync(resolve(out,id+'.png'),encode(sheet));
}
writeFileSync(resolve(here,'art-audit.json'),JSON.stringify({bytes,crew,cycles,depth,coastPeriodSeconds:1000/(1000/1200),waterline:{carrierRow:39,departureKrakenRow:110,whaleRow:148},phaseOpacity:'baked constant spectral alpha; night RGB tint only',nightTint:manifest.stage.tintByPhase.night},null,2)+'\n');
console.log(JSON.stringify({bytes,looks:crew.length,cycles:cycles.length}));
