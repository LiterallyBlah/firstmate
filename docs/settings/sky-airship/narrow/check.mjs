import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
export async function review(browser, origin) {
  const version = process.env.ASPECT_REVIEW ?? 'after', out = resolve(here, version);
  mkdirSync(out, {recursive:true});
  const results = [], errors = [];
  const manifest = (await (await fetch(origin+'/rpc/branch/firstmate.deck.setting', {method:'POST', body:JSON.stringify({id:'sky-airship'})})).json()).manifest;
  for (const [aspect, width, height] of [['wide',1440,900], ['square',1000,1000], ['tall',900,1400], ['very-tall',650,1900]]) {
    const context = await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce',timezoneId:'UTC'});
    const view = await context.newPage();
    view.on('pageerror', e => errors.push(e.message));
    const noon = Date.parse('2026-10-16T12:00:00Z');
    await view.clock.install({time:noon});
    await view.goto(origin+'/?tree=branch&theme=dark&working=3&setting=sky-airship');
    await view.getByRole('button',{name:'Open Deck',exact:true}).waitFor();
    await view.clock.pauseAt(noon+20000);
    await view.getByRole('button',{name:'Open Deck',exact:true}).click();
    const canvas = view.locator('canvas[data-firstmate-deck]');
    for(let i=0;i<100 && !(await canvas.count());i++){await view.clock.runFor(100);await view.waitForTimeout(50);}
    assert.equal(await canvas.count(),1);
    await view.clock.runFor(500); await view.waitForTimeout(300);
    assert.equal(await canvas.getAttribute('data-firstmate-deck-setting'),'sky-airship');
    const fit = await view.evaluate(m => {const r=window.drawOverlay(m);document.querySelector('[data-firstmate-deck-overlay]').remove();return r.fit;}, manifest);
    const box = await canvas.boundingBox();
    const shot = async phase => {
      await view.mouse.move(0,0);
      await canvas.screenshot({path:resolve(out,aspect+'-'+phase+'.png')});
      results.push({aspect,phase,viewport:{width,height},canvas:box,fit,visibleBottom:(box.height-fit.y)/fit.scale,mode:await canvas.getAttribute('data-firstmate-deck-motion'),weather:await canvas.getAttribute('data-firstmate-deck-weather')});
    };
    await shot('day');
    await view.clock.setSystemTime(new Date('2026-10-16T23:00:00Z')); await view.clock.fastForward(61000);
    assert.equal(await canvas.getAttribute('data-firstmate-deck-sky'),'night'); await shot('night');
    await view.clock.setSystemTime(new Date('2026-10-17T12:00:00Z')); await view.clock.fastForward(61000);
    await view.evaluate(() => window.changeFleet(f => {const source=f.cards.find(c=>c.agent&&c.agent.status!=='closed');f.cards=Array.from({length:12},(_,i)=>({...structuredClone(source),key:'Storm '+i,taskId:'Storm '+i,column:'working',agent:{...structuredClone(source.agent),id:'Storm '+i,status:'running',pendingPermissions:0}}));}));
    await view.getByRole('button',{name:'Refresh',exact:true}).click(); await view.clock.runFor(1000); await view.waitForTimeout(100);
    await view.emulateMedia({reducedMotion:'no-preference'}); await view.clock.runFor(18000);
    assert.ok(Number(await canvas.getAttribute('data-firstmate-deck-weather'))>.95);
    await shot('storm'); await context.close();
  }
  assert.deepEqual(errors,[]);
  writeFileSync(resolve(out,'results.json'),JSON.stringify({results,errors},null,2)+'\n');
  console.log(JSON.stringify({version,captures:results.length,errors}));
}
