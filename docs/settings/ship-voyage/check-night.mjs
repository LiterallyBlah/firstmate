/** Acceptance evidence from the unmodified compiled client, real RPC loader and real WebGL renderer. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {decodePng} from '../../../test/png.ts';
import {nearest,crop,encode,blank,paste} from '../japanese-ship/build-art.mjs';
import {diagnose} from '../sky-airship/diagnose-crowd.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..'),out=resolve(here,'review');mkdirSync(out,{recursive:true});
const manifest=JSON.parse(readFileSync(resolve(root,'art/settings/ship/setting.json')));
const require=createRequire(resolve(root,'.generated/motion-tools/package.json'));
const {GIFEncoder,quantize,applyPalette}=require('gifenc');
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function review(browser,origin){
 const lite=process.env.VOYAGE_LITE==='1',errors=[],checks=[],samples=[];
 const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,reducedMotion:'reduce',timezoneId:'UTC'});
 const view=await context.newPage();view.on('pageerror',e=>errors.push(e.message));
 const noon=Date.parse('2026-10-16T12:00:00Z');await view.clock.install({time:noon});
 await view.goto(origin+'/?tree=branch&theme=dark&working=3&setting=ship&persistScene=1');
 await view.getByRole('button',{name:'Open Deck',exact:true}).waitFor();await view.clock.pauseAt(noon+20000);
 await view.getByRole('button',{name:'Open Deck',exact:true}).click();
 const canvas=view.locator('canvas[data-firstmate-deck]');
 for(let i=0;i<100&&!(await canvas.count());i++){await view.clock.runFor(100);await view.waitForTimeout(50);}
 assert.equal(await canvas.count(),1,JSON.stringify({errors,body:(await view.locator('body').innerText()).slice(-1500)}));
 await view.clock.runFor(500);await view.waitForTimeout(300);
 assert.equal(await canvas.getAttribute('data-firstmate-deck-setting'),'ship');
 const source=await view.evaluate(()=>window.fixtureFleet.cards.find(c=>c.agent&&c.agent.status!=='closed'));
 const card=(id,column)=>({...structuredClone(source),key:id,taskId:id,title:id,column,note:null,remote:undefined,agent:{...structuredClone(source.agent),id,status:column==='working'?'running':'finished',pendingPermissions:column==='blocked'?1:0}});
 const refresh=async()=>{await view.getByRole('button',{name:'Refresh',exact:true}).click();await view.clock.runFor(150);await view.waitForTimeout(150);await view.clock.runFor(600);await view.waitForTimeout(50);await view.clock.runFor(300);};
 const set=async cards=>{await view.evaluate(cards=>window.changeFleet(f=>{f.cards=cards;f.suggestions=[];}),cards);await refresh();};
 const mixed=['working','working','ready','blocked','idle','idle','idle','idle'].map((s,i)=>card('sailor-'+i,s));
 const shot=async n=>{console.log('capture '+n);await view.mouse.move(1,899);writeFileSync(resolve(out,n+'.png'),await canvas.screenshot());};
 const point=async(x,y)=>{const fit=await view.evaluate(m=>{const r=window.drawOverlay(m);document.querySelector('[data-firstmate-deck-overlay]').remove();return r.fit;},manifest);const b=await canvas.boundingBox();await view.mouse.click(b.x+fit.x+x*fit.scale,b.y+fit.y+y*fit.scale);};
 const panel=view.getByTestId('firstmate-deck-focus'),bubble=view.getByTestId('firstmate-deck-suggestions');
 const close=async()=>{await view.keyboard.press('Escape');await view.clock.runFor(400);await view.waitForTimeout(70);await view.clock.runFor(300);await panel.waitFor({state:'hidden'});await bubble.waitFor({state:'hidden'});};
 await set(mixed);await view.clock.setSystemTime(new Date('2026-10-18T23:00:00Z'));await view.clock.fastForward(61000);await refresh();await shot('night-wide');
 await view.setViewportSize({width:700,height:1400});await view.clock.runFor(600);await shot('night-tall-narrow');await view.setViewportSize({width:1440,height:900});await view.clock.runFor(600);
 await view.evaluate(()=>{window.requestAnimationFrame=cb=>window.setTimeout(()=>cb(performance.now()),100);window.cancelAnimationFrame=h=>window.clearTimeout(h);});await set([]);await view.emulateMedia({reducedMotion:'no-preference'});
 for(let i=0;i<5;i++){await view.clock.runFor(100000);console.log('night voyage '+((i+1)*100)+'s');}await shot('port-night-wide');
 for(let i=0;i<5;i++){await view.clock.runFor(100000);console.log('night voyage '+((i+6)*100)+'s');}await view.clock.runFor(70000);await shot('lighthouse-night-wide');
 const frames=[];for(let i=0;i<40;i++){await view.clock.runFor(200);const a=decodePng(await canvas.screenshot());frames.push(nearest(a,800,Math.round(a.height*800/a.width)));}
 const palette=quantize(Buffer.concat(frames.map(a=>a.rgba)),256),g=GIFEncoder();for(const a of frames)g.writeFrame(applyPalette(a.rgba,palette),a.width,a.height,{palette,delay:200,repeat:0});g.finish();writeFileSync(resolve(out,'lighthouse-night.gif'),g.bytes());
 await view.setViewportSize({width:700,height:1400});await view.clock.runFor(600);await shot('lighthouse-night-tall-narrow');
 assert.equal(await canvas.getAttribute('data-firstmate-deck-sky'),'night');assert.deepEqual(errors,[]);
 writeFileSync(resolve(here,'night-details.json'),JSON.stringify({manifestSha256:sha(readFileSync(resolve(root,'art/settings/ship/setting.json'))),night:await canvas.getAttribute('data-firstmate-deck-sky'),voyageSeconds:1070,frames:frames.length,errors},null,2));
}
