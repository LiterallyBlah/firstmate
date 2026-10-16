/** Offline registration of generated floating-island art. No engine code. */
import fs from 'node:fs';import {createHash} from 'node:crypto';import {resolve,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
import {decodePng} from '../../../../test/png.ts';import {blank,crop,nearest,quant,paste,bounds,encode} from '../../japanese-ship/build-art.mjs';
import {indexed} from './indexed.mjs';
const here=dirname(fileURLToPath(import.meta.url)),pack=resolve(here,'../../../../art/settings/sky-airship'),file=resolve(pack,'setting.json'),m=JSON.parse(fs.readFileSync(file));
const clone=a=>({...a,rgba:Buffer.from(a.rgba)}),source=n=>decodePng(fs.readFileSync(resolve(here,'sources',n+'.png')));
function save(id,a){const b=indexed(a);fs.writeFileSync(resolve(pack,id+'.png'),b);m.images[id]={path:id+'.png',size:[a.width,a.height],sha256:createHash('sha256').update(b).digest('hex')};}
function phase(a,p){const b=clone(a),settings={day:[[1,1,1],[0,0,0]],dawn:[[1,.78,.78],[18,6,19]],dusk:[[.86,.62,.72],[28,5,12]],night:[[.36,.43,.66],[5,8,15]]},[mul,add]=settings[p];for(let i=0;i<b.rgba.length;i+=4)if(b.rgba[i+3])for(let c=0;c<3;c++)b.rgba[i+c]=Math.min(255,Math.round(b.rgba[i+c]*mul[c]+add[c]));return b;}
const day=quant(nearest(nearest(source('sky-day'),300,200),600,400),64);for(const p of ['day','dawn','dusk'])save('sky-'+p,phase(day,p));save('sky-night',quant(nearest(nearest(source('sky-night'),300,200),600,400),64));
const atlas=source('islands'),defs={city:{rect:[0,0,600,550],lights:[[333,110],[219,185],[106,192],[380,168],[428,239],[291,231]]},falls:{rect:[600,0,580,550],lights:[[846,180]]},beacon:{rect:[1180,0,356,550],lights:[[1340,83],[1347,239]]},dock:{rect:[0,555,610,469],lights:[[335,683],[290,716],[400,746]]},ruins:{rect:[610,555,520,469],lights:[]},rocks:{rect:[1130,555,406,469],lights:[]}};
function body(name,width,p,far=false){const d=defs[name],a=crop(atlas,...d.rect);quant(a,32);const box=bounds(a),trim=crop(a,...box),h=Math.round(trim.height*width/trim.width),out=phase(nearest(trim,width,h),p);if(far){const tint=p==='night'?[47,64,100]:p==='dusk'?[150,121,155]:[130,165,199];for(let i=0;i<out.rgba.length;i+=4)if(out.rgba[i+3])for(let c=0;c<3;c++)out.rgba[i+c]=Math.round(out.rgba[i+c]*.55+tint[c]*.45);}
if(p==='night')for(const [sx,sy]of d.lights){const x=Math.round((sx-d.rect[0]-box[0])*width/trim.width),y=Math.round((sy-d.rect[1]-box[1])*h/trim.height);for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)if(x+dx>=0&&x+dx<width&&y+dy<h&&out.rgba[((y+dy)*width+x+dx)*4+3])out.rgba.set([255,220,132,255],((y+dy)*width+x+dx)*4);}
return out;}
// Each layer completes one lap in exactly 1,200 seconds. More distant objects
// have a shorter circumference, smaller apparent size and proportionally slower drift.
const layers=[
{id:'voyage-far',width:1024,height:90,top:-50,order:2.4,objects:[['rocks',40,28,54],['ruins',350,12,65],['rocks',720,40,42]]},
{id:'voyage-middle',width:1536,height:150,top:-86,order:3.3,objects:[['city',70,10,126],['beacon',570,5,68],['ruins',1060,24,100]]},
{id:'voyage-near',width:2048,height:180,top:-64,order:4.5,objects:[['falls',340,0,166],['dock',1030,4,176],['rocks',1720,30,110]]}
];
m.ambience=m.ambience.filter(e=>!e.id.startsWith('voyage-'));
for(const l of layers){const sets={};for(const p of ['dawn','day','dusk','night']){const a=blank(l.width,l.height);for(const [name,x,y,w]of l.objects){const b=body(name,w,p,l.id==='voyage-far');if(y+b.height>l.height)throw Error(name+' exceeds layer');paste(a,b,x,y);}save(l.id+'-'+p,a);sets[p]=[{image:l.id+'-'+p}];}m.ambience.push({id:l.id,slot:'back',order:l.order,optional:false,lite:'run',still:'first-frame',behaviour:{kind:'phase-strip',top:l.top,span:[-4096,4576],frames:{sprites:sets.day,frameMs:1000},drift:{pxPerSecond:l.width/1200,clock:'voyage'},byPhase:sets}});}
// Waterfall glints descend inside the existing water pixels; island, falls and
// their glints share the exact same world strip and voyage clock.
const fall=body('falls',166,'day'),sets={};
for(const p of ['dawn','day','dusk','night']){sets[p]=[];for(let f=0;f<4;f++){const a=blank(2048,180);for(let y=40;y<fall.height;y++)for(let x=0;x<fall.width;x++){const i=(y*fall.width+x)*4,[r,g,b,alpha]=fall.rgba.subarray(i,i+4);if(alpha&&b>g*1.07&&g>r*1.2&&g>95&&(y-f*3+120)%12<2&&x%3===0)a.rgba.set([170,223,250,255],(y*2048+x+340)*4);}const id='voyage-cascade-'+p+'-'+f;save(id,phase(a,p));sets[p].push({image:id});}}
m.ambience.push({id:'voyage-cascade',slot:'back',order:4.51,optional:false,lite:'run',still:'first-frame',behaviour:{kind:'phase-strip',top:-64,span:[-4096,4576],frames:{sprites:sets.day,frameMs:180,clock:'voyage'},drift:{pxPerSecond:2048/1200,clock:'voyage'},byPhase:sets}});
for(const row of m.atmosphere.table)row.voyage=1;m.atmosphere.delivered.voyage=1;m.atmosphere.clocks.voyage='voyage';m.requires=[...new Set([...m.requires,'phase-strip@1'])].sort();m.stage.fit.top=-90;
for(const e of m.ambience)if(['sea-far','sea-mid','sea-near','mist'].includes(e.id))e.behaviour.span=[-4096,4576];
for(const id of ['sea-far','sea-far-storm','sea-mid','sea-mid-storm','sea-near','sea-near-storm'])save(id,decodePng(fs.readFileSync(resolve(pack,id+'.png'))));
const preview=resolve(here,'renders/wide-day.png');if(fs.existsSync(preview))save('preview',quant(nearest(decodePng(fs.readFileSync(preview)),384,202),64));
fs.writeFileSync(file,JSON.stringify(m,null,2)+'\n');fs.writeFileSync(resolve(here,'layout.json'),JSON.stringify(layers,null,2)+'\n');
console.log('Pack bytes',Object.values(m.images).reduce((n,a)=>n+fs.statSync(resolve(pack,a.path)).size,0));

