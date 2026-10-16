import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodePng} from '../../../../test/png.ts';
import {blank,crop,nearest,encode} from '../../japanese-ship/build-art.mjs';
const here=dirname(fileURLToPath(import.meta.url)),pack=resolve(here,'../../../../art/settings/sky-airship'),path=resolve(pack,'setting.json'),m=JSON.parse(readFileSync(path));
const save=(id,a)=>{const data=encode(a);writeFileSync(resolve(pack,id+'.png'),data);m.images[id]={path:id+'.png',size:[a.width,a.height],sha256:createHash('sha256').update(data).digest('hex')};};
// Crop only the empty sky above the existing four coils; preserve their aspect
// ratio at a size that fits the open sky above the balloon. Long transparent
// spacing gives one traveller per crossing rather than a repeating parade.
for(let f=0;f<4;f++){
 const source=decodePng(readFileSync(resolve(here,'before/serpent-'+f+'.png')));
 const body=nearest(crop(source,0,24,110,62),78,44),strip=blank(2048,44);
 for(let y=0;y<44;y++)strip.rgba.set(body.rgba.subarray(y*78*4,(y+1)*78*4),(y*2048+1024)*4);
 save('serpent-'+f,strip);
}
save('serpent-clear',blank(2048,44));
const e=m.ambience.find(e=>e.id==='sky-serpent');e.order=6.1;e.lite='hide';e.still='hide';
e.behaviour={kind:'strip',frames:{sprites:Array.from({length:4},()=>({image:'serpent-clear'})),frameMs:600,clock:'swell'},top:-8,span:[-1200,1680],drift:{pxPerSecond:18,clock:'wind'},variants:[{id:'peak-storm',frames:Array.from({length:4},(_,i)=>({image:'serpent-'+i})),blend:'over',opacity:[[0,0],[.82,0],[1,.95]]}]};
writeFileSync(path,JSON.stringify(m,null,2)+'\n');
