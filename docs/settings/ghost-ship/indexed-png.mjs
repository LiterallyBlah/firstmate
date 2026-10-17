/** Lossless palette encoding for small registered art. Transparent RGB is canonical zero. */
import {crc32,deflateSync} from 'node:zlib';
import {encode} from '../japanese-ship/build-art.mjs';

export function indexed(image){
 const colours=[],indices=new Map(),raw=Buffer.alloc((image.width+1)*image.height);
 for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
  const pixel=[...image.rgba.subarray((y*image.width+x)*4,(y*image.width+x+1)*4)];
  const key=pixel[3]?pixel.join(','):'0,0,0,0';
  let index=indices.get(key);
  if(index===undefined){index=colours.length;indices.set(key,index);colours.push(key.split(',').map(Number));}
  if(index>255)return encode(image);
  raw[y*(image.width+1)+1+x]=index;
 }
 const chunk=(name,data)=>{
  const header=Buffer.alloc(8),tail=Buffer.alloc(4);header.writeUInt32BE(data.length);header.write(name,4);
  tail.writeUInt32BE(crc32(Buffer.concat([header.subarray(4),data]))>>>0);
  return Buffer.concat([header,data,tail]);
 };
 const header=Buffer.alloc(13);header.writeUInt32BE(image.width);header.writeUInt32BE(image.height,4);header.set([8,3,0,0,0],8);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),
  chunk('PLTE',Buffer.from(colours.flatMap(c=>c.slice(0,3)))),chunk('tRNS',Buffer.from(colours.map(c=>c[3]))),
  chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
