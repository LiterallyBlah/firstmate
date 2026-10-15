// Mechanical crop, registration, binary-alpha and palette normalization of generated art. No drawn shapes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)), root=resolve(here,'../../..');
const {PNG}=createRequire(resolve(root,'docs/board-list/package.json'))('pngjs');
const bytes=readFileSync(resolve(here,'source/shark.png')), source=PNG.sync.read(bytes);
const palette=['#151E2D','#1D314E','#2C4869','#45617A','#64849A','#8FA8B4','#BECAC6','#D9D4BE'];
const colours=palette.map(h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)));
const distance=(a,b)=>a.reduce((s,v,i)=>s+(v-b[i])**2,0);
const nearest=c=>colours.reduce((a,b)=>distance(c,a)<=distance(c,b)?a:b);
const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
const hash=b=>createHash('sha256').update(b).digest('hex');
const crops=[[36,47,640,480],[760,47,640,480],[36,582,640,480],[760,582,640,480]];
const frames=crops.map(([left,top])=>{
  const p=new PNG({width:64,height:48});
  for(let y=2;y<46;y++)for(let x=2;x<62;x++){
    const channels=[[],[],[]];let covered=0;
    for(let sy=top+y*10;sy<top+(y+1)*10;sy++)for(let sx=left+x*10;sx<left+(x+1)*10;sx++){
      const i=(sy*source.width+sx)*4;if(source.data[i+3]<192)continue;
      covered++;for(let c=0;c<3;c++)channels[c].push(source.data[i+c]);
    }
    if(covered>=50)p.data.set([...nearest(channels.map(median)),255],(y*64+x)*4);
  }
  return p;
});
// Register the generated speech bubble once across the cycle; only the generated tail/body animates.
for(const p of frames.slice(1))p.data.set(frames[0].data.subarray(0,64*24*4));
const folder=resolve(root,'art/settings/ship/reply');mkdirSync(folder,{recursive:true});
const outputs=frames.map((p,i)=>{const b=PNG.sync.write(p,{colorType:6});writeFileSync(resolve(folder,`shark-${i}.png`),b);return {id:`reply-shark-${i}`,path:`reply/shark-${i}.png`,size:[64,48],sha256:hash(b)};});
const contact=new PNG({width:512,height:384});
frames.forEach((p,i)=>{for(let y=0;y<48;y++)for(let x=0;x<64;x++)for(let dy=0;dy<4;dy++)for(let dx=0;dx<4;dx++)contact.data.set(p.data.subarray((y*64+x)*4,(y*64+x+1)*4),((Math.floor(i/2)*192+y*4+dy)*512+(i%2)*256+x*4+dx)*4);});
writeFileSync(resolve(here,'contact.png'),PNG.sync.write(contact));
writeFileSync(resolve(here,'provenance.json'),JSON.stringify({tool:'built-in image_gen__imagegen',mode:'generate',source:{size:[source.width,source.height],sha256:hash(bytes)},crops,scale:10,bubble:'generated frame 0, rows 0..23 reused unchanged in all frames',palette,alpha:'binary; majority coverage alpha >= 192',clearBorder:2,outputs},null,2)+'\n');
const path=resolve(root,'art/settings/ship/setting.json'),m=JSON.parse(readFileSync(path,'utf8'));
if(!['1.2.0','1.3.0'].includes(m.version))throw Error('Builder targets ship 1.3.0');
m.version='1.3.0';
for(const {id,...entry} of outputs)m.images[id]=entry;
m.requires=m.requires.filter(capability=>capability!=='attention-carrier@1');
m.requires.splice(m.requires.indexOf('zone-appearance@1')+1,0,'attention-carrier@1');
m.attentionCarrier={at:[4,122],size:[64,48],frames:outputs.map(({id})=>({image:id})),frameMs:450,loiter:{amplitude:[2,1],periodMs:4800}};
writeFileSync(path,JSON.stringify(m,null,2)+'\n');
console.log('Registered generated four-frame 64x48 reply shark; ship 1.3.0.');
