/** Pointer checks while an actual worker is partway up the ladder, using only the fixture and DOM. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../../..');
export async function checkTransit(view,manifest){
  const engine=await import(pathToFileURL(join(root,'.generated/sakura-parity-engine.mjs')));
  const stage=engine.compileStage(manifest),cast=engine.compileCast(manifest);
  let id;
  for(let i=0;i<100;i++){const key='lookout-probe-'+i,crew=engine.createCrew(stage,cast);engine.applyCrew(crew,[{key,identity:key,state:'working',stale:false}],{snap:true});if(engine.crewFigures(crew,0,{still:true})[0].y<100){id=key;break;}}
  assert.ok(id);
  const noon=Date.parse('2026-10-16T12:00:00Z');await view.clock.install({time:noon});await view.reload();await view.clock.pauseAt(noon+20000);
  const open=view.getByRole('button',{name:'Open Deck',exact:true}),canvas=view.locator('canvas[data-firstmate-deck]');
  for(let i=0;i<100&&!await open.isEnabled();i++){await view.clock.runFor(100);await view.waitForTimeout(50);}await open.click();
  for(let i=0;i<100&&!await canvas.count();i++){await view.clock.runFor(100);await view.waitForTimeout(50);}await canvas.waitFor();
  await view.evaluate(id=>window.changeFleet(f=>{const s=f.cards.find(c=>c.agent);f.cards=[{...s,key:id,taskId:id,title:id,column:'ready',note:null,remote:undefined,agent:{...s.agent,id,status:'finished',pendingPermissions:0}}];f.suggestions=[];}),id);
  const refresh=view.getByRole('button',{name:'Refresh',exact:true});await refresh.click();await view.clock.runFor(800);
  await view.emulateMedia({reducedMotion:'no-preference'});
  await view.evaluate(()=>window.changeFleet(f=>{f.cards[0].column='working';f.cards[0].agent.status='running';}));await refresh.click();await view.clock.runFor(5200);
  const samples=[];
  for(let pass=0;pass<3;pass++){
    const fit=await view.evaluate(m=>{const {fit}=window.drawOverlay(m);document.querySelector('[data-firstmate-deck-overlay]').remove();return fit;},manifest),b=await canvas.boundingBox();
    let target=null;
    for(let y=68;y<=218;y+=3){
      await view.mouse.move(b.x+fit.x+251*fit.scale,b.y+fit.y+y*fit.scale);await view.clock.runFor(34);
      const label=view.getByTestId('firstmate-deck-label');if(await label.count()&&(await label.textContent()).includes(id)){target={x:251,y};break;}
    }
    assert.ok(target,'moving sailor has a hover target above the deck');
    await canvas.screenshot({path:join(here,'review/after/transit-'+pass+'.png')});await view.mouse.click(b.x+fit.x+target.x*fit.scale,b.y+fit.y+target.y*fit.scale);
    const panel=view.getByTestId('firstmate-deck-focus');await panel.waitFor({state:'visible'});assert.equal(await panel.getAttribute('aria-label'),id+': details and actions');samples.push(target);
    await view.keyboard.press('Escape');await view.clock.runFor(1100);
  }
  assert.ok(new Set(samples.map(p=>p.y)).size>1,'the clicks follow changing heights');
  await writeFile(join(here,'review/after/transit.json'),JSON.stringify({id,samples,checked:'hover and click at three moving ladder heights; no renderer observer'},null,2)+'\n');
}
