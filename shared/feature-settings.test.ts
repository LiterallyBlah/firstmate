import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { DEFAULT_FEATURE_CAPACITY, FEATURES_OFF, FeatureCapabilitiesSchema, FeatureCapacitySchema, FeatureSetInputSchema,
  FeaturePolicySchema, LegacyFeatureSetInputSchema, policyRequested, readFeatureSettings, setFeatureSettings, supervisorCapabilities,
  supervisorsSetting } from "./feature-settings";

it("saves one Supervisors boolean and an exact reviewed change, without actor, display authority or separate fences", () => {
  const input = { home: "/home/firstmate", expectedRevision: 0, requestId: randomUUID(),
    change: { supervisors: false, capacity: { ...DEFAULT_FEATURE_CAPACITY } } };
  expect(FeatureSetInputSchema.parse(input)).toEqual(input);
  expect(FeatureSetInputSchema.safeParse({ ...input, change: { ...input.change, supervisors: "1" } }).success).toBe(false);
  for (const extra of [{ actor: "captain" }, { role: "captain-ui" }, { display: { scopeUi: true } }, { authenticated: true }])
    expect(FeatureSetInputSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  expect(FeatureSetInputSchema.safeParse({ ...input, change: { ...input.change, strongCapabilities: true } }).success).toBe(false);
  // A new save can no longer pick fences one by one.
  expect(FeatureSetInputSchema.safeParse({ ...input, change: { requested: FEATURES_OFF, capacity: DEFAULT_FEATURE_CAPACITY } }).success).toBe(false);
  expect(FeatureSetInputSchema.safeParse({ ...input, change: { ...input.change, requested: FEATURES_OFF } }).success).toBe(false);
  expect(FeatureSetInputSchema.safeParse({ ...input, change: { capacity: DEFAULT_FEATURE_CAPACITY } }).success).toBe(false);
  expect(FeatureSetInputSchema.safeParse({ ...input, expectedRevision: -1 }).success).toBe(false);
});

it("still reads format 1's six independent booleans for replay, strictly", () => {
  const input = { home: "/home/firstmate", expectedRevision: 0, requestId: randomUUID(),
    change: { requested: { ...FEATURES_OFF }, capacity: { ...DEFAULT_FEATURE_CAPACITY } } };
  expect(LegacyFeatureSetInputSchema.parse(input)).toEqual(input);
  for (const key of Object.keys(FEATURES_OFF)) {
    const values = { ...FEATURES_OFF } as Record<string, unknown>; delete values[key];
    expect(FeatureCapabilitiesSchema.safeParse(values).success).toBe(false);
    values[key] = "1"; expect(FeatureCapabilitiesSchema.safeParse(values).success).toBe(false);
  }
  expect(LegacyFeatureSetInputSchema.safeParse({ ...input, change: { ...input.change, requested: { ...FEATURES_OFF, fullAccessConfinement: true } } }).success).toBe(false);
});

it("derives every fence from the one setting and names a partial pilot", () => {
  expect(supervisorCapabilities(true)).toEqual(Object.fromEntries(Object.keys(FEATURES_OFF).map(k => [k, true])));
  expect(supervisorCapabilities(false)).toEqual(FEATURES_OFF);
  expect(supervisorsSetting(supervisorCapabilities(true))).toBe("on");
  expect(supervisorsSetting(FEATURES_OFF)).toBe("off");
  expect(supervisorsSetting({ ...FEATURES_OFF, scopeUi: true })).toBe("partial");
});

it("keeps reviewed capacity bounded by safe integers and General's retained headroom", () => {
  for (const capacity of [{ slots: 1, generalHeadroom: 1 }, { slots: 4, generalHeadroom: 0 },
    { slots: 4, generalHeadroom: 4 }, { slots: 4.5, generalHeadroom: 1 },
    { slots: Number.MAX_SAFE_INTEGER + 1, generalHeadroom: 1 }])
    expect(FeatureCapacitySchema.safeParse(capacity).success).toBe(false);
  expect(FeatureCapacitySchema.parse({ slots: 8, generalHeadroom: 2 })).toEqual({ slots: 8, generalHeadroom: 2 });
});

it("names the app RPC contracts separately from display preferences and keeps provenance unverified", () => {
  expect(readFeatureSettings.name).toBe("firstmate.features.read");
  expect(setFeatureSettings.name).toBe("firstmate.features.set");
  const policy = { format: "firstmate.feature-policy/1", homeId: "/home/firstmate", revision: 1,
    requested: FEATURES_OFF, capacity: DEFAULT_FEATURE_CAPACITY,
    updated: { kind: "plugin-ui-unverified", source: "firstmate.features.set", requestId: randomUUID(), at: new Date().toISOString() } };
  expect(FeaturePolicySchema.parse(policy)).toEqual(policy);
  expect(policyRequested(FeaturePolicySchema.parse(policy))).toEqual(FEATURES_OFF);
  expect(FeaturePolicySchema.safeParse({ ...policy, updated: { ...policy.updated, kind: "captain-ui" } }).success).toBe(false);
  // Format 2 holds the one setting instead of the fences, never both.
  expect(FeaturePolicySchema.safeParse({ ...policy, format: "firstmate.feature-policy/2" }).success).toBe(false);
  const { requested: _, ...rest } = policy, current = { ...rest, format: "firstmate.feature-policy/2", supervisors: true };
  expect(policyRequested(FeaturePolicySchema.parse(current))).toEqual(supervisorCapabilities(true));
  expect(FeaturePolicySchema.safeParse({ ...current, requested: FEATURES_OFF }).success).toBe(false);
  expect(FeaturePolicySchema.safeParse({ ...current, format: "firstmate.feature-policy/3" }).success).toBe(false);
});
