/** Real canvas captures via the existing fixture host. No Pixi observer or renderer patch. */
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const here=dirname(fileURLToPath(import.meta.url));
export async function checkParity(view,manifest){
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
  await view.getByRole('button',{name:'Refresh',exact:true}).click();await view.clock.runFor(90000);await shot('storm');
  await view.emulateMedia({reducedMotion:'reduce'});
  for(const [name,time] of [['dusk','18:30'],['night','23:00']]){await view.clock.setFixedTime(new Date('2026-10-16T'+time+':00Z'));await view.clock.runFor(61000);await shot(name);}
  await writeFile(join(out,'capture.json'),JSON.stringify({phase,setting:manifest.id,mode:await canvas.getAttribute('data-firstmate-deck-motion'),observer:'canvas PNGs and public DOM attributes only'},null,2)+'\n');
}
