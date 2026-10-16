import assert from 'node:assert/strict';import {mkdirSync,writeFileSync} from 'node:fs';import {resolve,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';
import {decodePng} from '../../../../test/png.ts';import {nearest,crop,encode} from '../../japanese-ship/build-art.mjs';
const here=dirname(fileURLToPath(import.meta.url)),req=createRequire(resolve(here,'../../../../.generated/motion-tools/package.json'));const {GIFEncoder,quantize,applyPalette}=req('gifenc');
async function gif(path,images,delay){const palette=quantize(Buffer.concat(images.map(a=>a.rgba)),256),g=GIFEncoder();for(const a of images)g.writeFrame(applyPalette(a.rgba,palette),a.width,a.height,{palette,delay,repeat:0});g.finish();writeFileSync(path,g.bytes());}
export async function review(browser,origin){const out=resolve(here,'serpent');mkdirSync(out,{recursive:true});const errors=[],results=[];const manifest=(await(await fetch(origin+'/rpc/branch/firstmate.deck.setting',{method:'POST',body:JSON.stringify({id:'sky-airship'})})).json()).manifest;
for(const [aspect,width,height]of [['wide',1440,900],['tall',900,1400]]){const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce',timezoneId:'UTC'}),view=await context.newPage();view.on('pageerror',e=>errors.push(e.message));const noon=Date.parse('2026-10-16T12:00:00Z');await view.clock.install({time:noon});await view.goto(origin+'/?tree=branch&theme=dark&working=3&setting=sky-airship');await view.getByRole('button',{name:'Open Deck',exact:true}).waitFor();await view.clock.pauseAt(noon+20000);await view.getByRole('button',{name:'Open Deck',exact:true}).click();const canvas=view.locator('canvas[data-firstmate-deck]');for(let i=0;i<100&&!(await canvas.count());i++){await view.clock.runFor(100);await view.waitForTimeout(50)}assert.equal(await canvas.count(),1);await view.clock.runFor(500);await view.waitForTimeout(300);
const fit=await view.evaluate(m=>{const r=window.drawOverlay(m);document.querySelector('[data-firstmate-deck-overlay]').remove();return r.fit},manifest);
const worldCrop=(a,[x,y,w,h])=>crop(a,Math.round(fit.x+x*fit.scale),Math.round(fit.y+y*fit.scale),Math.round(w*fit.scale),Math.round(h*fit.scale));

await view.emulateMedia({reducedMotion:'no-preference'});
const source=await view.evaluate(()=>window.fixtureFleet.cards.find(c=>c.agent&&c.agent.status!=='closed'));
await view.evaluate(source=>window.changeFleet(f=>{f.cards=Array.from({length:6},(_,i)=>({...structuredClone(source),key:'Storm '+i,taskId:'Storm '+i,title:'Storm '+i,column:'working',agent:{...structuredClone(source.agent),id:'Storm '+i,status:'running',pendingPermissions:0}}));f.suggestions=[]}),source);
await view.getByRole('button',{name:'Refresh',exact:true}).click();await view.clock.runFor(22000);
assert.ok(Number(await canvas.getAttribute('data-firstmate-deck-weather'))>.99);
// Begin during the off-screen interval so the clip contains an entire entry-to-exit pass.
await view.clock.runFor(18000);
const frames=[];
for(let i=0;i<240;i++){
 await view.clock.runFor(160);const a=decodePng(await canvas.screenshot());
 // Include the entire sky route and the balloon's top for a visible depth reference.
 const band=crop(a,0,Math.max(0,Math.round(fit.y-12*fit.scale)),a.width,Math.round(85*fit.scale));
 frames.push(nearest(band,960,Math.round(band.height*960/band.width)));
 if(i%60===0)writeFileSync(resolve(out,aspect+'-storm-'+i+'.png'),encode(nearest(a,960,Math.round(a.height*960/a.width))));
}
await gif(resolve(out,aspect+'-crossing.gif'),frames,160);
await view.emulateMedia({reducedMotion:'reduce'});await view.clock.runFor(1000);writeFileSync(resolve(out,aspect+'-reduced.png'),await canvas.screenshot());
results.push({aspect,intensity:1,frames:240,frameMs:160,seconds:38.4});console.log('serpent',aspect,'crossing captured');await context.close();
}
assert.deepEqual(errors,[]);writeFileSync(resolve(out,'results.json'),JSON.stringify({results,errors},null,2));}
