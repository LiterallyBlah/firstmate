import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {decodePng} from '../../../../test/png.ts';
import {nearest,crop} from '../build-art.mjs';
const here=dirname(fileURLToPath(import.meta.url)),out=resolve(here,'evidence'),hash=b=>createHash('sha256').update(b).digest('hex');
const {GIFEncoder,quantize,applyPalette}=createRequire(resolve(here,'../../../../.generated/motion-tools/package.json'))('gifenc');
export async function review(chromium,origin){
 mkdirSync(out,{recursive:true});
 const preview=process.env.COAST_PREVIEW==='60',errors=[],results=[],p=(await(await fetch(origin+'/rpc/branch/firstmate.deck.setting',{method:'POST',body:JSON.stringify({id:'japanese-ship'})})).json()).manifest;
 assert.equal(p.ambience.find(e=>e.id==='voyage-coast').behaviour.drift.pxPerSecond,preview?144:2.4,'served fixture speed');
 const spirit=decodePng(readFileSync(resolve(here,'../../../../art/settings/japanese-ship/voyage-umibozu.png'))),inks=new Set();
 for(let i=0;i<spirit.rgba.length;i+=4)if(spirit.rgba[i+3]===255&&spirit.rgba[i+1]<45)inks.add([...spirit.rgba.subarray(i,i+3)].join(','));
 for(const mode of preview?['full']:['full','lite']){
 const browser=await chromium.launch({channel:'msedge',headless:true,...(mode==='lite'?{args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}:{})});
 try{for(const [name,width,height]of preview?[['wide',1440,900]]:[['wide',1440,900],['tall',650,1900],['square',1000,1000]]){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce',timezoneId:'UTC'}),view=await context.newPage();view.on('pageerror',e=>errors.push(e.message));
  const time=Date.parse('2026-10-16T12:00:00Z');await view.clock.install({time});await view.goto(origin+'/?tree=branch&theme=dark&working=3&setting=japanese-ship');
  await view.getByRole('button',{name:'Open Deck',exact:true}).waitFor();await view.clock.pauseAt(time+20000);await view.getByRole('button',{name:'Open Deck',exact:true}).click();
  const canvas=view.locator('canvas[data-firstmate-deck]');for(let i=0;i<100&&!(await canvas.count());i++){await view.clock.runFor(100);await view.waitForTimeout(50);}assert.equal(await canvas.count(),1);await view.clock.runFor(500);await view.waitForTimeout(300);await view.mouse.move(0,0);
  const fit=await view.evaluate(m=>{const r=window.drawOverlay(m);document.querySelector('[data-firstmate-deck-overlay]').remove();return r.fit;},p),box=await canvas.boundingBox();
  const shot=async phase=>{await canvas.screenshot({path:resolve(out,name+'-'+mode+'-'+phase+'.png')});results.push({name,phase,mode:await canvas.getAttribute('data-firstmate-deck-motion'),fit,canvas:box,visibleBottom:(box.height-fit.y)/fit.scale,weather:await canvas.getAttribute('data-firstmate-deck-weather')});};
  const clip=async(file,count,delay)=>{const gif=GIFEncoder(),hashes=[];for(let i=0;i<count;i++){await view.clock.runFor(delay);const bytes=await canvas.screenshot(),a=decodePng(bytes),s=nearest(a,900,Math.round(a.height*900/a.width)),palette=quantize(s.rgba,256);hashes.push(hash(bytes));gif.writeFrame(applyPalette(s.rgba,palette),s.width,s.height,{palette,delay,repeat:0});if(preview&&i%8===0)writeFileSync(resolve(out,file+'-sample-'+String(i).padStart(2,'0')+'.png'),bytes);}gif.finish();writeFileSync(resolve(out,file+'.gif'),gif.bytes());assert.ok(new Set(hashes).size>1);writeFileSync(resolve(out,file+'.json'),JSON.stringify({frames:count,frameMs:delay,voyageRate:preview?'60x review fixture; pose/water clocks at 1x':'1x shipped rate, 2.4 world px/s',hashes},null,2)+'\n');};
  if(preview){await view.emulateMedia({reducedMotion:'no-preference'});await clip('coast-full-lap-60x',50,400);await view.clock.setSystemTime(new Date('2026-10-16T23:00:00Z'));await view.clock.fastForward(61000);await clip('night-lights-full-lap-60x',50,400);
   await view.evaluate(()=>window.changeFleet(f=>{const source=f.cards.find(c=>c.agent&&c.agent.status!=='closed');f.cards=Array.from({length:12},(_,i)=>({...structuredClone(source),key:'Storm '+i,taskId:'Storm '+i,column:'working',agent:{...structuredClone(source.agent),id:'Storm '+i,status:'running',pendingPermissions:0}}));}));await view.getByRole('button',{name:'Refresh',exact:true}).click();await view.clock.setSystemTime(new Date('2026-10-17T12:00:00Z'));await view.clock.fastForward(61000);await view.clock.runFor(18000);assert.ok(Number(await canvas.getAttribute('data-firstmate-deck-weather'))>.95);await clip('storm-spirit-full-lap-60x',50,400);await context.close();continue;}
  await shot('day');const still=hash(await canvas.screenshot());await view.clock.runFor(2000);assert.equal(hash(await canvas.screenshot()),still,'still stable');
  if(name==='wide'&&mode==='full'){await view.evaluate(m=>window.drawOverlay(m),p);await shot('overlay');await view.evaluate(()=>document.querySelector('[data-firstmate-deck-overlay]').remove());}
  for(const [phase,hour]of [['dusk','18:30'],['night','23:00']]){await view.clock.setSystemTime(new Date('2026-10-16T'+hour+':00Z'));await view.clock.fastForward(61000);await shot(phase);}
  await view.clock.setSystemTime(new Date('2026-10-17T12:00:00Z'));await view.clock.fastForward(61000);
  if(name==='wide'&&mode==='full'){await view.emulateMedia({reducedMotion:'no-preference'});await clip('coast-native-motion',40,250);await view.emulateMedia({reducedMotion:'reduce'});}
  await view.evaluate(()=>window.changeFleet(f=>{const source=f.cards.find(c=>c.agent&&c.agent.status!=='closed');f.cards=Array.from({length:12},(_,i)=>({...structuredClone(source),key:'Storm '+i,taskId:'Storm '+i,column:'working',agent:{...structuredClone(source.agent),id:'Storm '+i,status:'running',pendingPermissions:0}}));}));
  await view.getByRole('button',{name:'Refresh',exact:true}).click();await view.clock.runFor(1000);await view.emulateMedia({reducedMotion:'no-preference'});await view.clock.runFor(18000);assert.equal(await canvas.getAttribute('data-firstmate-deck-motion'),mode);assert.ok(Number(await canvas.getAttribute('data-firstmate-deck-weather'))>.95);
  let peak,high=-1;const samples=[];
  for(let i=0;i<(mode==='full'?30:1);i++){await view.clock.runFor(250);const bytes=await canvas.screenshot(),a=decodePng(bytes),region=crop(a,Math.max(0,Math.round(fit.x+340*fit.scale)),Math.round(fit.y+100*fit.scale),Math.min(Math.round(160*fit.scale),a.width-Math.max(0,Math.round(fit.x+340*fit.scale))),Math.round(78*fit.scale));let n=0;for(let j=0;j<region.rgba.length;j+=4)if(inks.has([...region.rgba.subarray(j,j+3)].join(',')))n++;samples.push(n);if(n>high){high=n;peak=bytes;}}
  if(mode==='full'){assert.ok(high>30,'opaque spirit visible in open sea');assert.equal(Math.min(...samples),0,'spirit fully submerges');}else assert.equal(high,0,'spirit hidden in lite');writeFileSync(resolve(out,name+'-'+mode+'-storm.png'),peak);results.push({name,phase:'storm',mode,fit,samples,peakOpaqueBodyPixels:high,weather:await canvas.getAttribute('data-firstmate-deck-weather')});
  await view.emulateMedia({reducedMotion:'reduce'});await view.clock.runFor(500);await shot('reduced-storm');await context.close();
 }}finally{await browser.close();}}
 assert.deepEqual(errors,[]);writeFileSync(resolve(out,preview?'preview-results.json':'results.json'),JSON.stringify({results,errors},null,2)+'\n');console.log(JSON.stringify({preview,captures:results.length,errors}));
}




