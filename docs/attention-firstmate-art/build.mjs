/** A1 offline asset registration. Reads installed packs; writes only this docs folder. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { decodePng } from '../../test/png.ts';
import { blank, crop, nearest, encode, paste, quant } from '../settings/japanese-ship/build-art.mjs';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
const configs = JSON.parse(readFileSync(resolve(here, 'settings.json')));
const read = file => decodePng(readFileSync(file));
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const save = (file, image) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, encode(image)); };
const json = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const hex = (r,g,b) => '#' + [r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();
const opaque = (a,x,y) => a.rgba[(y*a.width+x)*4+3] >= 180;

// As in ship polish/build.mjs, isolate the main generated figure in each source cell.
// Eight-connected coverage retains diagonal pixel-art edges, excluding neighbour fragments.
function figureBounds(a, rect) {
  const [x0,y0,w,h]=rect, seen=new Uint8Array(w*h); let best, most=0;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const start=y*w+x; if(seen[start]||!opaque(a,x0+x,y0+y)) continue;
    const queue=[start]; seen[start]=1; let l=x,t=y,r=x,b=y;
    for(let at=0;at<queue.length;at++) {
      const p=queue[at], px=p%w,py=Math.floor(p/w);
      l=Math.min(l,px);r=Math.max(r,px);t=Math.min(t,py);b=Math.max(b,py);
      for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
        const nx=px+dx,ny=py+dy,n=ny*w+nx;
        if(nx>=0&&ny>=0&&nx<w&&ny<h&&!seen[n]&&opaque(a,x0+nx,y0+ny)) { seen[n]=1;queue.push(n); }
      }
    }
    if(queue.length>most) {most=queue.length;best=[x0+l,y0+t,r-l+1,b-t+1];}
  }
  if(!best) throw Error('Empty source cell ' + rect); return best;
}
function sourceCell(a,config,i) {
  const [cols,rows]=config.sourceGrid,x=Math.round((i%cols)*a.width/cols),y=Math.round(Math.floor(i/cols)*a.height/rows);
  return [x,y,Math.round((i%cols+1)*a.width/cols)-x,Math.round((Math.floor(i/cols)+1)*a.height/rows)-y];
}
function footCentre(a) {
  let l=a.width,r=-1;
  for(let y=Math.max(0,a.height-Math.ceil(a.height/4));y<a.height;y++) for(let x=0;x<a.width;x++) if(opaque(a,x,y)) {l=Math.min(l,x);r=Math.max(r,x);}
  return r<0?a.width/2:(l+r+1)/2;
}
function normalize(a,width,height,footX,palette,alpha) {
  const b=blank(width,height), pivot=footCentre(a), memo=new Map();
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    // The two sides sample independently about the foot pivot. This retains the existing
    // tight rectangle AND foot anchor without clipping a hat, rope, coat or raised hand.
    const sx=Math.max(0,Math.min(a.width-1,Math.floor(x<footX?(x+.5)*pivot/footX:pivot+(x+.5-footX)*(a.width-pivot)/(width-footX))));
    const sy=Math.min(a.height-1,Math.floor((y+.5)*a.height/height)),i=(sy*a.width+sx)*4;
    if(a.rgba[i+3]<180) continue;
    const rgb=Array.from(a.rgba.subarray(i,i+3)),key=rgb.join(',');let chosen=memo.get(key);
    if(!chosen) { let distance=Infinity;
      for(const p of palette) {const d=p.reduce((sum,v,c)=>sum+(v-rgb[c])**2,0);if(d<distance){distance=d;chosen=p;}}
      memo.set(key,chosen);
    }
    b.rgba.set([...chosen,alpha],(y*width+x)*4);
  }
  return b;
}
function paletteFor(config,pack,source) {
  if(config.paletteRecord) return JSON.parse(readFileSync(resolve(root,config.paletteRecord))).palette.colours;
  // Existing cast pixels are the palette authority for packs without a single global table.
  // Union of cast looks provides native skin, clothing and brass colours; no invented swatches.
  const colours=new Set();
  for(const look of pack.cast.looks) {
    const a=read(resolve(root,'art/settings',config.id,pack.images[look.image].path));
    for(let i=0;i<a.rgba.length;i+=4) if(a.rgba[i+3]) colours.add(hex(...a.rgba.subarray(i,i+3)));
  }
  // A pack can have hundreds of shades across all generated looks. Use the existing
  // median-cut helper to find 32 representative source colours, then snap each to an
  // ACTUAL existing cast RGB. One fixed palette across all poses avoids frame flicker.
  const reduced=quant(nearest(source,Math.round(source.width/4),Math.round(source.height/4)),32);
  const candidates=new Set(),native=[...colours].map(h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)));
  for(let i=0;i<reduced.rgba.length;i+=4)if(reduced.rgba[i+3])candidates.add(hex(...reduced.rgba.subarray(i,i+3)));
  const selected=new Set();
  for(const candidate of candidates) {
    const rgb=[1,3,5].map(i=>parseInt(candidate.slice(i,i+2),16));let chosen,distance=Infinity;
    for(const p of native){const d=p.reduce((sum,v,c)=>sum+(v-rgb[c])**2,0);if(d<distance){distance=d;chosen=p;}}
    selected.add(hex(...chosen));
  }
  return [...selected].sort();
}
function mirror(a) {
  const b=blank(a.width,a.height);
  for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++)b.rgba.set(a.rgba.subarray((y*a.width+x)*4,(y*a.width+x+1)*4),(y*b.width+b.width-1-x)*4);
  return b;
}
// Contact sheets composite only for review. Outputs themselves keep true alpha.
function over(dst,src,x0,y0) {
  for(let y=0;y<src.height;y++)for(let x=0;x<src.width;x++){
    const s=(y*src.width+x)*4,d=((y+y0)*dst.width+x+x0)*4,t=src.rgba[s+3]/255;
    for(let c=0;c<3;c++)dst.rgba[d+c]=Math.round(src.rgba[s+c]*t+dst.rgba[d+c]*(1-t));
    dst.rgba[d+3]=255;
  }
}
const all=[];
for(const config of configs) {
  const packFile=resolve(root,'art/settings',config.id,'setting.json'),pack=JSON.parse(readFileSync(packFile));
  const lane=pack.cast.lanes[config.lane], reference=pack.images[config.referenceImage];
  const sourceFile=resolve(here,'sources',config.id+'.png'),source=read(sourceFile),atlas=blank(...reference.size);
  const palette=paletteFor(config,pack,source),rgb=palette.map(h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)));
  const out=resolve(here,'output',config.id);mkdirSync(out,{recursive:true});
  const poses=[],seen=new Set();
  for(const [name,frame] of Object.entries(lane)) {
    const key=frame.rect.join(','); if(seen.has(key))continue;seen.add(key);
    const i=poses.length,cell=sourceCell(source,config,i),bounds=figureBounds(source,cell),figure=crop(source,...bounds);
    const [x,y,w,h]=frame.rect;let body,at;
    if(config.id==='ghost-ship') {
      const scale=Math.min(22/figure.width,25/figure.height),width=Math.max(1,Math.round(figure.width*scale)),height=Math.max(1,Math.round(figure.height*scale));
      const left=Math.floor((w-width)/2);body=normalize(figure,width,height,frame.feet[0]-left,rgb,config.alpha);at=[x+left,y+frame.feet[1]-height];
    } else {body=normalize(figure,w,h,frame.feet[0],rgb,config.alpha);at=[x,y];}
    paste(atlas,body,...at);
    poses.push({name,sourceCell:cell,sourceBounds:bounds,rect:frame.rect,feet:frame.feet,outputBody:[...at,body.width,body.height]});
  }
  const atlasFile=resolve(out,'firstmate.png');save(atlasFile,atlas);
  const stand=lane[config.standing],right=crop(atlas,...stand.rect),left=mirror(right);
  // Separate physical left/right crops, identical to the renderer's existing flip.
  const directions=blank(right.width*2,right.height);paste(directions,right,0,0);paste(directions,left,right.width,0);
  const directionsFile=resolve(out,'standing-directions.png');save(directionsFile,directions);
  const outputs=[['firstmate.png',atlas],['standing-directions.png',directions]];
  let raisedHand;
  if(config.extraRaisedHand!==undefined) {
    const rect=sourceCell(source,config,config.extraRaisedHand),bounds=figureBounds(source,rect),a=crop(source,...bounds);
    const width=Math.min(28,Math.round(a.width*32/a.height)),body=normalize(a,width,32,Math.round(width/2),rgb,config.alpha);
    const raised=blank(32,36),x=Math.floor((32-width)/2);paste(raised,body,x,2);save(resolve(out,'hand-raised.png'),raised);
    outputs.push(['hand-raised.png',raised]);raisedHand={image:'hand-raised.png',rect:[0,0,32,36],feet:[x+Math.round(width/2),34],sourceBounds:bounds};
  }
  const manifest={schemaVersion:1,id:'firstmate-a1-'+config.id,created:'2026-10-19',status:'Assets only; not registered with the runtime pack.',baseCommit:'e9d933e',setting:config.id,title:config.title,
    sourcePack:{path:relative(root,packFile).replaceAll('\\','/'),sha256:hash(packFile),version:pack.version},
    reference:{image:config.referenceImage,path:'art/settings/'+config.id+'/'+reference.path,sha256:reference.sha256,lane:config.lane},
    logicalPixelScale:{pixel:'1 art pixel = 1 native cast pixel',sampling:'nearest-neighbour',scale:'inherit the setting cast scale'},
    palette:{source:config.paletteRecord??'32-colour subset of existing setting cast RGB values; source median-cut representatives snapped to actual existing cast colours',colours:palette},
    alpha:{background:0,painted:config.alpha,transparentRgb:[0,0,0]},
    images:Object.fromEntries(outputs.map(([name,a])=>[name,{path:name,size:[a.width,a.height],sha256:hash(resolve(out,name))}])),
    lane,roles:pack.cast.roles,breath:pack.cast.breath??null,
    standing:{sourcePose:config.standing,image:'standing-directions.png',right:{rect:[0,0,right.width,right.height],feet:stand.feet},left:{rect:[right.width,0,left.width,left.height],feet:[left.width-stand.feet[0],stand.feet[1]]},note:'Right is the native pose. Left is its exact pixel mirror; foot X follows the same horizontal mirror. Runtime may instead mirror the native pose as it already does.'},
    ...(raisedHand?{raisedHand}:{}),poses};
  json(resolve(out,'manifest.json'),manifest);
  all.push({config,manifest,atlas,right,left,out,sourceFile});
}

// Each pair of contact rows: all native poses on dark, then the same on light.
const contact=blank(16*36,all.length*2*44);
for(let s=0;s<all.length;s++) {
  const {manifest,atlas}=all[s];
  for(let row=0;row<2;row++) {
    const top=s*88+row*44;
    for(let y=top;y<top+44;y++)for(let x=0;x<contact.width;x++)contact.rgba.set([...(row?[225,221,209]:[30,40,52]),255],(y*contact.width+x)*4);
    manifest.poses.forEach((pose,i)=>{const a=crop(atlas,...pose.rect);over(contact,a,i*36+Math.floor((36-a.width)/2),top+38-pose.feet[1]);});
  }
}
save(resolve(here,'contact-sheet.png'),nearest(contact,contact.width*3,contact.height*3));
const standings=blank(5*40,4*48*2);
for(let s=0;s<all.length;s++) {
  const {manifest,atlas,right,left,out}=all[s],reference=read(resolve(root,manifest.reference.path));
  const frontName=manifest.roles.stand,front=crop(atlas,...manifest.lane[frontName].rect),old=crop(reference,...manifest.lane[frontName].rect);
  const images=[old,front,right,left,manifest.raisedHand?read(resolve(out,'hand-raised.png')):null];
  for(let row=0;row<2;row++) {
    const top=s*96+row*48;
    for(let y=top;y<top+48;y++)for(let x=0;x<standings.width;x++)standings.rgba.set([...(row?[225,221,209]:[30,40,52]),255],(y*standings.width+x)*4);
    images.forEach((a,i)=>{if(a)over(standings,a,i*40+Math.floor((40-a.width)/2),top+40-a.height);});
  }
}
save(resolve(here,'standing-comparison.png'),nearest(standings,standings.width*4,standings.height*4));
json(resolve(here,'registration.json'),all.map(({manifest})=>({setting:manifest.setting,lane:manifest.reference.lane,poses:manifest.poses})));
console.log('Registered '+all.map(a=>a.config.id).join(', ')+'; review sheets written.');
