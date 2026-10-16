import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {engine} from '../diagnose-crowd.mjs';
import {decodePng} from '../../../../test/png.ts';
import {crop,encode} from '../../japanese-ship/build-art.mjs';
const here=dirname(fileURLToPath(import.meta.url));
export async function review(browser,origin){
 const version=process.env.EDGE_REVIEW??'after',out=resolve(here,version);mkdirSync(out,{recursive:true});const results=[],errors=[];
 const manifest=(await(await fetch(origin+'/rpc/branch/firstmate.deck.setting',{method:'POST',body:JSON.stringify({id:'sky-airship'})})).json()).manifest;
 const stage=engine.compileStage(manifest),cast=engine.compileCast(manifest);
 for(const [aspect,width,height]of [['wide',1440,900],['tall',900,1400]]){
 console.log('viewport',aspect); const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce',timezoneId:'UTC'}),view=await context.newPage();view.on('pageerror',e=>errors.push(e.message));const noon=Date.parse('2026-10-16T12:00:00Z');await view.clock.install({time:noon});
 await view.goto(origin+'/?tree=branch&theme=dark&working=3&setting=sky-airship');await view.getByRole('button',{name:'Open Deck',exact:true}).waitFor();await view.clock.pauseAt(noon+20000);await view.getByRole('button',{name:'Open Deck',exact:true}).click();
 console.log('opened'); const canvas=view.locator('canvas[data-firstmate-deck]');for(let i=0;i<100 && !(await canvas.count());i++){await view.clock.runFor(100);await view.waitForTimeout(50);} assert.equal(await canvas.count(),1,JSON.stringify(errors));await view.clock.runFor(500);await view.waitForTimeout(300);
 const source=await view.evaluate(()=>window.fixtureFleet.cards.find(c=>c.agent&&c.agent.status!=='closed'));
 for(const [state,column,count]of [['blocked','blocked',3],['blocked','blocked',24],['working','working',24],['waiting','ready',24],['idle','idle',24]]){
 console.log(aspect,state,count); const workers=Array.from({length:count},(_,i)=>({key:'Crew '+i,identity:'Crew '+i,state,stale:false}));
 await view.evaluate(()=>window.changeFleet(f=>{f.cards=[];f.suggestions=[]}));await view.getByRole('button',{name:'Refresh',exact:true}).click();await view.clock.runFor(150);await view.waitForTimeout(150);await view.clock.runFor(1000);await view.waitForTimeout(100);
 const cards=workers.map(w=>({...structuredClone(source),key:w.key,taskId:w.key,title:w.key,column,note:null,remote:undefined,agent:{...structuredClone(source.agent),id:w.key,status:column==='working'?'running':'finished',pendingPermissions:column==='blocked'?1:0}}));
 await view.evaluate(cards=>window.changeFleet(f=>{f.cards=cards;f.suggestions=[]}),cards);await view.getByRole('button',{name:'Refresh',exact:true}).click();await view.clock.runFor(150);await view.waitForTimeout(150);await view.clock.runFor(900);await view.waitForTimeout(100);
 const crew=engine.createCrew(stage,cast);engine.applyCrew(crew,workers,{snap:true});const figures=engine.crewFigures(crew,0,{still:true});
 const fit=await view.evaluate(m=>{const r=window.drawOverlay(m);document.querySelector('[data-firstmate-deck-overlay]').remove();return r.fit},manifest),box=await canvas.boundingBox();
 const name=aspect+'-'+state+'-'+count;await view.mouse.move(0,0);const png=await canvas.screenshot();writeFileSync(resolve(out,name+'.png'),png);
 if(state==='blocked'){const a=decodePng(png);writeFileSync(resolve(out,name+'-bow.png'),encode(crop(a,Math.round(fit.x+45*fit.scale),Math.round(fit.y+182*fit.scale),Math.round(145*fit.scale),Math.round(72*fit.scale))));}
 await view.evaluate(m=>window.drawOverlay(m),manifest);await view.screenshot({path:resolve(out,name+'-overlay.png')});await view.evaluate(()=>document.querySelector('[data-firstmate-deck-overlay]').remove());
 const targets=figures.map(f=>{const b=engine.figureBox(f,cast);let point=null;for(let y=b.top+1;y<b.bottom&&!point;y++)for(let x=b.left+1;x<b.right;x++)if(engine.sailorAt(figures,cast,{x,y})?.key===f.key){point={x,y};break}return{key:f.key,x:f.x,y:f.y,point}});
 if(version==='after')for(const f of targets){
 assert.ok(f.point,'clickable '+state+' '+f.key);
 const label=view.getByTestId('firstmate-deck-label');let hit=null;
 const frame=await view.evaluate(m=>{const r=window.drawOverlay(m);document.querySelector('[data-firstmate-deck-overlay]').remove();return r.fit},manifest);
 const candidates=[{x:f.x,y:f.y-8},f.point];const figure=figures.find(x=>x.key===f.key),b=engine.figureBox(figure,cast);
 for(let y=b.top+2;y<b.bottom;y+=3)for(let x=b.left+2;x<b.right;x+=3)candidates.push({x,y});
 for(const p of candidates){await view.mouse.move(0,0);await view.waitForTimeout(100);assert.equal(await label.count(),0,'hover clears before target');const at={x:box.x+frame.x+p.x*frame.scale,y:box.y+frame.y+p.y*frame.scale};await view.mouse.move(at.x,at.y);await view.waitForTimeout(100);if(await label.count()&&(await label.innerText()).split('\n')[0]===f.key){hit=at;break}}
 assert.ok(hit,'visible hover '+state+' '+f.key);await view.mouse.click(hit.x,hit.y);const panel=view.getByTestId('firstmate-deck-focus');await panel.waitFor();await view.waitForTimeout(150);await view.clock.runFor(100);assert.equal(await panel.getAttribute('aria-label'),f.key+': details and actions',state+' '+f.key);console.log('clicked',aspect,state,f.key);await view.keyboard.press('Escape');await view.clock.runFor(400);await view.waitForTimeout(70);await view.clock.runFor(300);await panel.waitFor({state:'hidden'});
 }

 results.push({aspect,state,count,targets});
 }
 await context.close();
 }
 assert.deepEqual(errors,[]);writeFileSync(resolve(out,'results.json'),JSON.stringify({results,errors},null,2));console.log(JSON.stringify({version,captures:results.length,errors}));
}

