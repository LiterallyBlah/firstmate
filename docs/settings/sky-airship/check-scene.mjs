/** Acceptance evidence from the unmodified compiled client, real RPC loader and real WebGL renderer. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {decodePng} from '../../../test/png.ts';
import {nearest} from '../japanese-ship/build-art.mjs';
import {diagnose} from './diagnose-crowd.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..'),out=resolve(here,'review');mkdirSync(out,{recursive:true});
const manifest=JSON.parse(readFileSync(resolve(root,'art/settings/sky-airship/setting.json')));
const require=createRequire(resolve(root,'.generated/motion-tools/package.json'));
const {GIFEncoder,quantize,applyPalette}=require('gifenc');
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function review(browser,origin){
 const lite=process.env.AIRSHIP_LITE==='1',errors=[],checks=[],samples=[];
 const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,reducedMotion:'reduce',timezoneId:'UTC'});
 const view=await context.newPage();view.on('pageerror',e=>errors.push(e.message));
 const noon=Date.parse('2026-10-16T12:00:00Z');await view.clock.install({time:noon});
 await view.goto(origin+'/?tree=branch&theme=dark&working=3&setting=sky-airship&persistScene=1');
 await view.getByRole('button',{name:'Open Deck',exact:true}).waitFor();await view.clock.pauseAt(noon+20000);
 await view.getByRole('button',{name:'Open Deck',exact:true}).click();
 const canvas=view.locator('canvas[data-firstmate-deck]');
 for(let i=0;i<100&&!(await canvas.count());i++){await view.clock.runFor(100);await view.waitForTimeout(50);}
 assert.equal(await canvas.count(),1,JSON.stringify({errors,body:(await view.locator('body').innerText()).slice(-1500)}));
 await view.clock.runFor(500);await view.waitForTimeout(300);
 assert.equal(await canvas.getAttribute('data-firstmate-deck-setting'),'sky-airship');
 const source=await view.evaluate(()=>window.fixtureFleet.cards.find(c=>c.agent&&c.agent.status!=='closed'));
 const card=(id,column)=>({...structuredClone(source),key:id,taskId:id,title:id,column,note:null,remote:undefined,agent:{...structuredClone(source.agent),id,status:column==='working'?'running':'finished',pendingPermissions:column==='blocked'?1:0}});
 const refresh=async()=>{await view.getByRole('button',{name:'Refresh',exact:true}).click();await view.clock.runFor(150);await view.waitForTimeout(150);await view.clock.runFor(600);await view.waitForTimeout(50);await view.clock.runFor(300);};
 const set=async cards=>{await view.evaluate(cards=>window.changeFleet(f=>{f.cards=cards;f.suggestions=[];}),cards);await refresh();};
 const mixed=['working','working','ready','blocked','idle','idle','idle','idle'].map((s,i)=>card('sailor-'+i,s));
 const shot=async n=>{await view.mouse.move(1,899);writeFileSync(resolve(out,n+'.png'),await canvas.screenshot());};
 const inspect=()=>view.evaluate(()=>{const all=[];const walk=n=>{all.push(n);for(const c of n.children??[])walk(c);};walk(window.motionReviewApp.stage);const tex=n=>n?.texture?`${(n.texture.source??n.texture.baseTexture)?.uid}:${n.texture.frame.x},${n.texture.frame.y}`:null;return Object.fromEntries(all.filter(n=>n.label).map(n=>[n.label,{x:n.x,y:n.y,alpha:n.alpha,visible:n.visible,texture:tex(n),children:n.children?.slice(0,10).map(c=>({x:c.x,y:c.y,alpha:c.alpha,visible:c.visible,texture:tex(c)}))}]));});
 const point=async(x,y)=>{const fit=await view.evaluate(m=>{const r=window.drawOverlay(m);document.querySelector('[data-firstmate-deck-overlay]').remove();return r.fit;},manifest);const b=await canvas.boundingBox();await view.mouse.click(b.x+fit.x+x*fit.scale,b.y+fit.y+y*fit.scale);};
 const panel=view.getByTestId('firstmate-deck-focus'),bubble=view.getByTestId('firstmate-deck-suggestions');
 const close=async()=>{await view.keyboard.press('Escape');await view.clock.runFor(400);await view.waitForTimeout(70);await view.clock.runFor(300);await panel.waitFor({state:'hidden'});await bubble.waitFor({state:'hidden'});};
 await set(mixed);await shot(lite?'lite-still':'day-canvas');
 if(!lite){await view.evaluate(m=>window.drawOverlay(m),manifest);await shot('floor-overlay');await view.evaluate(()=>document.querySelector('[data-firstmate-deck-overlay]').remove());}
 const still=sha(await canvas.screenshot());await view.clock.runFor(2400);assert.equal(sha(await canvas.screenshot()),still,'reduced motion is stable');checks.push('reduced-motion pixels stable');
 await point(440,300);await bubble.waitFor();assert.equal(await panel.count(),0);await close();checks.push('small whale body opens suggestions, not worker focus');
 await canvas.evaluate(n=>n.parentElement.focus());await view.keyboard.press('Enter');await panel.waitFor();await close();checks.push('keyboard focus and Escape');
 if(!lite){
  await view.getByRole('button',{name:/^Scene:/}).click();await view.getByRole('button',{name:/^Sky pirates, /}).waitFor();await view.getByRole('button',{name:/^Sakura coast, /}).waitFor();await view.getByRole('button',{name:/^Ship's deck, /}).waitFor();await view.keyboard.press('Escape');checks.push('picker lists Sky pirates alongside both existing packs');
  await set(Array.from({length:24},(_,i)=>card('Sleeper '+i,'idle')));await shot('sleepers-24');
  const geometry=diagnose(manifest),live=await inspect();assert.equal(geometry.overlaps.length,0);
  const focused=[];for(const f of geometry.resolved){assert.equal(f.centreWinner,f.key);assert.equal(live[f.key].x,f.x);assert.equal(live[f.key].y,f.y);await point(f.x,f.y-8);await panel.waitFor();await view.waitForTimeout(70);await view.clock.runFor(100);const label=await panel.getAttribute('aria-label');assert.ok(label.includes(f.key),`${f.key}: ${label}`);focused.push({key:f.key,box:f.box,x:f.x,y:f.y,label,live:live[f.key]});await close();}writeFileSync(resolve(here,'crowd-focus.json'),JSON.stringify(focused,null,2));assert.equal(new Set(focused.map(f=>f.label)).size,24);checks.push('24 resolved sleeping-window centres focus their exact 24 sailors; zero hit-box overlaps');
  await set(Array.from({length:24},(_,i)=>card('Worker '+i,'working')));await shot('workers-24');checks.push('24 working crew crowd rendered');await set(mixed);
  await view.clock.setSystemTime(new Date('2026-10-16T23:00:00Z'));await view.clock.runFor(61000);await refresh();assert.equal(await canvas.getAttribute('data-firstmate-deck-sky'),'night');await shot('night');
  await view.clock.setSystemTime(new Date('2026-10-17T12:00:00Z'));await view.clock.runFor(61000);await refresh();assert.equal(await canvas.getAttribute('data-firstmate-deck-sky'),'day');checks.push('day/night phase changes');
 }
 await view.emulateMedia({reducedMotion:'no-preference'});await view.clock.runFor(300);const mode=await canvas.getAttribute('data-firstmate-deck-motion');assert.equal(mode,lite?'lite':'full');
 const gif=async(name,images,delay=200)=>{const palette=quantize(Buffer.concat(images.map(a=>a.rgba)),256),g=GIFEncoder();for(const a of images)g.writeFrame(applyPalette(a.rgba,palette),a.width,a.height,{palette,delay,repeat:0});g.finish();writeFileSync(resolve(out,name+'.gif'),g.bytes());};
 const capture=async(width=800)=>{const a=decodePng(await canvas.screenshot());return nearest(a,width,Math.round(a.height*width/a.width));};
 const frames=[],whales=[];
 const fit=await view.evaluate(m=>{const r=window.drawOverlay(m);document.querySelector('[data-firstmate-deck-overlay]').remove();return r.fit;},manifest),box=await canvas.boundingBox();
 for(let i=0;i<40;i++){await view.clock.runFor(200);samples.push(await inspect());if(!lite){frames.push(await capture());const a=decodePng(await view.screenshot({clip:{x:box.x+fit.x+405*fit.scale,y:box.y+fit.y+270*fit.scale,width:70*fit.scale,height:54*fit.scale}}));whales.push(nearest(a,280,216));}}
 const distinct=(label,field='texture')=>new Set(samples.map(s=>JSON.stringify(s[label]?.[field]))).size;
 for(const id of ['balloon','rig','flag','sail-left','sail-right','propeller','chimney-smoke','propeller-vapour'])assert.ok(distinct(id)>1,id+' changes texture');
 assert.ok(distinct('ship','y')>1,'whole ship bobs');assert.ok(distinct('lookout-pennant','x')>1,'part sway');
 assert.equal(distinct('carrier-above-surface')>1,!lite,'carrier full/lite policy');assert.equal(distinct('attention-carrier','x')>1,!lite,'carrier loiter full/lite policy');
 checks.push('all eight authored part animations change real textures; bob and part sway move; whale respects full/lite policy');
 if(lite){await shot('lite');writeFileSync(resolve(here,'lite.json'),JSON.stringify({mode,checks,errors},null,2));assert.deepEqual(errors,[]);return;}
 await gif('scene-alive',frames);await gif('suggestion-whale',whales);
 // Arrival and climb are observed from an empty deck so a worker owns the raised station.
 await view.emulateMedia({reducedMotion:'reduce'});await set([]);await view.emulateMedia({reducedMotion:'no-preference'});await set([card('Lookout arrival','working')]);
 const climb=[];for(let i=0;i<75;i++){await view.clock.runFor(200);const s=await inspect();climb.push(s['Lookout arrival']);}assert.ok(new Set(climb.map(x=>x?.y)).size>20,'arrival climbs through deck and up rigging');await shot('lookout');checks.push('hatch arrival and reversible post-transit climb observed');
 // Settled bow worker takes the finite plank path; sample effect frames as well as the GIF.
 await view.emulateMedia({reducedMotion:'reduce'});await set([card('Departing sailor','blocked')]);await view.emulateMedia({reducedMotion:'no-preference'});await view.clock.runFor(100);await set([]);
 const departure=[],effectSamples=[];for(let i=0;i<60;i++){await view.clock.runFor(120);const s=await inspect();effectSamples.push(Object.fromEntries(Object.entries(s).filter(([k])=>k.includes('effect')||k.includes('Departing')||k==='overboard')));departure.push(await capture());}
 await gif('whale-departure',departure,120);writeFileSync(resolve(here,'departure.json'),JSON.stringify(effectSamples,null,2));checks.push('plank/cloud-puff/whale departure captured');
 await view.emulateMedia({reducedMotion:'reduce'});await set(Array.from({length:12},(_,i)=>card('Storm worker '+i,'working')));await view.emulateMedia({reducedMotion:'no-preference'});await view.clock.runFor(18000);
 assert.ok(Number(await canvas.getAttribute('data-firstmate-deck-weather'))>.95);const storm=await inspect();assert.ok(storm['sky-serpent'].alpha>.5);await shot('storm');let flashSeen=false;const stormFrames=[];
 for(let i=0;i<450;i++){await view.clock.runFor(100);const flashing=await canvas.getAttribute('data-firstmate-deck-flash');if(flashing&&!flashSeen){await shot('storm-lightning');flashSeen=true;}if(i<40)stormFrames.push(await capture());}
 assert.ok(flashSeen,'bounded lightning occurs at peak storm');await gif('storm-alive',stormFrames,100);checks.push('peak intensity, rain, serpent and bounded lightning observed');
 await set([]);await view.clock.runFor(22000);assert.ok(Number(await canvas.getAttribute('data-firstmate-deck-weather'))<.05);checks.push('storm eases back to calm');
 await view.emulateMedia({reducedMotion:'reduce'});await set(mixed);const stillEnd=sha(await canvas.screenshot());await view.clock.runFor(4000);assert.equal(sha(await canvas.screenshot()),stillEnd);checks.push('reduced motion returns to calm stable scene');
 assert.deepEqual(errors,[]);assert.equal((await view.evaluate(()=>window.fixtureCalls)).filter(c=>/\.send$|\.steer$|\.respond$/.test(c.name)).length,0);
 writeFileSync(resolve(here,'motion-full.json'),JSON.stringify({mode,checks,samples,climb,errors},null,2));console.log(JSON.stringify({mode,checks,errors}));
}
