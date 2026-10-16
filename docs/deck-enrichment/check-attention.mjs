/** Real compiled client and art: the shark focuses its worker while the same deck stays mounted. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here=join(dirname(fileURLToPath(import.meta.url)),'../deck-fixes');
export async function checkAttention(view, manifest) {
  const carrier=manifest.attentionCarrier;
  assert.ok(carrier);
  const canvas=view.locator('canvas[data-firstmate-deck]');
  const panel=view.getByTestId('firstmate-deck-focus');
  const target=view.getByTestId('firstmate-deck-attention');
  const initialUrl=view.url();
  await canvas.evaluate(node=>{window.sharkOriginalCanvas=node;});
  const sameDeck=async()=>{
    assert.equal(view.url(),initialUrl);
    assert.equal(await canvas.count(),1);
    assert.ok(await canvas.evaluate(node=>node===window.sharkOriginalCanvas),'the same canvas stays mounted');
    assert.equal(await view.getByRole('complementary',{name:/Conversation with/}).count(),0);
  };
  const refresh=async()=>{await view.getByRole('button',{name:'Refresh',exact:true}).click();await view.waitForTimeout(350);};
  await view.evaluate(()=>window.changeFleet(fleet=>{
    const local=structuredClone(fleet.cards.find(c=>c.agent!==null&&c.agent.status!=='closed'));
    const remote=structuredClone(fleet.cards.find(c=>c.remote?.worker&&!c.remote.worker.followed&&c.remote.online));
    local.key='attention-a';local.taskId='attention-a';local.title='Local response worker';local.column='blocked';local.agent.pendingPermissions=1;
    remote.key='attention-b';remote.taskId='attention-b';remote.title='Remote response worker';remote.column='idle';remote.remote.worker.pendingPermissions=1;
    const reply=structuredClone(local);reply.key='attention-c';reply.taskId='attention-c';reply.title='Suggested response worker';reply.column='idle';reply.agent.id='reply-worker';reply.agent.pendingPermissions=0;
    fleet.cards=[local,remote,reply];fleet.suggestions=[{label:'Discuss attention-c',prompt:'Discuss attention-c with the captain.'}];
  }));
  await refresh();
  await target.getByText('3 need your response').waitFor();
  await view.waitForTimeout(manifest.portals.still.fadeMs);
  const capture=async name=>{await view.mouse.move(5,5);await view.screenshot({path:join(here,`shark-${name}.png`)});};
  const box=await canvas.boundingBox();
  // Left of the card: the pixels prove that the scene itself zoomed, not just that a panel appeared.
  const sceneShot=()=>view.screenshot({clip:{...box,width:600}});
  await capture('still');
  const whole=await sceneShot();
  const click=async(x,y)=>{
    const fit=await view.evaluate(manifest=>{const {fit}=window.drawOverlay(manifest);document.querySelector('[data-firstmate-deck-overlay]').remove();return fit;},manifest);
    await view.mouse.click(box.x+fit.x+(carrier.at[0]+x)*fit.scale,box.y+fit.y+(carrier.at[1]+y)*fit.scale);
  };
  const focused=async title=>{
    await panel.waitFor({state:'visible'});
    assert.equal(await panel.getAttribute('aria-label'),`${title}: details and actions`);
    await sameDeck();
    await view.waitForTimeout(350);
  };
  const close=async(button=false)=>{
    if(button)await panel.getByRole('button',{name:'Close',exact:true}).click();
    else await view.keyboard.press('Escape');
    await panel.waitFor({state:'hidden'});
    await view.mouse.move(5,5);await view.waitForTimeout(350);await sameDeck();
  };
  await click(38,34);
  await focused('Local response worker');await capture('local-focus');
  const localFocus=await sceneShot();
  assert.ok(!localFocus.equals(whole),'the camera changes the scene beside the panel');
  await close();
  assert.ok((await sceneShot()).equals(whole),'Escape restores the whole scene');
  // The ordinary keyboard focus path returns to this same worker, with identical camera pixels.
  await canvas.evaluate(node=>node.parentElement.focus());await view.keyboard.press('Enter');
  await focused('Local response worker');await view.mouse.move(5,5);
  assert.ok((await sceneShot()).equals(localFocus),'shark and ordinary crew focus have the same camera');
  await close(true);
  await target.getByRole('button',{name:'Next worker needing a response',exact:true}).click();
  await target.getByRole('button',{name:'Focus on Remote response worker',exact:true}).waitFor();
  await click(32,10);
  await focused('Remote response worker');await capture('remote-focus');await close();
  for(let i=0;i<2;i++)await target.getByRole('button',{name:'Next worker needing a response',exact:true}).click();
  const suggested=target.getByRole('button',{name:'Focus on Suggested response worker',exact:true});
  await suggested.focus();await view.keyboard.press('Enter');
  await focused('Suggested response worker');await capture('keyboard-focus');await close();
  // Clicking while the carrier is moving still focuses its selected worker in this scene.
  await view.emulateMedia({reducedMotion:'no-preference'});
  await click(38,34);await focused('Suggested response worker');
  await view.waitForTimeout(900);await capture('moving-focus');await close();
  await view.emulateMedia({reducedMotion:'reduce'});
  // An insertion does not steal selection, and an unreachable remote loses its signal.
  await target.getByRole('button',{name:'Next worker needing a response',exact:true}).click();
  await view.evaluate(()=>window.changeFleet(fleet=>{const c=structuredClone(fleet.cards[0]);c.key='attention-0';c.title='Earlier request';fleet.cards.unshift(c);}));
  await refresh();
  await target.getByRole('button',{name:'Focus on Remote response worker',exact:true}).waitFor();
  await view.evaluate(()=>window.changeFleet(fleet=>{fleet.cards.find(c=>c.key==='attention-b').remote.online=false;}));
  await refresh();
  assert.equal(await target.getByRole('button',{name:'Focus on Remote response worker',exact:true}).count(),0);
  await view.evaluate(()=>{window.fixtureFleetError=true;});await refresh();
  assert.equal(await target.count(),0);await click(38,34);assert.equal(await panel.count(),0);await sameDeck();
  await view.evaluate(()=>{window.fixtureFleetError=false;});await refresh();
  await target.getByRole('button',{name:'Focus on Earlier request',exact:true}).click();
  await focused('Earlier request');
  await view.evaluate(()=>window.changeFleet(fleet=>{fleet.cards.find(c=>c.key==='attention-0').agent.status='closed';}));
  await refresh();await panel.waitFor({state:'hidden'});
  assert.equal(await target.getByRole('button',{name:'Focus on Earlier request',exact:true}).count(),0);
  await view.evaluate(()=>window.changeFleet(fleet=>{fleet.cards=[];fleet.suggestions=[];}));
  await refresh();
  assert.equal(await target.count(),0);await click(38,34);assert.equal(await panel.count(),0);await sameDeck();
  const calls=await view.evaluate(()=>window.fixtureCalls);
  assert.equal(calls.filter(call=>/\.send$|\.steer$|\.respond$/.test(call.name)).length,0,'focus never sends a message');
  assert.equal(calls.filter(call=>call.name==='firstmate.remote-crew.logs').length,0,'remote focus does not open Converse');
  assert.deepEqual(await view.evaluate(()=>window.fixtureErrors),[]);
  const result={checks:['body focuses local worker in place','camera pixels match ordinary crew focus','Escape and Close restore the whole deck','bubble focuses remote worker in place','keyboard focuses suggested worker in place','moving shark focuses selected worker','same canvas mounted throughout; no navigation or Converse','insertion preserves selection','unreachable remote loses its signal','stale feed cannot focus a shark target','closed worker loses focus and signal','removal leaves no clickable ghost','no messages sent or remote conversation logs fetched','no browser errors'],errors:[]};
  await writeFile(join(here,'shark-interactions.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}
