/** Real canvas captures via the existing fixture host. No Pixi observer or renderer patch. */
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {decodePng} from '../../../../test/png.ts';
import {nearest,crop} from '../build-art.mjs';
import assert from 'node:assert/strict';
const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'../../../..');
const require=createRequire(join(root,'docs/board-list/package.json'));
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function checkParity(view,manifest){
  // Other opt-in review hooks exercise narrow panes; every comparison starts at the same viewport.
  await view.setViewportSize({width:1440,height:900});
  const phase=process.env.SAKURA_PARITY;
  const out=join(here,'review',phase);await mkdir(out,{recursive:true});
  const canvas=view.locator('canvas[data-firstmate-deck]');
  const noon=Date.parse('2026-10-16T12:00:00Z');
  await view.clock.install({time:noon});await view.reload();await view.clock.pauseAt(noon+20000);
  const open=view.getByRole('button',{name:'Open Deck',exact:true});
  for(let i=0;i<100&&!await open.isEnabled();i++){await view.clock.runFor(100);await view.waitForTimeout(50);}
  await open.click();
  for(let i=0;i<100&&!await canvas.count();i++){await view.clock.runFor(100);await view.waitForTimeout(50);}
  await canvas.waitFor();await view.clock.runFor(800);
  assert.equal(await canvas.getAttribute('data-firstmate-deck-setting'),'japanese-ship');
  const shot=async name=>{await view.mouse.move(1,899);await canvas.screenshot({path:join(out,name+'.png')});};
  await shot('day');
  await view.evaluate(m=>window.drawOverlay(m),manifest);await shot('overlay');
  await view.evaluate(()=>document.querySelector('[data-firstmate-deck-overlay]').remove());
  await view.emulateMedia({reducedMotion:'no-preference'});
  await view.evaluate(()=>window.changeFleet(f=>{const source=f.cards.find(c=>c.agent&&c.agent.status!=='closed');f.cards=Array.from({length:24},(_,i)=>({...structuredClone(source),key:'storm-'+i,taskId:'storm-'+i,title:'Storm sailor '+i,column:'working',note:null,remote:undefined,agent:{...structuredClone(source.agent),id:'storm-'+i,status:'running',pendingPermissions:0}}));}));
  await view.getByRole('button',{name:'Refresh',exact:true}).click();await view.clock.runFor(45000);await shot('storm');
  const movingMode=await canvas.getAttribute('data-firstmate-deck-motion');
  const stormLevel=await canvas.getAttribute('data-firstmate-deck-weather');
  if(phase==='after')await clip('storm-peak',32,250);
  await view.emulateMedia({reducedMotion:'reduce'});
  for(const [name,time] of [['dusk','18:30'],['night','23:00']]){await view.clock.setFixedTime(new Date('2026-10-16T'+time+':00Z'));await view.clock.runFor(61000);await shot(name);}
  if(phase==='after'){
    const still=sha(await canvas.screenshot());await view.clock.runFor(2000);assert.equal(sha(await canvas.screenshot()),still,'reduced motion is pixel-stable');
    await view.emulateMedia({reducedMotion:'no-preference'});await clip('night-motion',20,250);await view.emulateMedia({reducedMotion:'reduce'});
    await interactions();
  }
  await writeFile(join(out,'capture.json'),JSON.stringify({phase,setting:manifest.id,movingMode,stormLevel,observer:'canvas PNGs and public DOM attributes only'},null,2)+'\n');

  async function clip(name,count,step,world){
    const {GIFEncoder,quantize,applyPalette}=createRequire(join(root,'.generated/motion-tools/package.json'))('gifenc');
    const gif=GIFEncoder(),frames=[],hashes=[];
    const fit=await view.evaluate(m=>{const a=window.drawOverlay(m);document.querySelector('[data-firstmate-deck-overlay]').remove();return a.fit;},manifest);
    for(let i=0;i<count;i++){
      await view.clock.runFor(step);const bytes=await canvas.screenshot();let a=decodePng(bytes);hashes.push(sha(bytes));
      if(world){const d=2;const [x,y,w,h]=world;a=crop(a,Math.round((fit.x+x*fit.scale)*d),Math.round((fit.y+y*fit.scale)*d),Math.round(w*fit.scale*d),Math.round(h*fit.scale*d));}
      const resized=nearest(a,world?600:900,Math.round(a.height*(world?600:900)/a.width));
      const palette=quantize(resized.rgba,256);gif.writeFrame(applyPalette(resized.rgba,palette),resized.width,resized.height,{palette,delay:step,repeat:0});
      if(i%4===0){await writeFile(join(out,name+'-'+String(i).padStart(3,'0')+'.png'),bytes);frames.push(i);}
    }
    gif.finish();await writeFile(join(out,name+'.gif'),gif.bytes());
    await writeFile(join(out,name+'.json'),JSON.stringify({stepMs:step,frames:count,hashes,keyframes:frames,world:world??null},null,2)+'\n');
    assert.ok(new Set(hashes).size>1,name+' has changing real canvas frames');
  }

  async function interactions(){
    await view.clock.setFixedTime(new Date('2026-10-17T12:00:00Z'));await view.clock.runFor(61000);
    const target=join(root,'.generated/sakura-parity-engine.mjs');
    await require('esbuild').build({stdin:{contents:"export {compileStage} from './client/deck-stage';export {compileCast} from './client/deck-cast';export {createCrew,applyCrew,crewFigures,stepCrew} from './client/deck-crew';export {badgeTop,sailorAt} from './client/deck-hover';",resolveDir:root},outfile:target,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
    const engine=await import(pathToFileURL(target));const stage=engine.compileStage(manifest),cast=engine.compileCast(manifest);
    const source=await view.evaluate(()=>window.fixtureFleet.cards.find(c=>c.agent));
    const card=(id,column)=>({...structuredClone(source),key:id,taskId:id,title:id,column,note:null,remote:undefined,agent:{...structuredClone(source.agent),id,status:column==='working'?'running':'finished',pendingPermissions:column==='blocked'?1:0}});
    const set=async(cards,settle=800)=>{await view.evaluate(cards=>window.changeFleet(f=>{f.cards=cards;f.suggestions=[];}),cards);await view.getByRole('button',{name:'Refresh',exact:true}).click();await view.clock.runFor(settle);await view.waitForTimeout(100);};
    const point=async(x,y)=>{const fit=await view.evaluate(m=>{const a=window.drawOverlay(m);document.querySelector('[data-firstmate-deck-overlay]').remove();return a.fit;},manifest);const b=await canvas.boundingBox();await view.mouse.click(b.x+fit.x+x*fit.scale,b.y+fit.y+y*fit.scale);};
    const panel=view.getByTestId('firstmate-deck-focus'),focused=[];
    for(const [column,state]of [['idle','idle'],['working','working'],['ready','waiting'],['blocked','blocked']]){
      const cards=Array.from({length:24},(_,i)=>card(column+'-'+String(i).padStart(2,'0'),column));await set(cards);await shot('crowd-'+column+'-24');
      const crew=engine.createCrew(stage,cast);engine.applyCrew(crew,cards.map(c=>({key:c.key,identity:c.agent.id,state,stale:false})),{snap:true});const figures=engine.crewFigures(crew,0,{still:true});
      for(const figure of figures){
        let at=null;const top=engine.badgeTop(figure,cast);
        for(let y=top;y<top+8&&!at;y++)for(let x=figure.x-3;x<=figure.x+3&&!at;x++)if(engine.sailorAt(figures,cast,{x:x+.5,y:y+.5})?.key===figure.key)at=[x+.5,y+.5];
        assert.ok(at,figure.key+' has a reachable badge');await point(...at);await panel.waitFor({state:'visible'});
        const label=await panel.getAttribute('aria-label');assert.equal(label,figure.key+': details and actions');focused.push(label);
        await view.keyboard.press('Escape');await view.clock.runFor(600);await panel.waitFor({state:'hidden'});
      }
    }
    // The preserved shark remains independent of crew focus, including an empty suggestion list.
    await point(130,305);await view.getByTestId('firstmate-deck-suggestions').waitFor();assert.equal(await panel.count(),0);await view.keyboard.press('Escape');
    // One stern worker has a short, unambiguous walk to the plank before the dragon sequence.
    await set([card('Departure sailor','ready')]);await view.emulateMedia({reducedMotion:'no-preference'});
    await set([card('Departure sailor','done')],100);await clip('sea-dragon-departure',100,100,[280,190,190,130]);
    // Start on the floor, then change to rigging so the mast ascent is visible instead of first-mount snapping.
    await view.emulateMedia({reducedMotion:'reduce'});
    const climbing=Array.from({length:7},(_,i)=>card('climber-'+i,'ready'));await set(climbing);
    await view.emulateMedia({reducedMotion:'no-preference'});await set(climbing.map(c=>card(c.key,'working')));await clip('lookout-climb',100,250,[190,8,115,240]);
    await view.emulateMedia({reducedMotion:'reduce'});
    const climberCrew=engine.createCrew(stage,cast);engine.applyCrew(climberCrew,climbing.map(c=>({key:c.key,identity:c.agent.id,state:'working',stale:false})),{snap:true});
    const lookout=engine.crewFigures(climberCrew,0,{still:true}).find(f=>f.y<100);assert.ok(lookout);
    await point(lookout.x,lookout.y-12);await panel.waitFor({state:'visible'});assert.equal(await panel.getAttribute('aria-label'),lookout.key+': details and actions');await view.keyboard.press('Escape');
    await writeFile(join(out,'interactions.json'),JSON.stringify({focused,lookout:lookout.key,shark:'opens empty suggestions independently',count:focused.length},null,2)+'\n');
  }
}
