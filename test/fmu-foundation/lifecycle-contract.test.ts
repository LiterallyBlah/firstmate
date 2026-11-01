import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { s04Fixture, captain } from "../supervision-s04-fixture";
import { activationEffects, supervisorSpend } from "../../server/supervisor-sessions";
const modulePath = "../../server/supervisor-controls";
const profile = { provider: "codex/gpt-6.1-sol", modeId: "full-access", thinkingOptionId: "high" };
const catalog = [{ ...profile, label: "Sol", modes: [{ id: "full-access", label: "Full" }], thinking: [{ id: "high", label: "High" }] }].map(({provider,label,modes,thinking})=>({provider,label,modes,thinking}));
async function fixture() {
  const fx = await s04Fixture(); const scope = await fx.addScope(1, "plan", ["build"], false);
  await fx.sessions.prepare({ requestId: randomUUID(), scopeId: scope.id, scopeVersion: 1, profile, opening: "Bounded work" }, captain);
  let s = await fx.store.read(); let e = activationEffects(s, scope.id, 1);
  await fx.gateway.dispatch(e.workspace!.id); await fx.gateway.dispatch(e.create!.id); await fx.sessions.verify(scope.id,1); await fx.gateway.dispatch(e.send!.id);
  const { SupervisorControls } = await import(modulePath);
  const controls = new SupervisorControls(fx.store, fx.sessions, fx.gateway, fx.receiver, { enabled: true, catalog: async()=>catalog, validate: async()=>{} });
  return { ...fx, scope, controls };
}
describe("frozen foundation lifecycle contract (A1/A2/A3/A5/A10/A12)", {timeout:60000}, () => {
 it("reads inertly, stages one immutable pending change and holds new turns without changing attribution", async()=>{
  const fx=await fixture(); const before=await fx.store.read(); const view=fx.controls.read(before,fx.scope.id);
  expect(fx.controls.read(before,fx.scope.id)).toEqual(view); expect((await fx.store.read()).sequence).toBe(before.sequence);
  const input={requestId:randomUUID(),homeId:before.homeId,scopeId:fx.scope.id,expectedEpoch:1,bindingDigest:view.bindingDigest,profile,limits:{supervisorSessions:3,supervisorTurns:10},policyDigest:"a".repeat(64)};
  await fx.controls.stageFromUnverifiedUi(input); await fx.controls.stageFromUnverifiedUi(input);
  expect(fx.controls.read(await fx.store.read(),fx.scope.id).state).toBe("change-pending");
  expect((await fx.store.read()).bindings).toEqual(before.bindings);
  expect(supervisorSpend(await fx.store.read(),fx.scope.id)).toEqual(supervisorSpend(before,fx.scope.id));
  await expect(fx.sessions.reserveTurn({requestId:randomUUID(),scopeId:fx.scope.id,epoch:1,causation:"new",text:"new"},captain)).rejects.toMatchObject({code:"HELD"});
  await expect(fx.controls.stageFromUnverifiedUi({...input,profile:{...profile,thinkingOptionId:"low"}})).rejects.toMatchObject({code:"CONFLICT"});
 });
 it("pause preserves an active binding; resume cannot clear pending replacement or a suspect binding",async()=>{
  const fx=await fixture(); const s=await fx.store.read(); const view=fx.controls.read(s,fx.scope.id);
  const base={requestId:randomUUID(),homeId:s.homeId,scopeId:fx.scope.id,expectedEpoch:1,bindingDigest:view.bindingDigest};
  await fx.controls.pauseFromUnverifiedUi(base);
  expect((await fx.store.read()).bindings[0].state).toBe("active");
  const paused=fx.controls.read(await fx.store.read(),fx.scope.id);
  await fx.controls.resumeFromUnverifiedUi({...base,requestId:randomUUID(),expectedControlId:paused.controlId});
  expect(fx.controls.read(await fx.store.read(),fx.scope.id).state).toBe("active");
  await fx.sessions.hold({requestId:randomUUID(),scopeId:fx.scope.id,expectedEpoch:1,reason:"Transfer"},captain);
  await expect(fx.controls.resumeFromUnverifiedUi({...base,requestId:randomUUID(),expectedControlId:paused.controlId})).rejects.toBeTruthy();
 });
});
