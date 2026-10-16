/** Mechanical registration, nearest sampling and fixed-palette normalization of generated raster sources. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const { PNG } = createRequire(resolve(root, 'docs/board-list/package.json'))('pngjs');
const pack = resolve(root, 'art/settings/ship');
const manifest = JSON.parse(readFileSync(resolve(pack, 'setting.json'), 'utf8'));
const palette = JSON.parse(readFileSync(resolve(here, '../water/manifest.json'), 'utf8')).palette.colours.map(hex => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)));
const read = file => PNG.sync.read(readFileSync(file));
const write = (file,png) => {mkdirSync(dirname(file),{recursive:true});writeFileSync(file,PNG.sync.write(png));};
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const colours = hexes => hexes.map(hex => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)));
const seaPalette=colours(['#151E2D','#1D314E','#22395A','#2C4869','#45617A','#536E87']);
const roughPalette=[...seaPalette,...colours(['#64849A','#8FA8B4'])];
function nearest(r,g,b,allowed) {
  let best=allowed[0], distance=Infinity;
  for(const colour of allowed) {const d=colour.reduce((sum,v,i)=>sum+(v-[r,g,b][i])**2,0);if(d<distance){best=colour;distance=d;}}
  return best;
}
function sample(source, rect, width, height, allowed=palette) {
  const out=new PNG({width,height});
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const sx=Math.min(source.width-1,Math.floor(rect[0]+(x+.5)*rect[2]/width)),sy=Math.min(source.height-1,Math.floor(rect[1]+(y+.5)*rect[3]/height));
    const a=(sy*source.width+sx)*4,b=(y*width+x)*4;
    if(source.data[a+3]<180)continue;
    out.data.set([...nearest(...source.data.subarray(a,a+3),allowed),255],b);
  }
  return out;
}
function bounds(source,rect) {
  let left=Infinity,top=Infinity,right=-1,bottom=-1;
  for(let y=rect[1];y<rect[1]+rect[3];y++)for(let x=rect[0];x<rect[0]+rect[2];x++)if(source.data[(y*source.width+x)*4+3]>=180) {
    left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
  if(right<0)throw Error('empty generated cell');
  return [left,top,right-left+1,bottom-top+1];
}
// Generated sheets occasionally put a hand a few source pixels across a cell boundary. Crop the main
// connected sprite in each cell, excluding that neighboring fragment; no shapes or pixels are repainted.
function crewBounds(source,rect) {
  const [x0,y0,w,h]=rect,seen=new Uint8Array(w*h);
  let largest=0,best;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    const start=y*w+x;
    if(seen[start]||source.data[((y+y0)*source.width+x+x0)*4+3]<180)continue;
    const queue=[start];seen[start]=1;let left=x,top=y,right=x,bottom=y;
    for(let at=0;at<queue.length;at++) {
      const i=queue[at],px=i%w,py=Math.floor(i/w);
      left=Math.min(left,px);right=Math.max(right,px);top=Math.min(top,py);bottom=Math.max(bottom,py);
      for(const [nx,ny] of [[px-1,py],[px+1,py],[px,py-1],[px,py+1]])if(nx>=0&&nx<w&&ny>=0&&ny<h) {
        const n=ny*w+nx;
        if(!seen[n]&&source.data[((ny+y0)*source.width+nx+x0)*4+3]>=180){seen[n]=1;queue.push(n);}
      }
    }
    if(queue.length>largest){largest=queue.length;best=[x0+left,y0+top,right-left+1,bottom-top+1];}
  }
  if(best===undefined)throw Error('empty crew sprite');
  return best;
}
function blit(source,out,x,y) {PNG.bitblt(source,out,0,0,source.width,source.height,x,y);}
function serve(id,path,png) {const file=resolve(pack,path);write(file,png);manifest.images[id]={path,size:[png.width,png.height],sha256:sha(file)};}
const poses=['front-walk-a','front-pass-a','front-walk-b','front-pass-b','side-walk-a','side-pass-a','side-walk-b','side-pass-b','front-idle','hauling','hauling-pull','waiting','climb-a','climb-b','lookout','thinking'];
const names=['base','outfit','bosun','old-salt','navigator','carpenter','rigger','deckhand'];
const registration=[];
const contact=new PNG({width:32*16,height:40*8});
for(const [lookIndex,name] of names.entries()) {
  const source=read(resolve(here,`source/crew-${name}.png`));
  const atlas=new PNG({width:128,height:160});
  const frames={};
  const idle=crewBounds(source,[0,Math.round(source.height/2),Math.round(source.width/4),Math.round(source.height*3/4)-Math.round(source.height/2)]);
  const scale=32/idle[3];
  for(let i=0;i<16;i++) {
    const col=i%4,row=Math.floor(i/4);
    const x0=Math.round(col*source.width/4),y0=Math.round(row*source.height/4);
    const rect=crewBounds(source,[x0,y0,Math.round((col+1)*source.width/4)-x0,Math.round((row+1)*source.height/4)-y0]);
    // One scale per identity retains the crouch and raised hands; every pose registers at its soles.
    const height=Math.min(36,Math.round(rect[3]*scale)),width=Math.min(30,Math.round(rect[2]*scale));
    const sprite=sample(source,rect,width,height);
    const left=Math.floor((32-width)/2),top=36-height;
    let footLeft=width,footRight=0;
    for(let y=Math.max(0,height-8);y<height;y++)for(let x=0;x<width;x++)if(sprite.data[(y*width+x)*4+3]){footLeft=Math.min(footLeft,x);footRight=Math.max(footRight,x);}
    const footX=Math.round((footLeft+footRight+1)/2);
    blit(sprite,atlas,col*32+left,row*40+top);
    blit(sprite,contact,i*32+left,lookIndex*40+top);
    frames[poses[i]]={rect:[col*32+left,row*40+top,width,height],feet:[footX,height]};
    registration.push({look:name,pose:poses[i],source:rect,output:[col*32+left,row*40+top,width,height]});
  }
  // Legacy choreography may ask the resting side/lean roles; both use the generated passing/attentive art.
  frames['side-idle']=frames['side-pass-a'];frames.leaning=frames.thinking;
  serve(`polish-crew-${name}`,`polish/crew-${name}.png`,atlas);
  manifest.cast.lanes[name]=frames;
  const look=manifest.cast.looks[lookIndex];look.image=`polish-crew-${name}`;look.lane=name;
}
write(resolve(here,'crew-contact.png'),contact);
writeFileSync(resolve(here,'registration.json'),JSON.stringify(registration,null,2)+'\n');
// Runtime replacements retain the old ids/paths so independently missing images keep the same fallbacks.
const foam=read(resolve(here,'source/foam.png'));
for(let i=0;i<3;i++) {
  const y=Math.round(i*foam.height/3), end=Math.round((i+1)*foam.height/3);
  const rect=bounds(foam,[0,y,foam.width,end-y]);
  const strip=new PNG({width:256,height:16});
  blit(sample(foam,[0,rect[1],foam.width,rect[3]],256,8),strip,0,4);
  serve(`water-foam-frame-${i}`,`water/foam/frame-${i}.png`,strip);
  if(i===0)serve('sea-foam-strip','sea/foam-strip.png',strip);
}
for(const [sourceName,prefix] of [['sea','water'],['sea-rough','storm']]) {
  const sea=read(resolve(here,`source/${sourceName}.png`));
  for(let i=0;i<4;i++) {
    const y=Math.round(i*sea.height/4),end=Math.round((i+1)*sea.height/4);
    const tile=sample(sea,[0,y+1,sea.width,end-y-2],512,128,prefix==='water'?seaPalette:roughPalette);
    serve(`${prefix}-sea-frame-${i}`,`${prefix}/sea/frame-${i}.png`,tile);
    if(i===0&&prefix==='water')serve('sea-water-tile','sea/water-tile.png',tile);
  }
}
const gull=read(resolve(here,'source/gull.png'));
serve('gull-flap-strip','gull/flap-strip.png',sample(gull,[0,0,gull.width,gull.height],96,32));
const ladder=read(resolve(here,'source/ladder.png'));
serve('polish-ladder','polish/ladder.png',sample(ladder,bounds(ladder,[0,0,ladder.width,ladder.height]),14,144));
if(!manifest.stage.parts.some(p=>p.id==='access-ladder'))manifest.stage.parts.push({id:'access-ladder',needs:['tall-mast'],lite:'run',still:'first-frame',sprite:{image:'polish-ladder'},at:[215,-38]});
// The occupied basket is rigid with the main mast. Only the tip above it keeps the subtle sway.
const tall=manifest.stage.parts.find(p=>p.id==='tall-mast'),tip=manifest.stage.parts.find(p=>p.id==='topmast');
tall.sprite.rect=[0,20,48,172];tall.at=[187,-60];tip.sprite.rect=[0,0,48,20];
if(!manifest.stage.pieces.some(p=>p.id==='nest-rim'))manifest.stage.pieces.push({id:'nest-rim',optional:true,sprite:{image:'mast-tall-mast',rect:[0,32,48,16]},at:[187,-48],baseline:112});
for(const id of Object.keys(manifest.images).filter(id=>id.startsWith('crew-variants-')))delete manifest.images[id];
manifest.cast.roles.walkFront=poses.slice(0,4);manifest.cast.roles.walkSide=poses.slice(4,8);
manifest.cast.roles.rise=0;manifest.cast.roles.stepMs=160;
manifest.cast.roles.settled.blocked.pose='thinking';
manifest.cast.fidgets.working={periodMs:1200,seedMs:37,keys:[{fromMs:0,dx:0,dy:0,pose:'hauling'},{fromMs:600,dx:0,dy:0,pose:'hauling-pull'}]};
manifest.cast.fidgets.waiting={periodMs:2800,seedMs:37,keys:[{fromMs:0,dx:0,dy:0,pose:'waiting'},{fromMs:2200,dx:0,dy:0,pose:'front-idle'}]};
manifest.cast.fidgets.blocked={periodMs:4600,seedMs:37,keys:[{fromMs:0,dx:0,dy:0,pose:'thinking'},{fromMs:3400,dx:0,dy:0,pose:'front-idle'}]};
manifest.stage.tintByPhase={dawn:'#CBC1CE',dusk:'#B8A1B8',night:'#687594'};
// The post's base remains on navigable floor; its authored route reaches the raised lookout station.
const lookout=manifest.zones.zones.find(z=>z.id==='station').posts[0];
lookout.at=[222,98];
lookout.transit={path:[[222,-35],[218,-35]],speed:24,poses:['climb-a','climb-b'],stepMs:260,settled:'lookout',front:'mast',needs:['mast-tall-mast','polish-ladder']};
if(!manifest.requires.includes('post-transit@1'))manifest.requires.push('post-transit@1');
for(const capability of ['phase-tint@1','pose-fidgets@1'])if(!manifest.requires.includes(capability))manifest.requires.push(capability);
const catalogue=readFileSync(resolve(root,'shared/deck-setting.ts'),'utf8').match(/export const ENGINE_CAPABILITIES = \[([\s\S]*?)\]/)[1].match(/"([\w-]+@\d+)"/g).map(x=>JSON.parse(x));
manifest.requires.sort((a,b)=>catalogue.indexOf(a)-catalogue.indexOf(b));
manifest.version='1.4.0';
writeFileSync(resolve(pack,'setting.json'),JSON.stringify(manifest,null,2)+'\n');
