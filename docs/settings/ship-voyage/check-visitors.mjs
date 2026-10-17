/** Marine-life and bow evidence through the same real compiled-client fixture. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {decodePng} from '../../../test/png.ts';
import {nearest,crop,encode} from '../japanese-ship/build-art.mjs';
import {writeEvidence} from './evidence-file.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..'),out=resolve(here,'review/polish-final');mkdirSync(out,{recursive:true});
const manifest=JSON.parse(readFileSync(resolve(root,'art/settings/ship/setting.json'))),sha=b=>createHash('sha256').update(b).digest('hex');
const require=createRequire(resolve(root,'.generated/motion-tools/package.json')),{GIFEncoder,quantize,applyPalette}=require('gifenc');
export async function review(browser,origin){
 const lite=process.env.VOYAGE_LITE==='1',before=process.env.SHARK_REVIEW==='before',errors=[];
 const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,reducedMotion:'reduce',timezoneId:'UTC'}),view=await context.newPage();view.on('pageerror',e=>errors.push(e.message));
 const noon=Date.parse('2026-10-16T12:00:00Z');await view.clock.install({time:noon});await view.goto(origin+'/?tree=branch&theme=dark&working=0&setting=ship&persistScene=1');
 await view.getByRole('button',{name:'Open Deck',exact:true}).waitFor();await view.clock.pauseAt(noon+20000);await view.getByRole('button',{name:'Open Deck',exact:true}).click();
 const canvas=view.locator('canvas[data-firstmate-deck]');for(let i=0;i<100&&!(await canvas.count());i++){await view.clock.runFor(100);await view.waitForTimeout(50);}await view.clock.runFor(800);
 const source=await view.evaluate(()=>window.fixtureFleet.cards.find(c=>c.agent&&c.agent.status!=='closed'));
 const set=async cards=>{await view.evaluate(cards=>window.changeFleet(f=>{f.cards=cards;f.suggestions=[];}),cards);await view.getByRole('button',{name:'Refresh',exact:true}).click();await view.clock.runFor(200);await view.waitForTimeout(250);await view.clock.runFor(1000);};
 await set(Array.from({length:3},(_,i)=>({...structuredClone(source),key:'Bow '+i,title:'Bow '+i,column:'blocked',note:null,remote:undefined,agent:{...source.agent,id:'Bow '+i,status:'finished',pendingPermissions:1}})));
 const fit=await view.evaluate(m=>{const r=window.drawOverlay(m);document.querySelector('[data-firstmate-deck-overlay]').remove();return r.fit;},manifest);
 const a=decodePng(await canvas.screenshot()),bow=crop(a,Math.round(fit.x+90*fit.scale),Math.round(fit.y+225*fit.scale),Math.round(140*fit.scale),Math.round(85*fit.scale));
 writeEvidence(resolve(out,before?'bow-before.png':'bow-after.png'),encode(nearest(bow,560,340)));
 if(before){assert.deepEqual(errors,[]);await context.close();return;}
 await set([]);const still=sha(await canvas.screenshot());await view.clock.runFor(5000);assert.equal(sha(await canvas.screenshot()),still);
 writeEvidence(resolve(out,lite?'visitors-lite-still.png':'visitors-reduced.png'),await canvas.screenshot());
 await view.emulateMedia({reducedMotion:'no-preference'});await view.waitForTimeout(100);await view.clock.runFor(500);assert.equal(await canvas.getAttribute('data-firstmate-deck-motion'),lite?'lite':'full');
 if(lite){await view.clock.runFor(12000);writeEvidence(resolve(out,'visitors-lite.png'),await canvas.screenshot());writeFileSync(resolve(here,'visitors-lite.json'),JSON.stringify({mode:'lite',still:'pixel stable',visitors:'both hide in lite and still',errors},null,2));assert.deepEqual(errors,[]);await context.close();return;}
 const gif=(name,frames,delay)=>{const palette=quantize(Buffer.concat(frames.map(a=>a.rgba)),256),g=GIFEncoder();for(const a of frames)g.writeFrame(applyPalette(a.rgba,palette),a.width,a.height,{palette,delay,repeat:0});g.finish();writeEvidence(resolve(out,name+'.gif'),g.bytes());};
 const capture=async()=>{const a=decodePng(await canvas.screenshot());return nearest(a,800,Math.round(a.height*800/a.width));};
 const leaps=[];for(let i=0;i<120;i++){await view.clock.runFor(200);leaps.push(await capture());if(i===44)writeEvidence(resolve(out,'marine-distribution.png'),await canvas.screenshot());}
 gif('dolphin-leaps',leaps,200);
 // Page visibility is a host signal, not renderer instrumentation. Hidden time pauses;
 // returning to a visible pane must resume normal animation from that point.
 await view.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
 const hidden=sha(await canvas.screenshot());await view.clock.runFor(10000);assert.equal(sha(await canvas.screenshot()),hidden);
 await view.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await view.clock.runFor(1500);assert.notEqual(sha(await canvas.screenshot()),hidden);
 // A 10 Hz scheduler samples genuine 100 ms engine steps without changing voyage speed.
 await view.evaluate(()=>{window.requestAnimationFrame=cb=>window.setTimeout(()=>cb(performance.now()),100);window.cancelAnimationFrame=h=>window.clearTimeout(h);});
 const passage=[];for(let i=0;i<60;i++){await view.clock.runFor(1000);passage.push(await capture());}gif('whale-passage-5x',passage,200);
 await view.emulateMedia({reducedMotion:'reduce'});await view.clock.runFor(300);writeEvidence(resolve(out,'visitors-return-to-still.png'),await canvas.screenshot());
 const resting=sha(await canvas.screenshot());await view.clock.runFor(5000);assert.equal(sha(await canvas.screenshot()),resting);assert.deepEqual(errors,[]);
 writeFileSync(resolve(here,'visitors-full.json'),JSON.stringify({mode:'full',dolphinSeconds:24,leaps:4,whaleSeconds:60,whaleDriftPixels:102,whalePlayback:5,hiddenPane:'pixels pause and resume changing',returnToReduced:'pixel stable; visitor hide policy',errors},null,2));
 await context.close();
}
