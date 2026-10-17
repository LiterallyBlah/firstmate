/** Black-box captures from the established RPC/client fixture; no Pixi observers. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {decodePng} from '../../../test/png.ts';
import {nearest,crop,encode,blank,paste} from '../japanese-ship/build-art.mjs';
import {geometry} from './geometry.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..'),out=resolve(root,process.env.GHOST_EVIDENCE??'.local/ghost-ship-fixes/acceptance');mkdirSync(out,{recursive:true});
const manifest=JSON.parse(readFileSync(resolve(root,'art/settings/ghost-ship/setting.json')));
const {GIFEncoder,quantize,applyPalette}=createRequire(resolve(root,'.local/tools/package.json'))('gifenc');
const sha=b=>createHash('sha256').update(b).digest('hex');
const gif=(name,frames,delay=200)=>{const palette=quantize(Buffer.concat(frames.map(a=>a.rgba)),256),g=GIFEncoder();for(const a of frames)g.writeFrame(applyPalette(a.rgba,palette),a.width,a.height,{palette,delay,repeat:0});g.finish();writeFileSync(resolve(out,name+'.gif'),g.bytes());};
export async function review(browser,origin){
 const matrix=process.env.GHOST_REVIEW==='matrix',lite=process.env.GHOST_LITE==='1',errors=[],checks=[],results=[];
 for(const [aspect,width,height] of matrix?[['wide',1440,900],['square',1000,1000],['tall-narrow',650,1900]]:[['wide',1440,900]]){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce',timezoneId:'UTC'}),view=await context.newPage();view.on('pageerror',e=>errors.push(e.message));const noon=Date.parse('2026-10-16T12:00:00Z');await view.clock.install({time:noon});
  await view.goto(origin+'/?tree=branch&theme=dark&working=3&setting=ghost-ship&persistScene=1');await view.getByRole('button',{name:'Open Deck',exact:true}).waitFor();await view.clock.pauseAt(noon+20000);await view.getByRole('button',{name:'Open Deck',exact:true}).click();
  const canvas=view.locator('canvas[data-firstmate-deck]');for(let i=0;i<100&&!(await canvas.count());i++){await view.clock.runFor(100);await view.waitForTimeout(50);}assert.equal(await canvas.count(),1,JSON.stringify(errors));await view.clock.runFor(500);await view.waitForTimeout(300);assert.equal(await canvas.getAttribute('data-firstmate-deck-setting'),'ghost-ship');
  const source=await view.evaluate(()=>window.fixtureFleet.cards.find(c=>c.agent&&c.agent.status!=='closed'));
  const card=(id,state)=>({...structuredClone(source),key:id,taskId:id,title:id,column:state==='waiting'?'ready':state,note:null,remote:undefined,agent:{...structuredClone(source.agent),id,status:state==='working'?'running':'finished',pendingPermissions:state==='blocked'?1:0}});
  const refresh=async()=>{await view.getByRole('button',{name:'Refresh',exact:true}).click();await view.clock.runFor(150);await view.waitForTimeout(100);await view.clock.runFor(600);await view.waitForTimeout(50);await view.clock.runFor(300);};
  const set=async cards=>{await view.evaluate(cards=>window.changeFleet(f=>{f.cards=cards;f.suggestions=[];}),cards);await refresh();};
  const mixed=['working','working','waiting','blocked','idle','idle','idle','idle'].map((s,i)=>card('ghost-'+i,s));
  const fit=async()=>view.evaluate(m=>{const r=window.drawOverlay(m);document.querySelector('[data-firstmate-deck-overlay]').remove();return r.fit;},manifest);
  const shot=async name=>{await view.mouse.move(0,0);await canvas.screenshot({path:resolve(out,name+'.png')});};
  const capture=async()=>{const a=decodePng(await canvas.screenshot());return nearest(a,800,Math.round(a.height*800/a.width));};
  const phase=async time=>{await view.clock.setSystemTime(new Date('2026-10-17T'+time+':00Z'));await view.clock.fastForward(61000);await refresh();};
  const storm=async()=>{await set(Array.from({length:24},(_,i)=>card('Storm '+i,'working')));await view.emulateMedia({reducedMotion:'no-preference'});await view.clock.runFor(20000);assert.ok(Number(await canvas.getAttribute('data-firstmate-deck-weather'))>.95);};
  await set(mixed);
  if(process.env.GHOST_REVIEW==='storm'){
   await phase('21:00');await storm();const peaks=[];let flashSeen=false;
   for(let i=0;i<160;i++){await view.clock.runFor(150);if(await canvas.getAttribute('data-firstmate-deck-flash')){flashSeen=true;await shot('storm-lightning');}peaks.push(await capture());}
   gif('storm-peak-whale-and-ship',peaks,150);const contact=blank(800*4,peaks[0].height*5);for(let i=0;i<20;i++)paste(contact,peaks[i*8],(i%4)*800,Math.floor(i/4)*peaks[0].height);writeFileSync(resolve(out,'storm-contact.png'),encode(contact));assert.ok(flashSeen);assert.deepEqual(errors,[]);await context.close();writeFileSync(resolve(out,'storm-check.json'),JSON.stringify({flashSeen,frames:peaks.length,errors},null,2)+'\n');return;
  }
  if(matrix){
   for(const [name,time]of [['dawn','05:30'],['morning','08:00'],['midday','12:00'],['afternoon','16:00'],['dusk','18:30'],['night','21:00']]){await phase(time);assert.equal(await canvas.getAttribute('data-firstmate-deck-sky'),name);await shot(name+'-'+aspect);await view.evaluate(m=>window.drawOverlay(m),manifest);await shot(name+'-'+aspect+'-overlay');await view.evaluate(()=>document.querySelector('[data-firstmate-deck-overlay]').remove());results.push({aspect,phase:name,fit:await fit(),canvas:await canvas.boundingBox()});}
   await phase('21:00');await storm();await shot('storm-'+aspect);await view.evaluate(m=>window.drawOverlay(m),manifest);await shot('storm-'+aspect+'-overlay');await view.evaluate(()=>document.querySelector('[data-firstmate-deck-overlay]').remove());
   const a=decodePng(await canvas.screenshot());await view.clock.runFor(300);const b=decodePng(await canvas.screenshot()),bands=[];for(let band=0;band<10;band++){let changed=0;for(let y=Math.floor(a.height*band/10);y<Math.floor(a.height*(band+1)/10);y++)for(let x=0;x<a.width;x++){const i=(y*a.width+x)*4;if(a.rgba[i]!==b.rgba[i]||a.rgba[i+1]!==b.rgba[i+1]||a.rgba[i+2]!==b.rgba[i+2])changed++;}assert.ok(changed>100,aspect+' weather band '+band);bands.push({band,changed});}results.push({aspect,phase:'storm',weather:await canvas.getAttribute('data-firstmate-deck-weather'),bands});await context.close();continue;
  }
  const point=async(x,y)=>{const f=await fit(),b=await canvas.boundingBox();await view.mouse.click(b.x+f.x+x*f.scale,b.y+f.y+y*f.scale);};
  const panel=view.getByTestId('firstmate-deck-focus'),bubble=view.getByTestId('firstmate-deck-suggestions');
  const close=async()=>{await view.keyboard.press('Escape');await view.clock.runFor(450);await view.waitForTimeout(50);await view.clock.runFor(350);await panel.waitFor({state:'hidden'});await bubble.waitFor({state:'hidden'});};
  const still=sha(await canvas.screenshot());await view.clock.runFor(2400);assert.equal(sha(await canvas.screenshot()),still);checks.push('still scene pixel stable');await shot(lite?'lite-still':'still');
  await point(730,493);await bubble.waitFor();assert.equal(await panel.count(),0);await close();checks.push('half-submerged anglerfish opens suggestions');
  if(!lite&&process.env.GHOST_REVIEW!=='clips'){
   await view.getByRole('button',{name:/^Scene:/}).click();await view.getByRole('button',{name:/^Ghost ship, /}).waitFor();await view.keyboard.press('Escape');checks.push('picker includes Ghost ship');
   const clicks=[];for(const state of ['idle','working','waiting','blocked']){await set(Array.from({length:24},(_,i)=>card(state+' '+i,state)));await shot('crowd-'+state+'-24');for(const f of geometry(manifest,state)){assert.ok(f.target,'reachable '+f.key);await point(f.target.x,f.target.y);await panel.waitFor();const label=await panel.getAttribute('aria-label');assert.ok(label.includes(f.key),f.key+': '+label);clicks.push({...f,label});await close();}checks.push('24 '+state+' exact focus clicks');}writeFileSync(resolve(out,'crowd-focus.json'),JSON.stringify(clicks,null,2)+'\n');
  }
  await set(mixed);await view.emulateMedia({reducedMotion:'no-preference'});await view.clock.runFor(1000);const mode=await canvas.getAttribute('data-firstmate-deck-motion');assert.equal(mode,lite?'lite':'full');
  const frames=[];for(let i=0;i<40;i++){await view.clock.runFor(200);frames.push(await capture());}assert.ok(new Set(frames.map(a=>sha(a.rgba))).size>20);gif(lite?'lite-alive':'scene-alive',frames);checks.push(mode+' scene changes throughout sampled sequence');
  const frameFit=await fit(),frameBox=await canvas.boundingBox(),ratio=800/frameBox.width;
  const region=(a,r)=>crop(a,Math.round((frameFit.x+r[0]*frameFit.scale)*ratio),Math.round((frameFit.y+r[1]*frameFit.scale)*ratio),Math.max(1,Math.round(r[2]*frameFit.scale*ratio)),Math.max(1,Math.round(r[3]*frameFit.scale*ratio)));
  const regions={sails:[235,96,420,190],flags:[300,28,350,65],rigging:[112,108,120,175],lanterns:[635,280,25,30],seams:[270,408,330,30],raven:[360,70,25,30],crew:[335,300,130,38],water:[0,440,180,58],candles:[210,430,30,50],hatch:[548,290,45,50],mist:[0,235,180,30]};
  const distinct=Object.fromEntries(Object.entries(regions).map(([id,r])=>[id,new Set(frames.map(a=>sha(region(a,r).rgba))).size]));for(const [id,n]of Object.entries(distinct))assert.ok(n>1,id+' visibly changes');writeFileSync(resolve(out,lite?'motion-regions-lite.json':'motion-regions.json'),JSON.stringify({regions,distinct},null,2)+'\n');
  if(lite){await storm();await shot('lite-storm');await context.close();writeFileSync(resolve(out,'lite.json'),JSON.stringify({checks,errors},null,2)+'\n');assert.deepEqual(errors,[]);return;}
  await phase('21:00');const night=[];for(let i=0;i<40;i++){await view.clock.runFor(250);night.push(await capture());}gif('night-spectral-crew',night,250);await shot('night-showpiece');
  await view.emulateMedia({reducedMotion:'reduce'});await set([]);await view.emulateMedia({reducedMotion:'no-preference'});await set([card('Lookout arrival','working')]);const climb=[];for(let i=0;i<85;i++){await view.clock.runFor(200);climb.push(await capture());}gif('hatch-and-lookout',climb);await shot('lookout');await point(298,72);await panel.waitFor();assert.ok((await panel.getAttribute('aria-label')).includes('Lookout arrival'));await close();checks.push('mist arrival and behind-sail climb reach clickable lookout');
  await view.emulateMedia({reducedMotion:'reduce'});await set([card('Departure','blocked')]);await view.emulateMedia({reducedMotion:'no-preference'});await view.clock.runFor(200);await set([]);const departure=[];for(let i=0;i<120;i++){await view.clock.runFor(100);departure.push(await capture());}gif('plank-kraken-departure',departure,100);gif('plank-kraken-close',departure.map(a=>nearest(region(a,[0,240,210,270]),420,540)),100);const sheet=blank(800*4,departure[0].height*4);for(let i=0;i<16;i++)paste(sheet,departure[i*7],(i%4)*800,Math.floor(i/4)*departure[0].height);writeFileSync(resolve(out,'departure-contact.png'),encode(sheet));checks.push('plank walk drop and 2000ms skeletal kraken swallow captured');
  await storm();const peaks=[];let flashSeen=false;for(let i=0;i<160;i++){await view.clock.runFor(150);if(await canvas.getAttribute('data-firstmate-deck-flash')){flashSeen=true;await shot('storm-lightning');}peaks.push(await capture());}gif('storm-peak-whale-and-ship',peaks,150);const contact=blank(800*4,peaks[0].height*5);for(let i=0;i<20;i++)paste(contact,peaks[i*8],(i%4)*800,Math.floor(i/4)*peaks[0].height);writeFileSync(resolve(out,'storm-contact.png'),encode(contact));assert.ok(flashSeen);checks.push('peak rain fog green lightning whale and spectral passage captured');
  await view.emulateMedia({reducedMotion:'reduce'});await shot('storm-reduced');const end=sha(await canvas.screenshot());await view.clock.runFor(4000);assert.equal(sha(await canvas.screenshot()),end);checks.push('reduced storm stable with set-piece creatures hidden');await context.close();
 }
 assert.deepEqual(errors,[]);writeFileSync(resolve(out,matrix?'matrix.json':process.env.GHOST_REVIEW==='clips'?'clips.json':'motion.json'),JSON.stringify({checks,results,errors},null,2)+'\n');console.log(JSON.stringify({checks,captures:results.length,errors}));
}


