/** Deterministic edits of existing source pixels, confined to Sky pirates. */
import {readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';import {fileURLToPath} from 'node:url';
import {decodePng} from '../../../../test/png.ts';import {blank,crop,nearest,quant,encode} from '../../japanese-ship/build-art.mjs';
const here=dirname(fileURLToPath(import.meta.url)),pack=resolve(here,'../../../../art/settings/sky-airship');
const manifestPath=resolve(pack,'setting.json'),m=JSON.parse(readFileSync(manifestPath));
const save=(id,a)=>{const data=encode(a);writeFileSync(resolve(pack,id+'.png'),data);m.images[id]={...m.images[id],size:[a.width,a.height],sha256:createHash('sha256').update(data).digest('hex')};};
for(let i=0;i<4;i++){const a=decodePng(readFileSync(resolve(here,'before/carrier-'+i+'.png'))),b=blank(a.width,a.height);for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++)b.rgba.set(a.rgba.subarray((y*a.width+a.width-1-x)*4,(y*a.width+a.width-x)*4),(y*a.width+x)*4);save('carrier-'+i,b);}
const original=decodePng(readFileSync(resolve(here,'before/rain-0.png')));
// Repeat a 32-row field. A positive eight-row displacement per frame makes
// all four transitions, including frame 3 -> 0, exactly the same downward step.
for(let f=0;f<4;f++){const b=blank(96,64);for(let y=0;y<64;y++)for(let x=0;x<96;x++){const sy=(y-f*8+64)%32,sx=95-x;const i=(sy*96+sx)*4;b.rgba.set(original.rgba.subarray(i,i+4),(y*96+x)*4);}save('rain-'+f,b);}
const rain=m.ambience.find(e=>e.id==='rain').behaviour;rain.frames.sprites=Array.from({length:4},(_,i)=>({image:'rain-'+i}));
// Replacing with transparent art fades out the real sequence in calm weather.
// Resulting rain alpha remains 0 through .6 intensity, then rises to .5.
rain.variants=[{id:'clear-weather',frames:Array.from({length:4},()=>({image:'rain-clear'})),blend:'crossfade',opacity:[[0,1],[.6,1],[1,.5]]}];
m.attentionCarrier.loiter.amplitude=[1,1];
writeFileSync(manifestPath,JSON.stringify(m,null,2)+'\n');

