/** Offline registration of the Sakura voyage. Runtime uses only existing pack capabilities. */
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {blank,crop,nearest,quant,paste,bounds} from '../build-art.mjs';
import {indexed} from '../water/anchor/register.mjs';
import {decodePng} from '../../../../test/png.ts';
import {splitSpiritSurface} from './surface.mjs';
import {registerCrewVariety} from '../crew-variety/register.mjs';
import {registerWaterInbetweens} from '../water/inbetweens.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../../..'),out=resolve(root,'art/settings/japanese-ship'),baseline='bae5478';
const p=JSON.parse(execFileSync('git',['show',baseline+':art/settings/japanese-ship/setting.json'],{cwd:root}));
const sha=b=>createHash('sha256').update(b).digest('hex'),read=id=>decodePng(execFileSync('git',['show',baseline+':art/settings/japanese-ship/'+id+'.png'],{cwd:root,maxBuffer:3e6}));
const source=name=>decodePng(readFileSync(resolve(here,'sources',name+'.png')));
const save=(id,a)=>{const b=indexed(a);writeFileSync(resolve(out,id+'.png'),b);p.images[id]={path:id+'.png',size:[a.width,a.height],sha256:sha(b)};return a;};
const clone=a=>({width:a.width,height:a.height,rgba:Buffer.from(a.rgba)});
const tint=(a,m)=>{a=clone(a);for(let i=0;i<a.rgba.length;i+=4)if(a.rgba[i+3])for(let k=0;k<3;k++)a.rgba[i+k]=Math.min(255,Math.round(a.rgba[i+k]*m[k]));return a;};
const width=2880,height=184,speed=width/1200,top=20,span=[-4096,4608],drift={pxPerSecond:speed,clock:'voyage'};
const atlas=source('landmarks'),night=source('landmarks-night'),day=blank(width,height),dark=blank(width,height),lights=blank(width,height),landmarks=[];
const cells=[[0,0,532,520],[532,0,492,520],[1024,0,512,520],[0,540,584,484],[540,540,520,484],[1060,540,476,484]];
const ids=['sakura-torii','pagoda-hill','fishing-village','snow-peak','cliff-castle','bamboo-shrine'];
for(let index=0;index<6;index++){
 const peak=index===3?source('snow-peak'):null,box=peak?[0,0,peak.width,peak.height]:cells[index],a=peak??crop(atlas,...box),n=peak?clone(peak):crop(night,...box);
 // Separate neighbouring generated cells at their transparent gap. This mask also
 // excludes the far peak's stray sliver from the castle cell, without repainting it.
 for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++){
  const gx=x+box[0],gy=y+box[1],edge=gy<820?580:gy<900?580-(gy-820)*.375:550-(gy-900)*.25;
  const cut=index===4?gx<edge+8:false;
  const i=(y*a.width+x)*4;if(cut||a.rgba[i+3]<224){a.rgba.fill(0,i,i+4);n.rgba.fill(0,i,i+4);}else{a.rgba[i+3]=255;n.rgba[i+3]=255;}
 }
 const trim=bounds(a),d0=crop(a,...trim),n0=crop(n,...trim),scale=Math.min(270/d0.width,144/d0.height),w=Math.round(d0.width*scale),h=Math.round(d0.height*scale);
 const d=quant(nearest(d0,w,h),48),nightInk=quant(nearest(n0,w,h),48),moonlit=tint(d,[.36,.44,.66]),lamp=blank(w,h);
 let litPixels=0;
 for(let i=0;i<d.rgba.length;i+=4){
  if(!d.rgba[i+3])continue;
  const [r,g,b]=nightInk.rgba.subarray(i,i+3),y=Math.floor(i/4/w);
  if([1,2,4,5].includes(index)&&r>140&&g>90&&b<r*.62&&r>g*1.08&&(index!==1||y>25)){
   moonlit.rgba.set([r,g,b,255],i);lamp.rgba.set([r,g,b,255],i);litPixels++;
  }
  // Retain only a small shore reflection, softly joining the independent moving bay.
  const x=i/4%w,edge=Math.min(1,x/3,(w-1-x)/3,(h-1-y)/5);
  if(edge<1){const alpha=Math.max(0,Math.min(255,Math.round(255*edge/32)*32));d.rgba[i+3]=alpha;moonlit.rgba[i+3]=alpha;lamp.rgba[i+3]=Math.min(lamp.rgba[i+3],alpha);}
 }
 const left=10+index*480,atY=height-h-2;paste(day,d,left,atY);paste(dark,moonlit,left,atY);paste(lights,lamp,left,atY);
 landmarks.push({id:ids[index],source:box,trim,at:[left,atY],size:[w,h],litPixels});
}
// A shared indexed palette keeps the full six-phase coast inside the pack budget.
quant(day,64);quant(dark,64);quant(lights,16);
const palettes={dawn:[.84,.72,.84],morning:[1,.97,.91],midday:[1,1,1],afternoon:[1,.89,.78],dusk:[.71,.55,.69]},byPhase={};
for(const phase of ['dawn','morning','midday','afternoon','dusk','night']){
 const id='voyage-coast-'+phase;save(id,phase==='night'?dark:tint(day,palettes[phase]));byPhase[phase]=[{image:id}];
}
const coast=p.ambience.find(e=>e.id==='coast-foreground');coast.id='voyage-coast';coast.behaviour={kind:'phase-strip',top,span,frames:{sprites:byPhase.midday,frameMs:1000},byPhase,drift};
// An independent shallow light cycle shares the coast's coordinates and voyage drift.
const lampAtlas=blank(width,height*4);
for(let frame=1;frame<=3;frame++)paste(lampAtlas,tint(lights,Array(3).fill([.78,.95,1.08][frame-1])),0,frame*height);
save('voyage-lights',lampAtlas);
const clear={image:'voyage-lights',rect:[0,0,width,height]},lit=[1,2,3].map(f=>({image:'voyage-lights',rect:[0,f*height,width,height]}));
p.ambience.push({id:'voyage-lights',slot:'back',order:4.2,lite:'run',still:'first-frame',behaviour:{kind:'phase-strip',top,span,frames:{sprites:[clear,clear,clear],frameMs:700},byPhase:Object.fromEntries(p.dayCycle.phases.map(({id})=>[id,id==='night'?lit:[clear,clear,clear]])),drift}});
// Coast-bound storm shading shares exactly the same loop, gaps and world waterline.
const shade=blank(width*2,height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const a=day.rgba[(y*width+x)*4+3];if(a)shade.rgba.set([32,52,76,a],(y*shade.width+x+width)*4);}
save('voyage-shade',shade);
const weather=p.ambience.find(e=>e.id==='coast-storm-shade');weather.id='voyage-shade';weather.behaviour={kind:'strip',top,span,frames:{sprites:[{image:'voyage-shade',rect:[0,0,width,height]}],frameMs:1000},drift,variants:[{id:'storm',frames:[{image:'voyage-shade',rect:[width,0,width,height]}],blend:'over',opacity:[[.35,0],[1,.5]]}]};
// Three widely spaced open-water berths move with the coast. Their rise cycles
// are offset by five poses; no shore creature is anchored to a viewport or stage edge.
const original=p.ambience.find(e=>e.id==='umibozu'),poses=original.behaviour.frames.sprites,spirit=blank(width,80*(poses.length+1)),berths=[370,1330,2290];
for(let frame=0;frame<poses.length;frame++)for(let berth=0;berth<berths.length;berth++){
 const sprite=poses[(frame+berth*5)%poses.length],a=crop(read(sprite.image),...sprite.rect);paste(spirit,a,berths[berth]-36,80*(frame+1));
}
save('voyage-umibozu',spirit);
const empty={image:'voyage-umibozu',rect:[0,0,width,80]};
original.behaviour={kind:'strip',top:100,span,frames:{sprites:poses.map(()=>empty),frameMs:500,clock:'swell'},drift,variants:[{id:'storm',frames:poses.map((_,i)=>({image:'voyage-umibozu',rect:[0,(i+1)*80,width,80]})),blend:'over',opacity:[[.78,0],[.780001,1]]}]};original.lite='hide';original.still='hide';
for(const row of p.atmosphere.table)row['voyage-pace']=1;p.atmosphere.delivered['voyage-pace']=1;p.atmosphere.clocks.voyage='voyage-pace';
const removed=['coast-front','coast-dawn-front','coast-morning-front','coast-afternoon-front','coast-dusk-front','coast-night-front','coast-storm-shade','umibozu','umibozu-sink'];
for(const id of removed){delete p.images[id];try{unlinkSync(resolve(out,id+'.png'));}catch(e){if(e.code!=='ENOENT')throw e;}}
splitSpiritSurface(p);
registerCrewVariety(p,out);
registerWaterInbetweens(p,out);
p.version='1.2.1';writeFileSync(resolve(out,'setting.json'),JSON.stringify(p,null,2)+'\n');
const imageBytes=Object.values(p.images).reduce((n,i)=>n+readFileSync(resolve(out,i.path)).length,0);
writeFileSync(resolve(here,'registration.json'),JSON.stringify({baseline,width,height,top,speed,lapSeconds:width/speed,berths,landmarks,imageBytes,sources:Object.fromEntries(['landmarks','landmarks-night','snow-peak'].map(n=>[n,sha(readFileSync(resolve(here,'sources',n+'.png')))])),removed},null,2)+'\n');
console.log(JSON.stringify({imageBytes,landmarks}));
