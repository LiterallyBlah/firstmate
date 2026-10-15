// Mechanical registration and palette normalization of the generated source; no drawn shapes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)), root=resolve(here,'../../..');
const require=createRequire(resolve(root,'docs/board-list/package.json'));
const {PNG}=require('pngjs');
const bytes=readFileSync(resolve(here,'source/porthole.png')), source=PNG.sync.read(bytes);
const palette=['#151E2D','#1D314E','#2C4869','#45617A','#613A28','#815C43','#BF854C','#C88C50','#DCA35B','#E8CCA6','#D9D4BE'];
const colours=palette.map(hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)));
const distance=(a,b)=>a.reduce((sum,v,i)=>sum+(v-b[i])**2,0);
const nearest=c=>colours.reduce((a,b)=>distance(c,a)<=distance(c,b)?a:b);
const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
const hash=data=>createHash('sha256').update(data).digest('hex');
let left=source.width,top=source.height,right=0,bottom=0;
for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++)if(source.data[(y*source.width+x)*4+3]>=192){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
const scale=Math.max(right-left+1,bottom-top+1)/12;
const rect=[(left+right+1)/2-8*scale,(top+bottom+1)/2-8*scale,16*scale,16*scale];
const png=new PNG({width:16,height:16});
for(let y=2;y<14;y++)for(let x=2;x<14;x++){
  const channels=[[],[],[]];let total=0,covered=0;
  for(let sy=Math.floor(rect[1]+y*scale);sy<Math.floor(rect[1]+(y+1)*scale);sy++)for(let sx=Math.floor(rect[0]+x*scale);sx<Math.floor(rect[0]+(x+1)*scale);sx++){
    total++;if(sx<0||sy<0||sx>=source.width||sy>=source.height)continue;
    const i=(sy*source.width+sx)*4;if(source.data[i+3]<192)continue;
    covered++;for(let c=0;c<3;c++)channels[c].push(source.data[i+c]);
  }
  if(covered>=total/2&&covered)png.data.set([...nearest(channels.map(median)),255],(y*16+x)*4);
}
const output=PNG.sync.write(png,{colorType:6});
const folder=resolve(root,'art/settings/ship/below-deck');mkdirSync(folder,{recursive:true});
writeFileSync(resolve(folder,'porthole.png'),output);
writeFileSync(resolve(here,'provenance.json'),JSON.stringify({tool:'built-in image_gen__imagegen',source:{sha256:hash(bytes),size:[source.width,source.height]},crop:rect,scale,palette,size:[16,16],feet:[8,16],alpha:'binary; majority coverage at alpha >= 192',sha256:hash(output)},null,2)+'\n');
// The pack owns its posts, route, spacing and display words.
const path=resolve(root,'art/settings/ship/setting.json'), m=JSON.parse(readFileSync(path,'utf8'));
if(!['1.1.0','1.2.0'].includes(m.version))throw Error('This builder targets the below-deck 1.2.0 pack only');
m.version='1.2.0';
m.images['below-deck-porthole']={path:'below-deck/porthole.png',size:[16,16],sha256:hash(output)};
if(!m.requires.includes('zone-appearance@1'))m.requires.splice(m.requires.indexOf('zones@1')+1,0,'zone-appearance@1');
const areas=[
 {id:'rest-corridor',polygon:[[138,103],[142,103],[142,147],[138,147]],spill:false},
 {id:'below-deck',polygon:[[78,128],[394,128],[394,147],[78,147]],spill:false},
];
for(const area of areas){const at=m.floor.areas.findIndex(a=>a.id===area.id);if(at<0)m.floor.areas.push(area);else m.floor.areas[at]=area;}
m.floor.grid.bounds[3]=68;
const rest=m.zones.zones.find(z=>z.id==='rest');
rest.posts=[128,164,200,272,308,344,380,92].map((x,i)=>({id:`rest-${i+1}`,at:[x,146],facing:'front'}));
// Leave the plank's projection clear, including when the rest area fills.
rest.overflow={kind:'pack',areas:[[80,146,145,1],[272,146,121,1]],spacing:[12,1],fallback:[6,1]};
rest.labelFloor=150;
rest.appearance={sprite:{image:'below-deck-porthole'},feet:[8,16],front:'near'};
m.copy.zones.rest='resting below deck';
writeFileSync(path,JSON.stringify(m,null,2)+'\n');
console.log('Registered generated 16x16 porthole; below-deck packing for 24 workers; ship 1.2.0.');
