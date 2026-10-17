import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {decodePng} from '../../../../test/png.ts';
import {nearest,crop} from '../build-art.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function review(browser, origin) {
  const version = process.env.ASPECT_REVIEW ?? 'after', out = resolve(here, version);
  mkdirSync(out, {recursive:true});
  const results = [], errors = [];
  const manifest = (await (await fetch(origin+'/rpc/branch/firstmate.deck.setting', {method:'POST', body:JSON.stringify({id:'japanese-ship'})})).json()).manifest;
  for (const [aspect, width, height] of [['wide',1440,900], ['tall',650,1900], ['ultrawide',2400,800]]) {
    const context = await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce',timezoneId:'UTC'});
    const view = await context.newPage();
    view.on('pageerror', e => errors.push(e.message));
    const noon = Date.parse('2026-10-16T12:00:00Z');
    await view.clock.install({time:noon});
    await view.goto(origin+'/?tree=branch&theme=dark&working=3&setting=japanese-ship');
    await view.getByRole('button',{name:'Open Deck',exact:true}).waitFor();
    await view.clock.pauseAt(noon+20000);
    await view.getByRole('button',{name:'Open Deck',exact:true}).click();
    const canvas = view.locator('canvas[data-firstmate-deck]');
    for(let i=0;i<100 && !(await canvas.count());i++){await view.clock.runFor(100);await view.waitForTimeout(50);}
    assert.equal(await canvas.count(),1);
    await view.clock.runFor(500); await view.waitForTimeout(300);
    assert.equal(await canvas.getAttribute('data-firstmate-deck-setting'),'japanese-ship');
    const fit = await view.evaluate(m => {const r=window.drawOverlay(m);document.querySelector('[data-firstmate-deck-overlay]').remove();return r.fit;}, manifest);
    const box = await canvas.boundingBox();
    const shot = async phase => {
      await view.mouse.move(0,0);
      await canvas.screenshot({path:resolve(out,aspect+'-'+phase+'.png')});
      results.push({aspect,phase,viewport:{width,height},canvas:box,fit,visibleBottom:(box.height-fit.y)/fit.scale,mode:await canvas.getAttribute('data-firstmate-deck-motion'),weather:await canvas.getAttribute('data-firstmate-deck-weather')});
    };
    await shot('day');
    if(version==='after'&&aspect==='wide'){
      await view.evaluate(m=>window.drawOverlay(m),manifest);await shot('overlay');
      await view.evaluate(()=>document.querySelector('[data-firstmate-deck-overlay]').remove());
      const still=hash(await canvas.screenshot());await view.clock.runFor(3000);assert.equal(hash(await canvas.screenshot()),still,'still holds pixels');
      await view.emulateMedia({reducedMotion:'no-preference'});await view.clock.runFor(4000);
      const {GIFEncoder,quantize,applyPalette}=createRequire(resolve(here,'../../../../.generated/motion-tools/package.json'))('gifenc');
      const gif=GIFEncoder(),hashes=[],seaHashes=[];
      for(let i=0;i<32;i++){
        await view.clock.runFor(200);const bytes=await canvas.screenshot();hashes.push(hash(bytes));const a=decodePng(bytes),s=nearest(a,1000,Math.round(a.height*1000/a.width)),palette=quantize(s.rgba,256);
        seaHashes.push(hash(crop(a,0,a.height-50,Math.min(180,a.width),50).rgba));
        gif.writeFrame(applyPalette(s.rgba,palette),s.width,s.height,{palette,delay:200,repeat:0});
      }
      gif.finish();writeFileSync(resolve(out,'water-motion.gif'),gif.bytes());assert.ok(new Set(hashes).size>1);assert.ok(new Set(seaHashes).size>1,'isolated water pixels move');
      writeFileSync(resolve(out,'motion.json'),JSON.stringify({mode:await canvas.getAttribute('data-firstmate-deck-motion'),frameMs:200,hashes,seaHashes},null,2)+'\n');
      await view.emulateMedia({reducedMotion:'reduce'});
    }
    for(const [name,time]of [['dawn','05:30'],['dusk','18:30']]){
      await view.clock.setSystemTime(new Date('2026-10-16T'+time+':00Z'));await view.clock.fastForward(61000);await shot(name);
    }
    await view.clock.setSystemTime(new Date('2026-10-16T23:00:00Z')); await view.clock.fastForward(61000);
    assert.equal(await canvas.getAttribute('data-firstmate-deck-sky'),'night'); await shot('night');
    await view.clock.setSystemTime(new Date('2026-10-17T12:00:00Z')); await view.clock.fastForward(61000);
    await view.evaluate(() => window.changeFleet(f => {const source=f.cards.find(c=>c.agent&&c.agent.status!=='closed');f.cards=Array.from({length:12},(_,i)=>({...structuredClone(source),key:'Storm '+i,taskId:'Storm '+i,column:'working',agent:{...structuredClone(source.agent),id:'Storm '+i,status:'running',pendingPermissions:0}}));}));
    await view.getByRole('button',{name:'Refresh',exact:true}).click(); await view.clock.runFor(1000); await view.waitForTimeout(100);
    await view.emulateMedia({reducedMotion:'no-preference'}); await view.clock.runFor(18000);
    assert.ok(Number(await canvas.getAttribute('data-firstmate-deck-weather'))>.95);
    await shot('storm');
    if(version==='after'&&aspect!=='ultrawide'){
      const {GIFEncoder,quantize,applyPalette}=createRequire(resolve(here,'../../../../.generated/motion-tools/package.json'))('gifenc');
      const gif=GIFEncoder(),samples=[];let best=-1,peak;
      const spirit=decodePng(readFileSync(resolve(here,'../../../../art/settings/japanese-ship/umibozu.png')));
      const inks=new Set();for(let i=0;i<spirit.rgba.length;i+=4)if(spirit.rgba[i+3]===255&&spirit.rgba[i+1]<65)inks.add([...spirit.rgba.subarray(i,i+3)].join(','));
      for(let i=0;i<30;i++){
        await view.clock.runFor(250);const bytes=await canvas.screenshot(),a=decodePng(bytes);
        const b=manifest.ambience.find(e=>e.id==='umibozu').behaviour;
        const region=crop(a,Math.round(fit.x+(b.at[0]-b.anchor[0])*fit.scale),Math.round(fit.y+(b.at[1]-b.anchor[1])*fit.scale),Math.round(72*fit.scale),Math.round(80*fit.scale));
        let solid=0;for(let p=0;p<region.rgba.length;p+=4)if(inks.has([...region.rgba.subarray(p,p+3)].join(',')))solid++;
        samples.push({ms:i*250,opaqueBodyPixels:solid});if(solid>best){best=solid;peak=bytes;}
        const s=nearest(region,288,320),palette=quantize(s.rgba,128);gif.writeFrame(applyPalette(s.rgba,palette),s.width,s.height,{palette,delay:250,repeat:0});
      }
      assert.ok(best>50,'opaque spirit colours survive front rain');assert.ok(Math.max(...samples.map(s=>s.opaqueBodyPixels))-Math.min(...samples.map(s=>s.opaqueBodyPixels))>50,'spirit rises and submerges');
      gif.finish();writeFileSync(resolve(out,aspect+'-spirit.gif'),gif.bytes());writeFileSync(resolve(out,aspect+'-storm-peak.png'),peak);
      writeFileSync(resolve(out,aspect+'-spirit.json'),JSON.stringify({samples,peakOpaqueBodyPixels:best,observer:'real canvas PNGs; exact opaque sprite colours'},null,2)+'\n');
    }
    await context.close();
  }
  assert.deepEqual(errors,[]);
  writeFileSync(resolve(out,'results.json'),JSON.stringify({results,errors},null,2)+'\n');
  console.log(JSON.stringify({version,captures:results.length,errors}));
}
