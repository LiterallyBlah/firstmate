import { describe, expect, it } from "vitest";

import { FirstmateConfigSchema } from "../shared/fleet";
import type { PaseoApi } from "./host-types";
import { deliverToMate } from "./watch-service";

/** A Paseo whose first mate is in `status`, recording what is sent to it. */
function paseoWith(status: string) {
  const sent: Array<{ text: string; options: unknown }> = [];
  const paseo = {
    agents: {
      ref: (id: string) => ({
        refresh: async () => ({ agent: { id, status, archivedAt: null } }),
        send: async (text: string, options: unknown) => {
          sent.push({ text, options });
        },
      }),
    },
  } as unknown as PaseoApi;
  return { paseo, sent };
}

const config = FirstmateConfigSchema.parse({ mateAgentId: "mate-1" });

describe("deliverToMate", () => {
  it("waits while an opening has an uncertain delivery", async () => {
    const { paseo, sent } = paseoWith("idle");
    const pending = FirstmateConfigSchema.parse({ mateAgentId: "mate-1", mateLaunch: {
      agentId: "mate-1", home: "/home", target: { provider: "claude" }, prompt: "opening", state: "sending",
    } });
    expect(await deliverToMate(paseo, pending, "watch note")).toBe("wait");
    expect(sent).toEqual([]);
  });
  it("never sends into a running turn, however it came to be asked", async () => {
    for (const status of ["running", "initializing"]) {
      const { paseo, sent } = paseoWith(status);
      expect(await deliverToMate(paseo, config, "note")).toBe("wait");
      expect(sent).toEqual([]);
    }
  });

  it("sends to an idle first mate without interrupting, and waits without one or without Paseo", async () => {
    const { paseo, sent } = paseoWith("idle");
    expect(await deliverToMate(paseo, config, "note")).toBe("sent");
    expect(sent).toEqual([
      { text: "note", options: { activeTurnBehavior: "steer", messageId: expect.stringMatching(/^firstmate-watch-[0-9a-f-]{36}$/) } },
    ]);
    expect(await deliverToMate(paseo, FirstmateConfigSchema.parse({}), "note")).toBe("wait");
    expect(await deliverToMate(null, config, "note")).toBe("wait");
  });
});

describe("watchPolicyEnv", () => {
  it("follows the saved Supervisors setting over the daemon's plan switch, and is off when policy can't be read", async () => {
    const { randomUUID } = await import("node:crypto"), { join } = await import("node:path");
    const { FeaturePolicyRuntime, installFeaturePolicy } = await import("./feature-policy-runtime");
    const { legacyFeatureSettings } = await import("./feature-settings");
    const { DEFAULT_FEATURE_CAPACITY } = await import("../shared/feature-settings");
    const { watchPolicyEnv } = await import("./watch-service");
    const root = join(process.env.PASEO_HOME!, randomUUID()), home = join(root, "home");
    const policy = new FeaturePolicyRuntime(root, legacyFeatureSettings(home, { FIRSTMATE_PLAN_SUPERVISORS: "1" }));
    const uninstall = installFeaturePolicy(policy);
    try {
      expect(await watchPolicyEnv(home)).toEqual({ FIRSTMATE_SUPERVISORS: "1" });
      await policy.set({ home, expectedRevision: 0, requestId: randomUUID(), change: { supervisors: false, capacity: { ...DEFAULT_FEATURE_CAPACITY } } });
      expect(await watchPolicyEnv(home)).toEqual({ FIRSTMATE_SUPERVISORS: "0" });
      await policy.set({ home, expectedRevision: 1, requestId: randomUUID(), change: { supervisors: true, capacity: { ...DEFAULT_FEATURE_CAPACITY } } });
      expect(await watchPolicyEnv(home)).toEqual({ FIRSTMATE_SUPERVISORS: "1" });
      expect(await watchPolicyEnv("relative-home")).toEqual({ FIRSTMATE_SUPERVISORS: "0" });
    } finally { uninstall(); }
  });
});
