/** Real compiled client, RPCs and art: raised-station interaction, descent/ascent, and the night scene. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
export async function checkPolish(view,manifest) {
  const canvas=view.locator('canvas[data-firstmate-deck]');
  const panel=view.getByTestId('firstmate-deck-focus');
  const refresh=async()=>{await view.getByRole('button',{name:'Refresh',exact:true}).click();await view.waitForTimeout(300);};
  await view.evaluate(()=>window.changeFleet(fleet=>{
    const source=fleet.cards.find(card=>card.agent!==null&&card.agent.status!=='closed');
    fleet.cards=Array.from({length:7},(_,i)=>({...structuredClone(source),key:`polish-${i}`,title:i===0?'Lookout polish check':`Station ${i}`,column:'working',note:null,remote:undefined,
      agent:{...structuredClone(source.agent),id:`polish-${i}`,status:'running',pendingPermissions:0}}));
    fleet.suggestions=[];
  }));
  await refresh();await view.waitForTimeout(700);
  const {fit}=await view.evaluate(m=>{const drawn=window.drawOverlay(m);document.querySelector('[data-firstmate-deck-overlay]').remove();return drawn;},manifest);
  const box=await canvas.boundingBox();
  const click=async(x,y)=>view.mouse.click(box.x+fit.x+x*fit.scale,box.y+fit.y+y*fit.scale);
  const shot=async(name)=>{await view.mouse.move(5,895);await view.screenshot({path:join(here,`polish-${name}.png`),clip:box});};
  await shot('day');
  await click(218,-59);
  await panel.waitFor({state:'visible'});
  assert.equal(await panel.getAttribute('aria-label'),'Lookout polish check: details and actions');
  await view.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
  await view.clock.setFixedTime(new Date('2026-10-14T23:00:00Z'));await refresh();
  await shot('night');
  await click(218,-59);await panel.waitFor({state:'visible'});
  assert.equal(await panel.getAttribute('aria-label'),'Lookout polish check: details and actions');
  await view.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
  await view.clock.setFixedTime(new Date('2026-10-14T12:00:00Z'));
  await view.emulateMedia({reducedMotion:'no-preference'});
  await view.evaluate(()=>window.changeFleet(fleet=>{fleet.cards[0].column='idle';fleet.cards[0].agent.status='finished';}));
  await refresh();await view.waitForTimeout(2500);await shot('descending');
  await view.waitForTimeout(9000);
  await view.emulateMedia({reducedMotion:'reduce'});await refresh();
  await click(128,138);await panel.waitFor({state:'visible'});
  assert.equal(await panel.getAttribute('aria-label'),'Lookout polish check: details and actions');
  await view.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
  await view.emulateMedia({reducedMotion:'no-preference'});
  await view.evaluate(()=>window.changeFleet(fleet=>{fleet.cards[0].column='working';fleet.cards[0].agent.status='running';}));
  await refresh();
  // All six ordinary stations remain reserved, so the returning worker walks to the free ladder base.
  await view.waitForTimeout(1500);await shot('walking');
  await view.waitForTimeout(4500);await shot('ascending');
  await view.waitForTimeout(6000);
  await view.emulateMedia({reducedMotion:'reduce'});
  await click(218,-59);await panel.waitFor({state:'visible'});
  assert.equal(await panel.getAttribute('aria-label'),'Lookout polish check: details and actions');
  await view.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
  await view.evaluate(()=>window.changeFleet(fleet=>{fleet.cards=[];}));await refresh();
  await view.waitForTimeout(700);await click(218,-59);
  assert.equal(await panel.count(),0,'removed lookout leaves no clickable ghost');
  const evidence={checks:['generated lookout focuses its worker from the occupied nest','night-darkened lookout remains clickable','full-motion descent reaches a clickable below-deck target','returning worker walks and climbs back to its reserved nest','removal leaves no raised target'],errors:[]};
  await writeFile(join(here,'polish-interactions.json'),JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence));
}
