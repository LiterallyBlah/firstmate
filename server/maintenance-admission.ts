/** Explicit captain-app admission only. Reuses S04 reservation, receiver, verification and gateway.
 * No Attach, helper, automatic provisioning, replacement or uncertain-send replay. */
import type { z } from "zod";
import type { SupervisionStatus } from "../shared/supervision";
import type { GatewayReceiver } from "../shared/supervision-effects";
import { MaintenanceAdmissionInputSchema } from "../shared/supervision-policy";
import { AdmitMaintenanceSchema, type AdmitMaintenance } from "../shared/maintenance-runtime";
import type { SupervisionRuntime } from "./supervision-runtime";
import { SupervisionCommands } from "./supervision-commands";
import { SupervisionGateway, stableId, expectedFor } from "./supervision-effects";
import { SupervisorSessions, activationEffects } from "./supervisor-sessions";
import { checkGeneralHeadroom, withScopeAdmission } from "./supervision-headroom";
import { digest } from "./submissions";
import { serialized } from "./serialize";
import { refuse } from "./supervision-resources";

const UI = { kind: "plugin-ui-unverified" as const, id: "unauthenticated-plugin-call", source: "maintenance admission button (unverified)" };
const result = { planId: null, planHash: null, decisionId: null, outboxId: null };
export function maintenanceAdmission(status: SupervisionStatus, scopeId: string) {
  return status.commands.find(c => c.result.maintenanceAdmission?.scopeId === scopeId && c.id === stableId("maintenance-admission-input", c.result.maintenanceAdmission.requestId) &&
    c.inputHash === digest(c.result.maintenanceAdmission) && digest(c.actor) === digest(UI))?.result.maintenanceAdmission ?? null;
}
export async function admitMaintenanceOwner(runtime: SupervisionRuntime, raw: AdmitMaintenance, receiver: GatewayReceiver,
  checked: (homeId: string) => Promise<{ home: string; config: { mateAgentId: string } }>, headroom: { slots: number; reserved: number }) {
  const request = AdmitMaintenanceSchema.parse(raw), { home, config } = await checked(request.homeId);
  if (!config.mateAgentId) refuse("UNKNOWN_OWNER", "A configured General is required; maintenance never adopts that identity.");
  const initial = await runtime.read(home);
  const retained = initial.commands.find(c => c.id === stableId("maintenance-admission-input", request.requestId))?.result.maintenanceAdmission;
  const input: z.infer<typeof MaintenanceAdmissionInputSchema> = "resume" in request ? retained ?? refuse("UNKNOWN_OWNER", "No recorded maintenance admission has this request ID.") : request;
  if (input.homeId !== request.homeId) refuse("STALE", "Recorded maintenance home differs from this request.");
  return serialized(`${runtime.root}:maintenance-admission:${input.homeId}:${input.scopeId}`, () => runtime.mutate(home, async store => {
    if ((await store.read()).problems.includes("Final transaction awaits publication.")) await store.recoverPublication();
    await store.enableLongLived();
    const fresh = async (status: SupervisionStatus) => {
      const current = await checked(input.homeId);
      if (current.config.mateAgentId !== config.mateAgentId) refuse("STALE", "General changed during maintenance admission.");
      const saved = maintenanceAdmission(status, input.scopeId), scope = status.scopes.find(s => s.id === input.scopeId);
      if (!saved || digest(saved) !== digest(input) || scope?.kind !== "maintenance" || scope.mode !== "scoped" || ["held", "retired"].includes(scope.state))
        refuse("HELD", "The exact maintenance admission changed or its scope is held.");
    };
    await checked(input.homeId);
    await store.transactCommand(stableId("maintenance-admission-input", input.requestId), digest(input), UI, async status => {
      await checked(input.homeId);
      if (status.scopes.some(s => s.id === input.scopeId) || maintenanceAdmission(status, input.scopeId))
        refuse("CONFLICT", "Maintenance scope already exists; resume its original recorded request. No identity is replaced.");
      const mutations = [{ kind: "scope" as const, value: { id: input.scopeId, homeId: store.homeId, kind: "maintenance" as const,
        mode: "scoped" as const, state: "dormant" as const, version: 1, projectIds: [], sponsorId: null } }];
      return { mutations, expectedVersions: expectedFor(status, mutations), result: { ...result, maintenanceAdmission: input } };
    });
    let status = await store.read(); await fresh(status);
    const binding = status.bindings.find(b => b.scopeId === input.scopeId);
    const gateway = new SupervisionGateway(store, new SupervisionCommands(store, home, { enabled: true }), home, receiver, { enabled: true, policyFence: runtime.features?.gateway(home, "maintenance", () => store.read()),
      admissionCheck: async (current, effect) => {
        await fresh(current);
        const capacity = await runtime.features?.capacity(home);
        if (capacity) await checkGeneralHeadroom(current, receiver, capacity.slots, capacity.generalHeadroom, effect.id);
        const b = current.bindings.find(b => b.scopeId === input.scopeId), effects = b && activationEffects(current, input.scopeId, b.epoch);
        if (effect.requestId !== input.requestId || effect.scopeId !== input.scopeId || !effects || ![effects.workspace?.id, effects.create?.id, effects.send?.id].includes(effect.id))
          refuse("HELD", "Only the original maintenance admission effects may run here.");
      } });
    const sessions = new SupervisorSessions(store, gateway, receiver, { enabled: true,
        featurePolicy: async () => runtime.features?.reservation(home, "maintenance"),
        reserveBoundary: run => runtime.features ? runtime.features.boundary(home, run) : run(), limits: input.limits,
      globalMateId: async () => (await checked(input.homeId)).config.mateAgentId, reserveCheck: fresh });
    if (!binding) await withScopeAdmission(input.homeId, async () => {
      await fresh(await store.read()); await checkGeneralHeadroom(await store.read(), receiver, headroom.slots, headroom.reserved);
      const opening = `You own maintenance scope ${input.scopeId} (${input.name}). FirstMate home: ${home}. Read ${home}/data/maintenance.md. Transport: node "${home}/tools/maintenance.mjs" read, or command --file data/<request>.json --request-id <uuid>; write the strict command JSON under the FirstMate home. Your actual PASEO_AGENT_ID records owner provenance; never override it. Observe mode only. Healthy/unchanged results wake nobody. Acknowledge only exact delivered incident generations. Use escalate for genuine budget/authority choices; routine incidents are not captain decisions. Captain answers are instructions, never a budget grant, cleanup, provisioning, Attach, worker, merge or deployment authority. Corrective work requires the checked plan runtime and all seven plan rules. Session/turn reservations retain spend on failure or uncertainty. Limits: ${JSON.stringify(input.limits)}.`;
      await sessions.prepare({ requestId: input.requestId, scopeId: input.scopeId, scopeVersion: (await store.read()).scopes.find(s => s.id === input.scopeId)!.version,
        profile: input.profile, purpose: "work", opening }, UI);
    });
    status = await store.read(); const current = status.bindings.find(b => b.scopeId === input.scopeId)!;
    const effects = activationEffects(status, input.scopeId, current.epoch);
    for (const effect of [effects.workspace, effects.create]) {
      if (!effect || effect.requestId !== input.requestId) refuse("HELD", "Retain the original maintenance effects; no fresh allocation.");
      if (effect.state === "succeeded") continue;
      const next = ["dispatching", "uncertain", "accepted"].includes(effect.state) ? await gateway.reconcile(effect.id) : await gateway.dispatch(effect.id);
      if (next.state !== "succeeded") return;
    }
    await fresh(await store.read());
    if (current.state === "prepared") await sessions.verify(input.scopeId, current.epoch);
    if (effects.send?.state === "reserved") await gateway.dispatch(effects.send.id);
  }, true));
}
