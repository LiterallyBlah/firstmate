/** Timed real-renderer audit: observe Pixi's live sprites, not just whole-canvas pixel changes. */
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {decodePng} from '../../../test/png.ts';
import {nearest,encode} from './build-art.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
const require=createRequire(join(root,'.generated/motion-tools/package.json'));
const {GIFEncoder,quantize,applyPalette}=require('gifenc');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function checkMotion(view,manifest){
  await view.setViewportSize({width:1440,height:900});
  await view.emulateMedia({reducedMotion:'reduce'});
  const noon=Date.parse('2026-10-14T12:00:00Z');
  await view.clock.install({time:noon});
  await view.reload();
  await view.clock.pauseAt(noon+20_000);
  for(let i=0;i<30&&!(await view.getByRole('button',{name:'Open Deck',exact:true}).isEnabled());i++){
    await view.clock.runFor(100);await view.waitForTimeout(50);
  }
  await view.getByRole('button',{name:'Open Deck',exact:true}).click();
  for(let i=0;i<100&&!(await view.locator('canvas[data-firstmate-deck]').count());i++){
    await view.clock.runFor(100);await view.waitForTimeout(50);
  }
  await view.waitForSelector('canvas[data-firstmate-deck]');
  await view.clock.runFor(400);
  const canvas=view.locator('canvas[data-firstmate-deck]');
  assert.equal(await canvas.getAttribute('data-firstmate-deck-setting'),'japanese-ship');
  await view.evaluate(()=>window.changeFleet(f=>{
    const source=f.cards.find(c=>c.agent!==null&&c.agent.status!=='closed');
    f.cards=['working','ready','blocked','idle','idle','idle','idle','idle','idle'].map((column,i)=>({...structuredClone(source),key:'motion-'+i,title:'Motion sailor '+i,taskId:'motion-'+i,column,note:null,agent:{...structuredClone(source.agent),id:'motion-'+i,status:column==='working'?'running':'finished',pendingPermissions:column==='blocked'?1:0}}));
    f.suggestions=[];
  }));
  await view.getByRole('button',{name:'Refresh',exact:true}).click();
  await view.clock.runFor(400);
  await view.mouse.move(1,899);
  const fit=await view.evaluate(m=>{const {fit}=window.drawOverlay(m);document.querySelector('[data-firstmate-deck-overlay]').remove();return fit;},manifest);
  const box=await canvas.boundingBox();
  const clip=(x,y,w,h)=>({x:box.x+fit.x+x*fit.scale,y:box.y+fit.y+y*fit.scale,width:w*fit.scale,height:h*fit.scale});
  const inspect=()=>view.evaluate(()=>{
    const all=[];const walk=n=>{all.push(n);for(const child of n.children??[])walk(child);};walk(window.motionReviewApp.stage);
    const get=label=>all.find(n=>n.label===label);
    const tex=n=>n?.texture?`${n.texture.source.uid}:${n.texture.frame.x},${n.texture.frame.y},${n.texture.frame.width},${n.texture.frame.height}`:null;
    return {sail:tex(get('sail')),mastX:get('masthead').x,bob:get('ship').y,
      clouds:get('clouds').children.map(c=>[c.x,c.y]),wake:tex(get('turning-wake')),
      shark:{frame:tex(get('attention-carrier').children[0]),x:get('attention-carrier').x,y:get('attention-carrier').y},
      crew:['motion-0','motion-1','motion-2'].map(id=>tex(get(id)?.children[1])),
      doze:all.filter(n=>n.label==='doze').map(n=>[n.visible,n.x,n.y,n.alpha])};
  });
  const stillA=await canvas.screenshot(),stillState=await inspect();
  await view.clock.runFor(2400);
  assert.equal(sha(await canvas.screenshot()),sha(stillA),'reduced-motion pixels stay still');
  assert.deepEqual(await inspect(),stillState,'every observed reduced-motion element stays still');
  await view.emulateMedia({reducedMotion:'no-preference'});
  await view.clock.runFor(250);
  const mode=await canvas.getAttribute('data-firstmate-deck-motion');
  assert.ok(['full','lite'].includes(mode));
  const frames=[],sails=[],samples=[],sailHashes=new Map();
  for(let i=0;i<32;i++){
    await view.clock.runFor(250);
    const state=await inspect();samples.push({ms:(i+1)*250,...state});
    // Follow only the stage bob for this crop. Texture motion must remain after that translation is removed.
    const proof=await view.screenshot({clip:clip(175,95+state.bob,130,75)});
    if(!sailHashes.has(state.sail)){
      const name=`sail-frame-${sailHashes.size}.png`;
      if(mode==='full')await writeFile(join(here,'review',name),await view.screenshot({clip:clip(128,25+state.bob,230,177)}));
      sailHashes.set(state.sail,sha(proof));
    }
    if(mode==='full'){
      const image=decodePng(await canvas.screenshot());frames.push(nearest(image,800,Math.round(image.height*800/image.width)));
      const sail=decodePng(await view.screenshot({clip:clip(128,25,230,177)}));sails.push(nearest(sail,460,354));
    }
  }
  const distinct=fn=>new Set(samples.map(s=>JSON.stringify(fn(s)))).size;
  assert.equal(distinct(s=>s.sail),2,'live sail visits BOTH texture frames');
  assert.equal(new Set(sailHashes.values()).size,2,'billow changes actual sail pixels after removing hull bob');
  assert.ok(distinct(s=>s.mastX)>1,'masthead/upper rigging sways independently');
  assert.ok(distinct(s=>s.bob)>1,'hull bobs');
  assert.equal(distinct(s=>s.shark.frame)>1,mode==='full','shark tail follows full/lite policy');
  assert.equal(distinct(s=>[s.shark.x,s.shark.y])>1,mode==='full','shark loiter follows full/lite policy');
  for(let i=0;i<3;i++)assert.ok(distinct(s=>s.crew[i])>1,`crew state ${i} fidgets`);
  assert.ok(distinct(s=>s.doze)>1,'sleeper Zs drift/fade');
  assert.equal(distinct(s=>s.clouds)>1,mode==='full','cloud motion follows full/lite policy');
  assert.equal(distinct(s=>s.wake)>1,mode==='full','wake motion follows full/lite policy');
  if(mode==='full'){
    const gif=async(name,images)=>{
      const all=Buffer.concat(images.map(a=>a.rgba)),palette=quantize(all,256),out=GIFEncoder();
      for(const a of images)out.writeFrame(applyPalette(a.rgba,palette),a.width,a.height,{palette,delay:250,repeat:0});
      out.finish();await writeFile(join(here,'review',name),out.bytes());
    };
    await gif('day-motion.gif',frames);await gif('sail-motion.gif',sails);
  }
  const result={mode,durationMs:8000,frameStepMs:250,sail:{textureFrames:distinct(s=>s.sail),bobCompensatedPixelHashes:[...sailHashes.values()]},
    checks:['reduced-motion pixels and observed sprites stable','two real sail textures and two bob-compensated sail pixel hashes','mast/upper-rig sway','hull bob','full-only cloud drift and wake cycling','working/waiting/blocked fidgets','full-only shark swim cycle and loiter','sleeper Z drift/fade'],samples};
  await writeFile(join(here,`motion-${mode}.json`),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({mode,checks:result.checks,sail:result.sail}));
}
