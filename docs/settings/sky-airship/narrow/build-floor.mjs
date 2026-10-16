/** Register the generated continuation in the approved bank's palette; no stretched source rows. */
import assert from 'node:assert/strict';
import {blank,crop,nearest,quant} from '../../japanese-ship/build-art.mjs';
const pixel=(a,x,y)=>a.rgba.subarray((y*a.width+x)*4,(y*a.width+x)*4+4);
const put=(a,x,y,c)=>a.rgba.set(c,(y*a.width+x)*4);
const mix=(a,b,t)=>[0,1,2].map(c=>Math.round(a[c]*(1-t)+b[c]*t)).concat(255);
export function cloudFloor(day,storm,source){
  const palette=[...new Map(Array.from({length:day.width*day.height},(_,i)=>[...day.rgba.subarray(i*4,i*4+4)]).filter(c=>c[3]).map(c=>[c.slice(0,3).join(','),c.slice(0,3)])).values()];
  // Native 704px period divides the existing 1408px bank: both stay registered while scrolling.
  const width=704,height=192,overlap=32;
  const sourceHeight=Math.round(source.width*(height+overlap)/(width+overlap));
  const raw=nearest(crop(source,0,Math.floor((source.height-sourceHeight)/2),source.width,sourceHeight),width+overlap,height+overlap);
  const horizontal=blank(width,raw.height),tile=blank(width,height);
  for(let y=0;y<raw.height;y++)for(let x=0;x<width;x++)put(horizontal,x,y,x<overlap?mix(pixel(raw,x+width,y),pixel(raw,x,y),x/(overlap-1)):pixel(raw,x,y));
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)put(tile,x,y,y<overlap?mix(pixel(horizontal,x,y+height),pixel(horizontal,x,y),y/(overlap-1)):pixel(horizontal,x,y));
  quant(tile,20,palette);
  // Storm inherits the original registered palette relationship, including all shadow tones.
  const votes=new Map();
  for(let i=0;i<day.rgba.length;i+=4)if(day.rgba[i+3]){const key=[...day.rgba.subarray(i,i+3)].join(','),target=[...storm.rgba.subarray(i,i+3)].join(',');const counts=votes.get(key)??new Map();counts.set(target,(counts.get(target)??0)+1);votes.set(key,counts);}
  const dark=new Map([...votes].map(([key,counts])=>[key,[...counts].sort((a,b)=>b[1]-a[1])[0][0].split(',').map(Number)]));
  const stormTile=blank(width,height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const c=pixel(tile,x,y);put(stormTile,x,y,[...dark.get([...c.subarray(0,3)].join(',')),255]);}
  // The top 112 bank rows are untouched. Its fully opaque foot merges over 48 rows,
  // ending on tile row 47; the tile below continues at row 48 (world row 446).
  for(const [bank,field]of [[day,tile],[storm,stormTile]]){
    const bankPalette=[...new Map(Array.from({length:bank.width*bank.height},(_,i)=>[...bank.rgba.subarray(i*4,i*4+4)]).filter(c=>c[3]).map(c=>[c.slice(0,3).join(','),c.slice(0,3)])).values()];
    const foot=blank(bank.width,48);
    for(let y=0;y<48;y++)for(let x=0;x<bank.width;x++){
      assert.equal(pixel(bank,x,y+112)[3],255,'transition starts inside the opaque bank');
      put(foot,x,y,mix(pixel(bank,x,y+112),pixel(field,x%width,y),y/47));
    }
    quant(foot,20,bankPalette);
    // Exact tile pixels on the final row avoid palette rounding at the boundary.
    for(let x=0;x<bank.width;x++)put(foot,x,47,pixel(field,x%width,47));
    for(let y=0;y<48;y++)for(let x=0;x<bank.width;x++)put(bank,x,y+112,pixel(foot,x,y));
  }
  return {day,storm,tile,stormTile};
}
