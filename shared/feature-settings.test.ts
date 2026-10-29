import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { DEFAULT_FEATURE_CAPACITY, FEATURES_OFF, FeatureCapabilitiesSchema, FeatureCapacitySchema,
  FeatureSetInputSchema, FeaturePolicySchema, readFeatureSettings, setFeatureSettings } from "./feature-settings";

it("requires all six independent booleans and an exact reviewed change, without actor or display authority", () => {
  const input = { home: "/home/firstmate", expectedRevision: 0, requestId: randomUUID(),
    change: { requested: { ...FEATURES_OFF }, capacity: { ...DEFAULT_FEATURE_CAPACITY } } };
  expect(FeatureSetInputSchema.parse(input)).toEqual(input);
  for (const key of Object.keys(FEATURES_OFF)) {
    const values = { ...FEATURES_OFF } as Record<string, unknown>; delete values[key];
    expect(FeatureCapabilitiesSchema.safeParse(values).success).toBe(false);
    values[key] = "1"; expect(FeatureCapabilitiesSchema.safeParse(values).success).toBe(false);
  }
  for (const extra of [{ actor: "captain" }, { role: "captain-ui" }, { display: { scopeUi: true } }, { authenticated: true }])
    expect(FeatureSetInputSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  expect(FeatureSetInputSchema.safeParse({ ...input, change: { ...input.change, strongCapabilities: true } }).success).toBe(false);
  expect(FeatureSetInputSchema.safeParse({ ...input, change: { ...input.change, requested: { ...FEATURES_OFF, fullAccessConfinement: true } } }).success).toBe(false);
  expect(FeatureSetInputSchema.safeParse({ ...input, change: { requested: FEATURES_OFF } }).success).toBe(false);
  expect(FeatureSetInputSchema.safeParse({ ...input, expectedRevision: -1 }).success).toBe(false);
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
  expect(FeaturePolicySchema.safeParse({ ...policy, updated: { ...policy.updated, kind: "captain-ui" } }).success).toBe(false);
  expect(FeaturePolicySchema.safeParse({ ...policy, format: "firstmate.feature-policy/2" }).success).toBe(false);
});
