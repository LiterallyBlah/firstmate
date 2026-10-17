/** Offline registration of generated source art. No pack scripts or runtime drawing. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {decodePng} from '../../../test/png.ts';
import {blank,crop,nearest,quant,encode,paste,bounds} from '../japanese-ship/build-art.mjs';
import {polishAtmosphere} from './polish-art.mjs';
const here=dirname(fileURLToPath(import.meta.url)),out=resolve(here,'../../../art/settings/ship'),baseline=resolve(here,'../../../test/fixtures/ship-baseline');
mkdirSync(out,{recursive:true});
const images={},sources={},sha=b=>createHash('sha256').update(b).digest('hex');
const read=p=>decodePng(readFileSync(p));
const source=n=>{const p=resolve(here,'sources',n+'.png'),b=readFileSync(p);sources[n]={sha256:sha(b)};return decodePng(b);};
const save=(n,a)=>{const b=encode(a);writeFileSync(resolve(out,n+'.png'),b);images[n]={path:n+'.png',size:[a.width,a.height],sha256:sha(b)};return a;};
const clone=a=>({width:a.width,height:a.height,rgba:Buffer.from(a.rgba)});
const pixel=(a,x,y)=>a.rgba.subarray((y*a.width+x)*4,(y*a.width+x)*4+4);
const put=(a,x,y,c)=>{if(x>=0&&y>=0&&x<a.width&&y<a.height)a.rgba.set(c,(y*a.width+x)*4);};
const blit=(a,b,x,y)=>{for(let row=0;row<b.height;row++)for(let col=0;col<b.width;col++)if(pixel(b,col,row)[3])put(a,x+col,y+row,pixel(b,col,row));};
const trim=a=>crop(a,...bounds(a));
const fit=(a,w,h,colours=24)=>{a=trim(a);const s=Math.min(w/a.width,h/a.height),b=quant(nearest(a,Math.max(1,Math.round(a.width*s)),Math.max(1,Math.round(a.height*s))),colours),c=blank(w,h);blit(c,b,Math.floor((w-b.width)/2),h-b.height);return c;};
const frames=(n,list)=>list.forEach((a,i)=>save(n+'-'+i,a));
const tint=(a,mul,add=[0,0,0])=>{a=clone(a);for(let i=0;i<a.rgba.length;i+=4)if(a.rgba[i+3])for(let c=0;c<3;c++)a.rgba[i+c]=Math.max(0,Math.min(255,Math.round(a.rgba[i+c]*mul[c]+add[c])));return a;};
const cell=(a,i,cols,rows)=>{const x=Math.round(i%cols*a.width/cols),y=Math.round(Math.floor(i/cols)*a.height/rows),r=Math.round((i%cols+1)*a.width/cols),b=Math.round((Math.floor(i/cols)+1)*a.height/rows);return crop(a,x,y,r-x,b-y);};
const original=JSON.parse(readFileSync(resolve(baseline,'setting.json')));
// Preserve all eight original cast looks and their native frame anchors, plus proven water/effect art.
for(const [id,v]of Object.entries(original.images)){
 if(id==='deck'||id.startsWith('mast-')||id.startsWith('plank-')||id.startsWith('sails-')||id==='polish-ladder')continue;
 const b=readFileSync(resolve(baseline,v.path)),name='legacy-'+id;writeFileSync(resolve(out,name+'.png'),b);images[id]={...v,path:name+'.png'};
}
const ship=blank(640,400),body=quant(nearest(trim(source('stage')),570,330),48);paste(ship,body,40,20);
// Clear baked empty portholes with adjacent generated hull planks; engine-owned sleepers supply their windows.
const hullPlanks=crop(ship,252,313,25,31);
for(let x=166;x<566;x+=25)paste(ship,hullPlanks,x,313);
save('ship',ship);
const fixed=clone(ship),parts={flag:[332,26,51,40],'sail-main':[262,109,155,117],'sail-fore':[149,138,111,88],jib:[42,157,116,79]};
for(const [name,rect]of Object.entries(parts)){
 const a=crop(ship,...rect);for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++)put(fixed,x+rect[0],y+rect[1],[0,0,0,0]);
 frames(name,[0,1,2,3].map(f=>{const b=blank(a.width,a.height),phase=Math.sin(f*Math.PI/2);for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++){
  const dx=name==='flag'?0:Math.round(phase*1.5*Math.sin(Math.PI*y/a.height));
  const dy=name==='flag'?Math.round(phase*2*Math.sin(Math.PI*x/a.width)):0;
  const sx=x-dx,sy=y-dy;if(sx>=0&&sx<a.width&&sy>=0&&sy<a.height)put(b,x,y,pixel(a,sx,sy));
 }return b;}));
}
save('fixed',fixed);
save('access-ladder',quant(nearest(read(resolve(baseline,'polish/ladder.png')),12,190),16));
// The generated navy correction is confined to its cell; other creatures retain the first atlas poses.
const life=source('life'),navy=source('life-navy');
const lifeCell=(atlas,i)=>{const rows=[[0,275],[280,230],[520,218],[740,284]],r=rows[Math.floor(i/4)];return crop(atlas,(i%4)*384,r[0],384,r[1]);};
const creature=(i,w,h)=>fit(lifeCell(life,i),w,h);
frames('dolphin',[0,1,2,3].map(i=>{
 // Keep one frame grid and waterline; do not stretch every pose to the same height.
 const a=lifeCell(life,i),b=blank(64,52),native=quant(nearest(a,64,43),20);blit(b,native,0,9);return b;
}));
frames('whale',[4,5,6,7].map(i=>quant(nearest(lifeCell(life,i),70,47),16)));
frames('cat',[8,9].map(i=>creature(i,24,20)));
frames('perched-gull',[10,11].map(i=>creature(i,24,20)));
save('flying-fish',creature(14,28,20));
save('plank',quant(nearest(trim(lifeCell(life,15)),100,10),16));
save('merchant',creature(12,86,66));save('navy',fit(lifeCell(navy,13),112,84));
// Long empty lane makes merchants genuinely pass, rather than hover forever on the horizon.
const merchant=read(resolve(out,'merchant.png')),frigate=read(resolve(out,'navy.png'));
for(let f=0;f<4;f++){
 const m=blank(1536,70);blit(m,merchant,400,4+(f%2));save('merchant-lane-'+f,m);
 const n=blank(116,88);blit(n,frigate,2+(f%2),2+(f%2));save('navy-chase-'+f,n);
}
save('merchant-clear',blank(1536,70));
// A quiet marine visitor is invisible, never a held tail or back. Two registered leap
// lanes vary the dolphin's location without introducing runtime/random motion code.
save('dolphin-submerged',blank(96,40));
for(let lane=0;lane<2;lane++)for(let f=0;f<4;f++){
 const a=blank(96,40);blit(a,nearest(read(resolve(out,'dolphin-'+f+'.png')),48,34),lane?38:8,6);save('dolphin-leap-'+lane+'-'+f,a);
}
for(let lane=0;lane<2;lane++){
 const a=blank(96,40),tail=read(resolve(out,'dolphin-3.png'));
 // Only the bottom contact foam survives the final splash; all dolphin pixels disappear.
 blit(a,nearest(crop(tail,0,48,64,4),48,3),lane?38:8,37);save('dolphin-splash-'+lane,a);
}
save('whale-submerged',blank(2048,47));
for(let f=0;f<4;f++){const a=blank(2048,47);blit(a,read(resolve(out,'whale-'+f+'.png')),445,0);save('whale-voyage-'+f,a);}
// The pursuing frigate advances through a long horizon lane instead of staying pinned.
save('navy-away',blank(1536,88));
for(let f=0;f<4;f++){const a=blank(1536,88);blit(a,read(resolve(out,'navy-chase-'+f+'.png')),482,0);save('navy-lane-'+f,a);}
// Register four land regions on common waterlines with transparent open-ocean gaps.
// Descending source-x order is the order encountered by a leftward-sailing ship.
const coast=source('coast'),night=source('coast-night'),day=blank(2048,112),dark=blank(2048,112),landmarks=[];
const boxes=[[0,710],[710,480],[1190,485],[1675,497]],centres=[260,1796,1284,772];
for(let i=0;i<4;i++){
 const [x,w]=boxes[i],dayPart=trim(crop(coast,x,0,w,coast.height)),nightPart=trim(crop(night,x,0,w,night.height));
 const s=Math.min(370/dayPart.width,92/dayPart.height),width=Math.round(dayPart.width*s),height=Math.round(dayPart.height*s);
 const d=quant(nearest(dayPart,width,height),32),n=quant(nearest(nightPart,width,height),32);
 const moonlit=tint(d,[.32,.43,.64]);
 for(let p=0;p<d.rgba.length;p+=4){
  // Exact day silhouette and pixel geometry; transfer only generated night lamp/window ink.
  if(!d.rgba[p+3])continue;
  const [r,g,b,a]=n.rgba.subarray(p,p+4);
  if(i>=2&&a&&r>130&&g>85&&b<r*.65&&r>g*1.05)moonlit.rgba.set([r,g,b,255],p);
 }
 const left=centres[i]-Math.floor(width/2),top=108-height;
 blit(day,d,left,top);blit(dark,moonlit,left,top);
 landmarks.push({id:['cove','fort','port','lighthouse'][i],source:boxes[i],at:[left,top],size:[width,height],centre:centres[i]});
}
save('coast-midday',day);save('coast-night',dark);
for(const [name,mul,add]of [['dawn',[.84,.72,.8],[8,4,8]],['morning',[1,.94,.85],[0,0,0]],['afternoon',[1,.89,.72],[0,0,0]],['dusk',[.71,.55,.64],[14,5,9]]])save('coast-'+name,tint(day,mul,add));
// Extract generated beam cores; anchor each bright origin to the same lighthouse pixel.
const lights=source('lights'),moon=fit(cell(lights,4,4,2),42,42,12);
const skyMoon=blank(512,320);blit(skyMoon,moon,300,100);save('moon',skyMoon);
// Palette transfer of existing generated skies preserves the six phases but lifts the daytime ocean air.
for(const [phase,mul,add]of [['midday',[.8,1.1,1.28],[0,26,40]],['morning',[.95,1.08,1.18],[8,18,24]],['afternoon',[1.12,1.08,1.08],[10,15,15]],['dawn',[1.1,.98,1.08],[12,8,15]],['dusk',[1.05,.95,1.08],[12,6,12]]]){
 const a=tint(read(resolve(baseline,'sky',phase+'.png')),mul,add);save('sky-'+phase,a);
}
const lighthouse=landmarks[3];
// Lighthouse is left of the centre of its island in the generated plate.
const lamp=[lighthouse.at[0]+Math.round(lighthouse.size[0]*.51),lighthouse.at[1]+Math.round(lighthouse.size[1]*.13)];
for(let f=0;f<4;f++){
 const a=cell(lights,f,4,2),cut=crop(a,0,210,384,185),b=nearest(cut,104,50),beam=blank(2048,112);
 let best=-1,origin=[0,0];for(let y=0;y<b.height;y++)for(let x=0;x<b.width;x++){
  const p=pixel(b,x,y),score=p[0]+p[1]+p[2];if(p[3]>180&&score>best){best=score;origin=[x,y];}
  if(p[3]<160)put(b,x,y,[0,0,0,0]);else put(b,x,y,[p[0],p[1],p[2],Math.round(p[3]*.38)]);
 }
 blit(beam,b,lamp[0]-origin[0],lamp[1]-origin[1]);save('beam-'+f,beam);
}
save('beam-clear',blank(2048,112));
// Proven generated rain art, with a transparent calm base.
for(const id of ['rain-clear','rain-0','rain-1','rain-2','rain-3']){
 const b=readFileSync(resolve(here,'../../../art/settings/sky-airship',id+'.png'));writeFileSync(resolve(out,id+'.png'),b);const a=decodePng(b);images[id]={path:id+'.png',size:[a.width,a.height],sha256:sha(b)};
}
polishAtmosphere({source,save,read,baseline,clone,pixel,put,blit,fit,tint});
for(const id of ['moon','sky-stars']){const a=blank(512,2048);blit(a,read(resolve(out,images[id].path)),0,0);save(id,a);}
// Frozen thumbnail of the reviewed daytime canvas (384x200, 48 colours).
// Keep this source independent of regenerated review evidence.
save('preview',source('preview-canvas'));
writeFileSync(resolve(here,'registration.json'),JSON.stringify({sources,images,parts,landmarks,lamp},null,2)+'\n');
writeFileSync(resolve(here,'review/coast-registration.png'),encode(day));
writeFileSync(resolve(here,'review/coast-night-registration.png'),encode(dark));
console.log(JSON.stringify({registeredImages:Object.keys(images).length,bytes:Object.values(images).reduce((n,v)=>n+readFileSync(resolve(out,v.path)).length,0),landmarks,lamp}));
