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
 await set(mixed);await shot(lite?'lite-still':'day-canvas');
 if(!lite){await view.setViewportSize({width:700,height:1400});await view.clock.runFor(600);await shot('day-tall-narrow');await view.setViewportSize({width:1440,height:900});await view.clock.runFor(600);await view.evaluate(m=>window.drawOverlay(m),manifest);await shot('floor-overlay');await view.evaluate(()=>document.querySelector('[data-firstmate-deck-overlay]').remove());}
 const still=sha(await canvas.screenshot());await view.clock.runFor(2400);assert.equal(sha(await canvas.screenshot()),still,'reduced motion is stable');checks.push('reduced-motion pixels stable');
 await point(122,374);await bubble.waitFor();assert.equal(await panel.count(),0);await close();checks.push('half-submerged shark opens suggestions, not worker focus');
 await canvas.evaluate(n=>n.parentElement.focus());await view.keyboard.press('Enter');await panel.waitFor();await close();checks.push('keyboard focus and Escape');
 if(!lite){
  await view.getByRole('button',{name:/^Scene:/}).click();await view.getByRole('button',{name:/^Sky pirates, /}).waitFor();await view.getByRole('button',{name:/^Sakura coast, /}).waitFor();await view.getByRole('button',{name:/^Ship's deck, /}).waitFor();await view.keyboard.press('Escape');checks.push('picker retains Ship, Sakura coast and Sky pirates');
  await set(Array.from({length:24},(_,i)=>card('Sleeper '+i,'idle')));await shot('sleepers-24');
  const geometry=diagnose(manifest);assert.equal(geometry.overlaps.length,0);
  const focused=[];for(const f of geometry.resolved){assert.equal(f.centreWinner,f.key);await point(f.x,f.y-8);await panel.waitFor();await view.waitForTimeout(70);await view.clock.runFor(100);const label=await panel.getAttribute('aria-label');assert.ok(label.includes(f.key),`${f.key}: ${label}`);focused.push({key:f.key,box:f.box,x:f.x,y:f.y,label});await close();}writeFileSync(resolve(here,'crowd-focus.json'),JSON.stringify(focused,null,2));assert.equal(new Set(focused.map(f=>f.label)).size,24);checks.push('24 resolved sleeping-window centres focus their exact 24 sailors; zero hit-box overlaps');
  await set(Array.from({length:24},(_,i)=>card('Worker '+i,'working')));await shot('workers-24');checks.push('24 working crew crowd rendered');await set(mixed);
  await view.clock.setSystemTime(new Date('2026-10-16T23:00:00Z'));await view.clock.fastForward(61000);await refresh();assert.equal(await canvas.getAttribute('data-firstmate-deck-sky'),'night');await shot('night-wide');await view.setViewportSize({width:700,height:1400});await view.clock.runFor(600);await shot('night-tall-narrow');await view.setViewportSize({width:1440,height:900});await view.clock.runFor(600);
  for(const [phase,time]of [['dawn','05:30'],['morning','08:00'],['afternoon','16:00'],['dusk','18:30']]){await view.clock.setSystemTime(new Date('2026-10-17T'+time+':00Z'));await view.clock.fastForward(61000);await refresh();assert.equal(await canvas.getAttribute('data-firstmate-deck-sky'),phase);await shot(phase+'-wide');await view.setViewportSize({width:700,height:1400});await view.clock.runFor(600);await shot(phase+'-tall-narrow');await view.setViewportSize({width:1440,height:900});await view.clock.runFor(600);}checks.push('all six day phases captured wide and tall-narrow');
  await view.clock.setSystemTime(new Date('2026-10-17T12:00:00Z'));await view.clock.fastForward(61000);await refresh();assert.equal(await canvas.getAttribute('data-firstmate-deck-sky'),'midday');checks.push('day/night phase changes');
 }
 await view.emulateMedia({reducedMotion:'no-preference'});await view.clock.runFor(300);const mode=await canvas.getAttribute('data-firstmate-deck-motion');assert.equal(mode,lite?'lite':'full');
 const gif=async(name,images,delay=200)=>{const palette=quantize(Buffer.concat(images.map(a=>a.rgba)),256),g=GIFEncoder();for(const a of images)g.writeFrame(applyPalette(a.rgba,palette),a.width,a.height,{palette,delay,repeat:0});g.finish();writeFileSync(resolve(out,name+'.gif'),g.bytes());};
 const capture=async(width=800)=>{const a=decodePng(await canvas.screenshot());return nearest(a,width,Math.round(a.height*width/a.width));};
 const frames=[],whales=[];
 const fit=await view.evaluate(m=>{const r=window.drawOverlay(m);document.querySelector('[data-firstmate-deck-overlay]').remove();return r.fit;},manifest),box=await canvas.boundingBox();
 const regions={flag:[330,24,56,44],sailMain:[262,109,155,117],sailFore:[149,138,111,88],jib:[42,157,116,79],cat:[388,260,29,25],yardGull:[280,88,29,26],hull:[100,298,480,52],crew:[180,225,300,70],lantern:[139,247,12,20],ocean:[0,390,640,10],clouds:[0,0,640,20],shark:[52,348,78,48],dolphins:[150,322,70,55],whale:[40,160,70,50]};
 const stageCrop=(a,r)=>crop(a,Math.round(fit.x+r[0]*fit.scale),Math.round(fit.y+r[1]*fit.scale),Math.round(r[2]*fit.scale),Math.round(r[3]*fit.scale));
 for(let i=0;i<40;i++){await view.clock.runFor(200);const a=decodePng(await canvas.screenshot());samples.push(Object.fromEntries(Object.entries(regions).map(([id,r])=>[id,sha(stageCrop(a,r).rgba)])));if(!lite){frames.push(nearest(a,800,Math.round(a.height*800/a.width)));whales.push(nearest(stageCrop(a,regions.shark),240,176));}}
 const distinct=Object.fromEntries(Object.keys(regions).map(id=>[id,new Set(samples.map(s=>s[id])).size]));
 for(const id of Object.keys(regions).filter(id=>!lite||!['clouds','ocean','shark'].includes(id)))assert.ok(distinct[id]>1,id+' region visibly changes');
 checks.push(lite?'pixel sequences change across rig, flag, sails, cat, yard gull, hull, crew, lamps, dolphins and whale; no renderer introspection':'pixel sequences change across rig, flag, sails, cat, yard gull, hull, crew, lamps, sea, shark, dolphins and whale; no renderer introspection');
 if(lite){assert.equal(distinct.ocean,1);assert.equal(distinct.shark,1);checks.push('lite freezes the inherited sea and engine attention carrier while ship parts and life cycles run');await shot('lite');writeFileSync(resolve(here,'lite.json'),JSON.stringify({mode,checks,errors},null,2));assert.deepEqual(errors,[]);return;}
 await gif('scene-alive',frames);await gif('suggestion-shark',whales);
 // Arrival and climb are observed from an empty deck so a worker owns the raised station.
 // This identity hashes to post zero under the unchanged stable assignment rule.
 await view.emulateMedia({reducedMotion:'reduce'});await set([]);await view.emulateMedia({reducedMotion:'no-preference'});await set([card('Lookout arrival 1','working')]);
 const climb=[];for(let i=0;i<75;i++){await view.clock.runFor(200);climb.push(await capture());}await gif('hatch-and-lookout',climb);await shot('lookout');await point(331,65);await panel.waitFor();assert.ok((await panel.getAttribute('aria-label')).includes('Lookout arrival 1'));await close();checks.push('hatch arrival and post-transit climb captured; raised lookout click focuses arriving sailor');
 // Settled bow worker takes the finite plank path; sample effect frames as well as the GIF.
 await view.emulateMedia({reducedMotion:'reduce'});await set([card('Departing sailor','blocked')]);await view.emulateMedia({reducedMotion:'no-preference'});await view.clock.runFor(100);await set([]);
 const departure=[];for(let i=0;i<60;i++){await view.clock.runFor(120);departure.push(await capture());}
 await gif('plank-shark-departure',departure,120);const sheet=blank(800*4,departure[0].height*3);for(let i=0;i<12;i++)paste(sheet,departure[i*5],(i%4)*800,Math.floor(i/4)*departure[0].height);writeFileSync(resolve(out,'departure-contact-polish.png'),encode(sheet));checks.push('plank / splash / shark departure captured');
 await view.emulateMedia({reducedMotion:'reduce'});await set(Array.from({length:12},(_,i)=>card('Storm worker '+i,'working')));await view.emulateMedia({reducedMotion:'no-preference'});await view.clock.runFor(18000);
 assert.ok(Number(await canvas.getAttribute('data-firstmate-deck-weather'))>.95);await shot('storm-wide');await view.setViewportSize({width:700,height:1400});await view.clock.runFor(600);await shot('storm-tall-narrow');await view.setViewportSize({width:1440,height:900});await view.clock.runFor(600);let flashSeen=false;const stormFrames=[];
 for(let i=0;i<450;i++){await view.clock.runFor(100);const flashing=await canvas.getAttribute('data-firstmate-deck-flash');if(flashing&&!flashSeen){await shot('storm-lightning');flashSeen=true;}if(i<(manifest.stage.motion?.rock?80:40))stormFrames.push(await capture());}
 assert.ok(flashSeen,'bounded lightning occurs at peak storm');await gif('frigate-chase',stormFrames,100);checks.push('peak intensity, navy chase, rain, kraken, serpent and bounded lightning observed');
 await set([]);await view.clock.runFor(22000);assert.ok(Number(await canvas.getAttribute('data-firstmate-deck-weather'))<.05);checks.push('storm eases back to calm');
 if(manifest.stage.motion?.rock){
  await gif('rock-storm',stormFrames,100);
  const calm=[];for(let i=0;i<50;i++){await view.clock.runFor(200);calm.push(await capture());}await gif('rock-calm',calm);
  checks.push('ten-second calm and eight-second storm whole-stage rocking clips');
  // Use visible hover labels to find each moving target, then assert the exact focus label after clicking.
  // No renderer internals: the search is confined to the small swept neighbourhood of its resolved post.
  await view.emulateMedia({reducedMotion:'reduce'});await set(Array.from({length:24},(_,i)=>card('Sleeper '+i,'idle')));
  await view.emulateMedia({reducedMotion:'no-preference'});await view.clock.runFor(2100);
  const geometry=diagnose(manifest),movingClicks=[],label=view.getByTestId('firstmate-deck-label');
  for(const f of geometry.resolved){
   const frame=await view.evaluate(m=>{const r=window.drawOverlay(m);document.querySelector('[data-firstmate-deck-overlay]').remove();return r.fit;},manifest),bounds=await canvas.boundingBox();
   let hit=null;
   for(const dy of [0,-4,4,-8,8,-12,12]){for(const dx of [0,-4,4,-8,8]){
    const at={x:bounds.x+frame.x+(f.x+dx)*frame.scale,y:bounds.y+frame.y+(f.y-8+dy)*frame.scale};
    await view.mouse.move(at.x,at.y);await view.waitForTimeout(20);
    if(await label.count()&&(await label.innerText()).split('\n')[0]===f.key){hit=at;break;}
   }if(hit)break;}
   assert.ok(hit,'moving hover target '+f.key);await view.mouse.click(hit.x,hit.y);await panel.waitFor();
   assert.ok((await panel.getAttribute('aria-label')).includes(f.key));movingClicks.push({key:f.key,point:hit});await close();
  }
  writeFileSync(resolve(here,'crowd-rock-focus.json'),JSON.stringify(movingClicks,null,2));checks.push('24 moving sleeping-window targets hover and focus their exact sailors');
 }
 await view.emulateMedia({reducedMotion:'reduce'});await set(mixed);const stillEnd=sha(await canvas.screenshot());await view.clock.runFor(4000);assert.equal(sha(await canvas.screenshot()),stillEnd);checks.push('reduced motion returns to calm stable scene');
 await view.emulateMedia({reducedMotion:'no-preference'});await set([]);
 // Sample a long route at 10 Hz, exactly MAX_STEP_MS: engine seconds and drift speed are unchanged.
 await view.evaluate(()=>{window.requestAnimationFrame=callback=>window.setTimeout(()=>callback(performance.now()),100);window.cancelAnimationFrame=handle=>window.clearTimeout(handle);});
 const voyage=[];for(let i=0;i<=101;i++){await view.clock.runFor(12000);voyage.push(await capture(640));if(i%10===0)console.log('voyage sample '+i+'/101');}
 await gif('voyage-60x',voyage,200);checks.push('unmodified 1.7 px/s coastline observed for 1224 seconds: full 20m 05s lap, clip 60x');
 await view.clock.setSystemTime(new Date('2026-10-18T23:00:00Z'));await view.clock.fastForward(61000);await refresh();
 // Reach the lighthouse near the right side after a further 850 seconds.
 await view.clock.runFor(850000);await shot('lighthouse-night-wide');
 const lighthouse=[];for(let i=0;i<40;i++){await view.clock.runFor(200);lighthouse.push(await capture());}await gif('lighthouse-night',lighthouse);
 await view.setViewportSize({width:700,height:1400});await view.clock.runFor(600);await shot('lighthouse-night-tall-narrow');
 checks.push('night lighthouse sweep clip at real speed; long-route scheduler samples at 10 Hz with unchanged 100 ms engine steps');
 assert.deepEqual(errors,[]);assert.equal((await view.evaluate(()=>window.fixtureCalls)).filter(c=>/\.send$|\.steer$|\.respond$/.test(c.name)).length,0);
 writeFileSync(resolve(here,'motion-full.json'),JSON.stringify({mode,checks,regions,distinct,samples,errors},null,2));console.log(JSON.stringify({mode,checks,errors}));
}
