/** Writes feature-policy revisions exactly as format 1 saved them, before one Supervisors setting replaced the
 * six separate fences. Only an older install can have such a chain; new saves are always format 2. */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_FEATURE_CAPACITY, FEATURES_OFF, type FeatureCapabilities } from "../shared/feature-settings";
import { FeatureSettingsStore } from "../server/feature-settings";
import { digest, publish } from "../server/submissions";

/** `receipt: false` stops between the revision and its receipt, as an interrupted format 1 save did. */
export async function publishFormat1(root: string, home: string, requested: Partial<FeatureCapabilities>, { receipt = true } = {}) {
  const store = new FeatureSettingsStore(root, home), names = await readdir(store.directory).catch(() => [] as string[]);
  const revisions = names.filter(n => /^\d{16}\.json$/.test(n)).sort(), revision = revisions.length + 1;
  const previous = revisions.length ? JSON.parse(await readFile(join(store.directory, revisions.at(-1)!), "utf8")).hash as string : null;
  const fences = { ...FEATURES_OFF, ...requested };
  const request = { home: store.homeId, expectedRevision: revision - 1, requestId: randomUUID(), change: { requested: fences, capacity: { ...DEFAULT_FEATURE_CAPACITY } } };
  const policy = { format: "firstmate.feature-policy/1", homeId: store.homeId, revision, requested: fences, capacity: { ...DEFAULT_FEATURE_CAPACITY },
    updated: { kind: "plugin-ui-unverified", source: "firstmate.features.set", requestId: request.requestId, at: "2026-10-30T10:00:00.000Z" } };
  const body = { format: "firstmate.feature-policy-revision/1", previous, request, requestHash: digest(request),
    result: { homeId: store.homeId, requestId: request.requestId, policy } };
  await mkdir(store.directory, { recursive: true });
  if (revision === 1) await publish(join(store.directory, "identity.json"), { format: "firstmate.feature-policy-home/1", homeId: store.homeId });
  const name = String(revision).padStart(16, "0"), row = { ...body, hash: digest(body) };
  await publish(join(store.directory, `${name}.json`), row);
  if (receipt) await publish(join(store.directory, `${name}.receipt.json`), row);
  return { request, revision, receipt: join(store.directory, `${name}.receipt.json`) };
}
