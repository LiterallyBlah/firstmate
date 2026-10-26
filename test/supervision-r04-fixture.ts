/** R04's independent recovery setup, ported from the frozen reviewer probe. Synthetic only. */
import { randomUUID } from "node:crypto";
import { captain, s04Fixture } from "./supervision-s04-fixture";
import { activationEffects } from "../server/supervisor-sessions";
import { SupervisionEvents } from "../server/supervision-events";
import { SupervisionInbox } from "../server/supervision-inbox";
import { SupervisionLifecycle } from "../server/supervision-lifecycle";

export const r04Profile = { provider: "codex/gpt-6.1-sol", modeId: "full-access", thinkingOptionId: "high" };
export async function r04Fixture(observationTimeoutMs = 30_000) {
  const f = await s04Fixture(), ingress = new SupervisionEvents(f.store), inbox = new SupervisionInbox(f.store, { offers: true });
  const lifecycle = new SupervisionLifecycle(f.store, ingress, inbox, f.sessions, f.gateway, { enabled: true, observationTimeoutMs });
  async function activate(scopeId: string, epoch: number) {
    const effects = activationEffects(await f.store.read(), scopeId, epoch);
    await f.gateway.dispatch(effects.workspace!.id); await f.gateway.dispatch(effects.create!.id);
    const binding = await f.sessions.verify(scopeId, epoch);
    await f.gateway.dispatch(effects.send!.id); f.receiver.finish(binding.agentId);
    return binding;
  }
  async function owner(n: number) {
    const scope = await f.addScope(n, `goal-${n}`, [`work-${n}`], false);
    await f.sessions.prepare({ requestId: randomUUID(), scopeId: scope.id, scopeVersion: 1, profile: r04Profile, opening: "Read the exact scope checkpoint." }, captain);
    const binding = await activate(scope.id, 1);
    await f.draft(scope, [{ id: `work-${n}` }], true);
    return { scope, binding };
  }
  return { ...f, ingress, inbox, lifecycle, owner, activate };
}
