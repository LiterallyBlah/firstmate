/** Offline registration of generated art; no drawing or runtime code. Node 24, no extra dependencies. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {crc32,deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {decodePng} from '../../../test/png.ts';
const here=dirname(fileURLToPath(import.meta.url)),out=resolve(here,'../../../art/settings/japanese-ship');
mkdirSync(out,{recursive:true});
export const blank=(width,height)=>({width,height,rgba:Buffer.alloc(width*height*4)});
export function crop(a,x,y,width,height){const b=blank(width,height);for(let row=0;row<height;row++)b.rgba.set(a.rgba.subarray(((y+row)*a.width+x)*4,((y+row)*a.width+x+width)*4),row*width*4);return b;}
export function nearest(a,width,height){const b=blank(width,height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=(Math.min(a.height-1,Math.floor((y+.5)*a.height/height))*a.width+Math.min(a.width-1,Math.floor((x+.5)*a.width/width)))*4;b.rgba.set(a.rgba.subarray(at,at+4),(y*width+x)*4);}return b;}
function bounds(a){let x0=a.width,y0=a.height,x1=-1,y1=-1;for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++)if(a.rgba[(y*a.width+x)*4+3]>=224){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}if(x1<0)throw Error('empty art');return [x0,y0,x1-x0+1,y1-y0+1];}
function paste(a,b,x,y){for(let row=0;row<b.height;row++)a.rgba.set(b.rgba.subarray(row*b.width*4,(row+1)*b.width*4),((y+row)*a.width+x)*4);}
/** Weighted median-cut palette, then nearest palette colour; binary alpha removes generation edge haze. */
function palette(a,limit){
  const counts=new Map();
  for(let i=0;i<a.rgba.length;i+=4)if(a.rgba[i+3]>=224){const rgb=[a.rgba[i],a.rgba[i+1],a.rgba[i+2]].map(v=>Math.round(v/4)*4);const key=rgb.join(',');const entry=counts.get(key);if(entry)entry.n++;else counts.set(key,{rgb,n:1});}
  const boxes=[[...counts.values()]];
  const range=box=>[0,1,2].map(c=>Math.max(...box.map(p=>p.rgb[c]))-Math.min(...box.map(p=>p.rgb[c])));
  while(boxes.length<limit){let choice=-1,score=-1,axis=0;for(const [i,box]of boxes.entries())if(box.length>1){const r=range(box),span=Math.max(...r),s=span*Math.sqrt(box.reduce((n,p)=>n+p.n,0));if(s>score){choice=i;score=s;axis=r.indexOf(span);}}if(choice<0)break;const box=boxes.splice(choice,1)[0].sort((a,b)=>a.rgb[axis]-b.rgb[axis]),half=box.reduce((n,p)=>n+p.n,0)/2;let n=0,cut=1;for(let i=0;i<box.length-1;i++){n+=box[i].n;if(n>=half){cut=i+1;break;}}boxes.push(box.slice(0,cut),box.slice(cut));}
  return boxes.map(box=>{const n=box.reduce((s,p)=>s+p.n,0);return [0,1,2].map(c=>Math.min(255,Math.round(box.reduce((s,p)=>s+p.rgb[c]*p.n,0)/n)));});
}
function quant(a,limit,fixedPalette){const colours=fixedPalette??palette(a,limit),memo=new Map();for(let i=0;i<a.rgba.length;i+=4){if(a.rgba[i+3]<224){a.rgba.fill(0,i,i+4);continue;}const key=a.rgba[i]*65536+a.rgba[i+1]*256+a.rgba[i+2];let colour=memo.get(key);if(!colour){let best=Infinity;for(const c of colours){const d=(a.rgba[i]-c[0])**2*.3+(a.rgba[i+1]-c[1])**2*.59+(a.rgba[i+2]-c[2])**2*.11;if(d<best){best=d;colour=c;}}memo.set(key,colour);}a.rgba.set([...colour,255],i);}return a;}
export function encode(a){const raw=Buffer.alloc((a.width*4+1)*a.height);for(let y=0;y<a.height;y++)raw.set(a.rgba.subarray(y*a.width*4,(y+1)*a.width*4),y*(a.width*4+1)+1);const chunk=(type,data)=>{const head=Buffer.alloc(8),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);head.write(type,4,'latin1');tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4),data]))>>>0);return Buffer.concat([head,data,tail]);};const header=Buffer.alloc(13);header.writeUInt32BE(a.width);header.writeUInt32BE(a.height,4);header.set([8,6,0,0,0],8);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('sRGB',Buffer.from([0])),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);}
export {quant,paste,bounds};
export function buildArt(){
const images={},lanes={},sources={};
function source(name){const bytes=readFileSync(resolve(here,'sources',name+'.png'));sources[name]={sha256:createHash('sha256').update(bytes).digest('hex')};return decodePng(bytes);}
function save(name,a){const bytes=encode(a);writeFileSync(resolve(out,name+'.png'),bytes);images[name]={path:name+'.png',size:[a.width,a.height],sha256:createHash('sha256').update(bytes).digest('hex')};return a;}
// Keep the approved ship palette while changing its camera and hull geometry.
save('ship',quant(nearest(source('ship'),480,320),48,JSON.parse(readFileSync(resolve(here,'ship-palette.json')))));
for(const name of ['coast','coast-night'])save(name,quant(nearest(source(name),600,400),64));
save('ripples',quant(nearest(source('ripples'),96,64),8));
for(const [name,w,h]of [['wake',128,36],['reply-shark',56,44],['sleep-window',14,16]]){const s=source(name);save(name,quant(nearest(crop(s,...bounds(s)),w,h),name==='wake'?8:12));}
const poses=['stand','front-a','front-pass','front-b','side-idle','side-a','side-pass','side-b','pull-a','pull-b','waiting','rest'];
for(const look of ['indigo','russet']){
  const s=source('crew-'+look),atlas=blank(384,36),lane={};
  for(let i=0;i<12;i++){
    const x0=Math.round(i%4*s.width/4),x1=Math.round((i%4+1)*s.width/4),y0=Math.round(Math.floor(i/4)*s.height/3),y1=Math.round((Math.floor(i/4)+1)*s.height/3);
    const cell=crop(s,x0,y0,x1-x0,y1-y0),figure=crop(cell,...bounds(cell));
    const height=i===11?24:i===8||i===9?30:32,scale=Math.min(height/figure.height,28/figure.width);
    const body=quant(nearest(figure,Math.max(1,Math.round(figure.width*scale)),Math.max(1,Math.round(figure.height*scale))),24);
    const left=Math.floor((32-body.width)/2),top=34-body.height;paste(atlas,body,i*32+left,top);
    lane[poses[i]]={rect:[i*32+left,top,body.width,body.height],feet:[16-left,body.height]};
  }
  save('crew-'+look,atlas);lanes[look]=lane;
}
// The optional picker thumbnail is the real renderer's reviewed daytime composition.
const preview=resolve(here,'review/day-canvas.png');
if(existsSync(preview))save('preview',nearest(decodePng(readFileSync(preview)),384,202));
writeFileSync(resolve(here,'registration.json'),JSON.stringify({sources,images,lanes},null,2)+'\n');
console.log(JSON.stringify({images:Object.keys(images),bytes:Object.values(images).reduce((n,a)=>n+readFileSync(resolve(out,a.path)).length,0)}));
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))buildArt();
