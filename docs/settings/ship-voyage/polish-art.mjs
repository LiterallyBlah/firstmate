/** Offline palette registration and animation of the three generated polish plates. */
import {resolve} from 'node:path';
import {blank,crop,nearest,quant} from '../japanese-ship/build-art.mjs';
export function polishAtmosphere({source,save,read,baseline,clone,pixel,put,blit,fit,tint}) {
 const sky=source('polish-sky'),water=source('polish-water'),kraken=source('polish-kraken');
 const phases=['dawn','morning','midday','afternoon','dusk','night'];
 const bayer=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
 const mix=(a,b,t)=>a.map((v,c)=>v+(b[c]-v)*Math.max(0,Math.min(1,t)));
 const dither=(rgb,x,y)=>rgb.map(v=>Math.max(0,Math.min(255,4*Math.floor(v/4+(bayer[y%4][x%4]+.5)/16))));
 // Register the generated gradient's row means, then quantize with fine ordered dithering.
 // This avoids median-cut's broad flat bins, especially when tall panes magnify sky pixels.
 const seaPalettes={dawn:[[99,166,179],[42,102,139],[28,68,106]],morning:[[55,191,201],[21,123,170],[16,87,141]],midday:[[35,195,211],[12,119,174],[13,88,144]],afternoon:[[66,182,189],[26,121,162],[21,82,130]],dusk:[[134,124,157],[57,76,115],[26,44,78]],night:[[29,56,91],[15,35,64],[9,21,43]]};
 for(const [i,phase]of phases.entries()) {
  const rows=[];
  for(let y=0;y<512;y++){const sum=[0,0,0];for(let x=16;x<496;x++){const p=pixel(sky,(i%3)*512+x,Math.floor(i/3)*512+y);for(let c=0;c<3;c++)sum[c]+=p[c];}rows.push(sum.map(v=>v/480));}
  const a=blank(512,2048),front=blank(512,2048),[far,near,deep]=seaPalettes[phase];
  for(let y=0;y<2048;y++)for(let x=0;x<512;x++){
   const skyY=Math.min(511,y/213*511),lo=Math.floor(skyY),skyRGB=mix(rows[lo],rows[Math.min(511,lo+1)],skyY-lo);
   const depthRGB=mix(near,deep,(y-512)/500);
   const rgb=y<213?skyRGB:mix(far,near,(y-213)/72);
   put(a,x,y,[...dither(rgb,x,y),255]);if(y>=512)put(front,x,y,[...dither(depthRGB,x,y),255]);
  }
  save('sky-'+phase,a);save('sea-depth-'+phase,front);
 }
 // An opaque, independently tiled floor remains beneath the phase-coloured backdrops.
 const fill=blank(256,128);for(let y=0;y<128;y++)for(let x=0;x<256;x++)put(fill,x,y,[13,88,144,255]);save('sea-fill',fill);
 const calm=quant(nearest(crop(water,0,0,768,512),256,128),24);
 const rough=[quant(nearest(crop(water,768,0,768,512),256,128),24),quant(nearest(crop(water,768,512,768,512),256,128),24)];
 for(let f=0;f<4;f++){
  const ripples=blank(256,128),storm=blank(256,128);
  for(let y=0;y<128;y++)for(let x=0;x<256;x++){
   const dx=Math.round(Math.sin(y/9+f*Math.PI/2)*2),p=pixel(calm,(x+dx+256)%256,y),l=(p[0]*.3+p[1]*.59+p[2]*.11);
   // Retain the generated whitecaps and dark troughs over each phase's own water colour.
   const colour=l>190?[220,249,246,165]:l>145?[112,219,226,60]:l<90?[3,37,77,80]:[0,0,0,0];
   put(ripples,x,y,colour);put(storm,x,y,pixel(rough[0],(x+dx+256)%256,y));
  }
  save('water-sea-frame-'+f,ripples);save('storm-sea-frame-'+f,storm);
  save('far-sea-'+f,nearest(ripples,128,32));save('far-storm-'+f,nearest(storm,128,32));
 }
 // Fallback shares the new transparent ripples, not the old opaque navy tile.
 const fallback=blank(256,128);for(let y=0;y<128;y++)for(let x=0;x<256;x++){const p=pixel(calm,x,y),l=p[0]*.3+p[1]*.59+p[2]*.11;put(fallback,x,y,l>190?[220,249,246,165]:l>145?[112,219,226,60]:l<90?[3,37,77,80]:[0,0,0,0]);}save('sea-water-tile',fallback);
 const clouds=quant(nearest(crop(water,0,512,768,512),512,213),32),overcast=blank(512,2048);blit(overcast,clouds,0,0);save('storm-sky-overcast',overcast);
 // Keep the old wake silhouettes and timing, lifting foam contrast so the stern trail reads.
 for(const kind of ['water','storm'])for(let f=0;f<3;f++)save(kind+'-wake-frame-'+f,tint(read(resolve(baseline,kind+'/wake/frame-'+f+'.png')),[1.15,1.13,1.09],[14,17,18]));
 for(let f=0;f<4;f++){
  const body=fit(crop(kraken,f*384,0,384,1024),90,80,24);save('kraken-polish-'+f,body);
  const spray=read(resolve(baseline,'storm/spray/frame-'+f+'.png'));save('storm-spray-frame-'+f,nearest(spray,96,48));
 }
}
