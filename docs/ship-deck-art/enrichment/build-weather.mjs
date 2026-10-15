// Mechanical registration, block sampling and palette mapping of generated raster sources.
// npm.cmd install --prefix docs/board-list --no-save --package-lock=false pngjs@7.0.0
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const require = createRequire(resolve(root, 'docs/board-list/package.json'));
const { PNG } = require('pngjs');
const palette = ['#151E2D','#1D314E','#2C4869','#45617A','#64849A','#8FA8B4','#BECAC6','#D9D4BE','#C88C50'];
const rgb = hex => [1,3,5].map(i => parseInt(hex.slice(i,i+2),16));
const colours = palette.map(rgb);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestPath = resolve(root, 'art/settings/ship/setting.json');
const manifest = JSON.parse(readFileSync(manifestPath,'utf8'));
const record = { tool: 'built-in image_gen__imagegen', palette, alpha: 'binary; majority coverage at alpha >= 192', sources: {}, frames: [] };
const out = resolve(root, 'art/settings/ship/enrichment');
mkdirSync(out, {recursive:true});
const nearest = c => colours.reduce((a,b) => distance(c,a) <= distance(c,b) ? a : b);
const distance = (a,b) => a.reduce((s,v,i) => s + (v-b[i])**2,0);
const median = a => a.sort((a,b) => a-b)[Math.floor(a.length/2)];
function bounds(p, rect) {
  let left=p.width, top=p.height, right=-1, bottom=-1;
  for(let y=rect[1]; y<rect[1]+rect[3]; y++) for(let x=rect[0]; x<rect[0]+rect[2]; x++) {
    if(p.data[(y*p.width+x)*4+3] < 192) continue;
    left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);
  }
  if(right < left) throw Error('Empty source frame');
  return [left,top,right-left+1,bottom-top+1];
}
function sample(p, rect, w, h) {
  const result = new PNG({width:w,height:h});
  for(let y=2;y<h-2;y++) for(let x=2;x<w-2;x++) {
    const channels=[[],[],[]];let covered=0,total=0;
    for(let sy=Math.floor(rect[1]+y*rect[3]/h);sy<Math.floor(rect[1]+(y+1)*rect[3]/h);sy++)
      for(let sx=Math.floor(rect[0]+x*rect[2]/w);sx<Math.floor(rect[0]+(x+1)*rect[2]/w);sx++) {
        total++;
        if(sx<0||sy<0||sx>=p.width||sy>=p.height) continue;
        const i=(sy*p.width+sx)*4;
        if(p.data[i+3]<192) continue;
        covered++;for(let c=0;c<3;c++)channels[c].push(p.data[i+c]);
      }
    if(covered && covered>=total/2) result.data.set([...nearest(channels.map(median)),255],(y*w+x)*4);
  }
  return result;
}
function save(p, id, path) {
  const bytes=PNG.sync.write(p,{colorType:6});
  writeFileSync(resolve(out,path),bytes);
  manifest.images[id]={path:`enrichment/${path}`,size:[p.width,p.height],sha256:hash(bytes)};
}
for(const [id,w,h,columns,count] of [['serpent',64,56,2,4],['kraken',48,56,2,4],['lightning',32,48,2,2]]) {
  const bytes=readFileSync(resolve(here,`source/${id}.png`)), p=PNG.sync.read(bytes);
  record.sources[id]={sha256:hash(bytes),size:[p.width,p.height]};
  const cells=Array.from({length:count},(_,i)=>[Math.floor(i%columns*p.width/columns),Math.floor(Math.floor(i/columns)*p.height/(count/columns)),Math.floor(p.width/columns),Math.floor(p.height/(count/columns))]);
  const boxes=cells.map(cell=>bounds(p,cell));
  // One common scale for the entire animation: never resize poses to individual bounds.
  const scale=Math.max(...boxes.map(b=>Math.max(b[2]/(w-6),b[3]/(h-8))));
  for(let i=0;i<count;i++) {
    const b=boxes[i];
    const anchor=id==='lightning'?[b[0]+b[2]*.43,b[1]]:[b[0]+b[2]/2,b[1]+b[3]];
    const target=id==='lightning'?[16,4]:[w/2,h-4];
    const rect=[anchor[0]-target[0]*scale,anchor[1]-target[1]*scale,w*scale,h*scale];
    const frame=sample(p,rect,w,h);
    save(frame,`enrichment-${id}-${i}`,`${id}-${i}.png`);
    if(id!=='lightning') {
      const shadow=new PNG({width:w,height:h});frame.data.copy(shadow.data);
      for(let at=0;at<shadow.data.length;at+=4) if(shadow.data[at+3]) shadow.data.set(rgb('#1D314E'),at);
      save(shadow,`enrichment-${id}-loom-${i}`,`${id}-loom-${i}.png`);
    }
    record.frames.push({id,index:i,rect,sourceAnchor:anchor,outputAnchor:target,scale,size:[w,h]});
  }
}
manifest.version='1.1.0';
for(const [id,at,anchor,begin,full,frameMs] of [
  ['serpent',[32,166],[32,52],.55,.85,1000],
  ['kraken',[400,166],[24,52],.72,1,1200],
]) {
  const sprites=stem=>Array.from({length:4},(_,i)=>({image:`enrichment-${id}-${stem}${i}`}));
  const element={id:`weather-${id}`,slot:'front',order:10,lite:'freeze',still:'hide',behaviour:{
    kind:'cycle',frames:{sprites:sprites('loom-'),frameMs,clock:'swell'},at,anchor,
    opacity:{curve:[[begin,0],[full,.85]]},
    variants:[{id:`${id}-surface`,frames:sprites(''),blend:'crossfade',opacity:[[begin+.1,0],[full,1]]}],
  }};
  const index=manifest.ambience.findIndex(e=>e.id===element.id);
  if(index<0)manifest.ambience.push(element);else manifest.ambience[index]=element;
}
// Keep the scheduler, frame durations and cloud registration unchanged: brighter original art only.
const flash=manifest.ambience.find(e=>e.id==='lightning').behaviour;
flash.frames.forEach((frame,i)=>frame.sprite.image=`enrichment-lightning-${i}`);
flash.opacity=[[.92,0],[1,.54]];
// Replaced lightning source files are removed separately; every shipped file must be referenced.
delete manifest.images['storm-lightning-frame-0'];delete manifest.images['storm-lightning-frame-1'];
writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
writeFileSync(resolve(here,'weather-provenance.json'),JSON.stringify(record,null,2)+'\n');
console.log('Registered 18 frames; ship 1.1.0; existing catalogue only.');
