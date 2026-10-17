import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {decodePng} from '../../../../../test/png.ts';
import {crop,nearest} from '../../build-art.mjs';
const here=dirname(fileURLToPath(import.meta.url));
export async function review(chromium,origin){
 const p=(await(await fetch(origin+'/rpc/branch/firstmate.deck.setting',{method:'POST',body:JSON.stringify({id:'japanese-ship'})})).json()).manifest;
 const b=p.ambience.find(e=>e.id==='umibozu').behaviour,[x,y]=b.at,[ax,ay]=b.anchor;
 const spirit=decodePng(readFileSync(resolve(here,'../../../../../art/settings/japanese-ship/umibozu.png'))),inks=new Set();
 for(let i=0;i<spirit.rgba.length;i+=4)if(spirit.rgba[i+3]===255&&spirit.rgba[i+1]<65)inks.add([...spirit.rgba.subarray(i,i+3)].join(','));
 const errors=[],results=[];
 for(const mode of ['full','lite']){
 const browser=await chromium.launch({channel:'msedge',headless:true,...(mode==='lite'?{args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}:{})});
 try{for(const [name,width,height]of [['wide',1440,900],['square',1000,1000],['tall',650,1900]]){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce',timezoneId:'UTC'}),view=await context.newPage();view.on('pageerror',e=>errors.push(e.message));
  const time=Date.parse('2026-10-16T12:00:00Z');await view.clock.install({time});await view.goto(origin+'/?tree=branch&theme=dark&working=12&setting=japanese-ship');
  await view.getByRole('button',{name:'Open Deck',exact:true}).waitFor();await view.clock.pauseAt(time+20000);await view.getByRole('button',{name:'Open Deck',exact:true}).click();
  const canvas=view.locator('canvas[data-firstmate-deck]');for(let i=0;i<100&&!(await canvas.count());i++){await view.clock.runFor(100);await view.waitForTimeout(50);}await view.clock.runFor(500);await view.waitForTimeout(300);
  const fit=await view.evaluate(m=>{const r=window.drawOverlay(m);document.querySelector('[data-firstmate-deck-overlay]').remove();return r.fit;},p);
  const region=a=>crop(a,Math.round(fit.x+(x-ax)*fit.scale),Math.round(fit.y+(y-ay)*fit.scale),Math.round(72*fit.scale),Math.round(80*fit.scale));
  const solid=a=>{let n=0;for(let i=0;i<a.rgba.length;i+=4)if(inks.has([...a.rgba.subarray(i,i+3)].join(',')))n++;return n;};
  assert.equal(solid(region(decodePng(await canvas.screenshot()))),0,'hidden in still');
  await view.emulateMedia({reducedMotion:'no-preference'});await view.clock.runFor(18000);assert.equal(await canvas.getAttribute('data-firstmate-deck-motion'),mode);
  await view.mouse.move(0,0);let peak,high=-1,low=Infinity;const samples=[];
  const {GIFEncoder,quantize,applyPalette}=createRequire(resolve(here,'../../../../../.generated/motion-tools/package.json'))('gifenc'),gif=GIFEncoder();
  for(let i=0;i<(mode==='full'?30:3);i++){
   await view.clock.runFor(250);const bytes=await canvas.screenshot(),a=region(decodePng(bytes)),n=solid(a);samples.push(n);low=Math.min(low,n);if(n>high){high=n;peak=bytes;}
   if(mode==='full'){const s=nearest(a,288,320),palette=quantize(s.rgba,128);gif.writeFrame(applyPalette(s.rgba,palette),288,320,{palette,delay:250,repeat:0});}
  }
  if(mode==='full'){assert.ok(high>50,'solid body visible');assert.equal(low,0,'fully submerges');gif.finish();writeFileSync(resolve(here,name+'-cycle.gif'),gif.bytes());}
  else assert.equal(high,0,'hidden in lite');
  writeFileSync(resolve(here,'after-'+name+'-'+mode+'.png'),peak);
  await view.emulateMedia({reducedMotion:'reduce'});await view.clock.runFor(500);assert.equal(solid(region(decodePng(await canvas.screenshot()))),0,'switching to reduced motion hides spirit');
  results.push({name,mode,fit,worldWaterline:b.at,samples,high,low,hiddenInReducedMotion:true});await context.close();
 }}finally{await browser.close();}}
 assert.deepEqual(errors,[]);writeFileSync(resolve(here,'results.json'),JSON.stringify({results,errors},null,2)+'\n');console.log(JSON.stringify({captures:results.length,errors}));
}
