/** Real compiled client, pack RPC and art. Clicking a carrier opens the existing local/remote Converse. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
export async function checkAttention(view, manifest) {
  const carrier=manifest.attentionCarrier;
  assert.ok(carrier);
  const refresh=async()=>{await view.getByRole('button',{name:'Refresh',exact:true}).click();await view.waitForTimeout(350);};
  await view.evaluate(()=>window.changeFleet(fleet=>{
    const local=structuredClone(fleet.cards.find(c=>c.agent!==null&&c.agent.status!=='closed'));
    const remote=structuredClone(fleet.cards.find(c=>c.remote?.worker&&!c.remote.worker.followed&&c.remote.online));
    local.key='attention-a';local.taskId='attention-a';local.title='Local response worker';local.column='blocked';local.agent.pendingPermissions=1;
    remote.key='attention-b';remote.taskId='attention-b';remote.title='Remote response worker';remote.column='idle';remote.remote.worker.pendingPermissions=1;
    const reply=structuredClone(local);reply.key='attention-c';reply.taskId='attention-c';reply.title='Suggested response worker';reply.column='idle';reply.agent.id='reply-worker';reply.agent.pendingPermissions=0;
    fleet.cards=[local,remote,reply];fleet.suggestions=[{label:'Discuss attention-c',prompt:'Discuss attention-c with the captain.'}];
    window.attentionFixture=structuredClone(fleet);
  }));
  await refresh();
  const target=view.getByTestId('firstmate-deck-attention');
  await target.getByText('3 need your response').waitFor();
  await view.waitForTimeout(manifest.portals.still.fadeMs);
  const capture=async name=>{await view.mouse.move(5,5);await view.screenshot({path:join(here,name)});};
  await capture('reply-shark-still.png');
  const click=async (x,y)=>{
    const fit=await view.evaluate(manifest=>{const {fit}=window.drawOverlay(manifest);document.querySelector('[data-firstmate-deck-overlay]').remove();return fit;},manifest);
    const box=await view.locator('canvas[data-firstmate-deck]').boundingBox();
    await view.mouse.click(box.x+fit.x+(carrier.at[0]+x)*fit.scale,box.y+fit.y+(carrier.at[1]+y)*fit.scale);
  };
  const close=async()=>{await view.keyboard.press('Escape');await view.waitForSelector('canvas[data-firstmate-deck]');await view.waitForTimeout(350);};
  await click(38,34);
  await view.getByRole('complementary',{name:'Conversation with Local response worker',exact:true}).waitFor();
  await close();
  await target.getByRole('button',{name:'Next worker needing a response',exact:true}).click();
  await target.getByRole('button',{name:'Converse with Remote response worker',exact:true}).waitFor();
  await click(32,10);
  await view.getByRole('complementary',{name:'Conversation with Remote response worker',exact:true}).waitFor();
  await view.getByText(/permissions are answered on Light/).waitFor();
  await close();
  for(let i=0;i<2;i++)await target.getByRole('button',{name:'Next worker needing a response',exact:true}).click();
  const suggested=target.getByRole('button',{name:'Converse with Suggested response worker',exact:true});
  await suggested.focus();await view.keyboard.press('Enter');
  await view.getByRole('complementary',{name:'Conversation with Suggested response worker',exact:true}).waitFor();
  await close();
  // Every worker remains reachable without adding another shark; an insertion does not steal selection.
  await target.getByRole('button',{name:'Next worker needing a response',exact:true}).click();
  await view.evaluate(()=>window.changeFleet(fleet=>{const c=structuredClone(fleet.cards[0]);c.key='attention-0';c.title='Earlier request';fleet.cards.unshift(c);}));
  await refresh();
  await target.getByRole('button',{name:'Converse with Remote response worker',exact:true}).waitFor();
  await view.evaluate(()=>window.changeFleet(fleet=>{fleet.cards.find(c=>c.key==='attention-b').remote.online=false;}));
  await refresh();
  assert.equal(await target.getByRole('button',{name:'Converse with Remote response worker',exact:true}).count(),0);
  await view.evaluate(()=>window.changeFleet(fleet=>{fleet.cards=[];fleet.suggestions=[];}));
  await refresh();
  assert.equal(await target.count(),0);
  await click(38,34);
  assert.equal(await view.getByRole('complementary',{name:/Conversation with/}).count(),0);
  assert.equal(await view.getByTestId('firstmate-deck-focus').count(),0);
  // Office retains its existing worker marker/suggestion behavior and gets no carrier control.
  await view.evaluate(()=>window.changeFleet(fleet=>Object.assign(fleet,structuredClone(window.attentionFixture))));
  await refresh();
  await view.evaluate(()=>window.selectDeckSetting('office'));
  await view.waitForSelector('canvas[data-firstmate-deck-setting="office"]');
  assert.equal(await target.count(),0);
  await view.getByText('1 with a reply for you',{exact:true}).waitFor();
  const calls=await view.evaluate(()=>window.fixtureCalls);
  assert.equal(calls.filter(call=>/\.send$|\.steer$|\.respond$/.test(call.name)).length,0,'opening Converse never sends a message');
  assert.ok(calls.some(call=>call.name==='firstmate.remote-crew.logs'&&call.input.serverId==='sample-light'));
  assert.deepEqual(await view.evaluate(()=>window.fixtureErrors),[]);
  const result={checks:['shark body opens local Converse','speech bubble opens remote Converse with host-specific permission guidance','keyboard Converse opens the suggested worker','multiple requests selectable without overlap','insertion preserves selected identity','unreachable remote removed from selection','removed workers leave no clickable ghost','office selection has no carrier','no browser errors'],errors:[]};
  await writeFile(join(here,'reply-shark-interactions.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}
