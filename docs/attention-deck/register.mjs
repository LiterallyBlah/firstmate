/** Register Astra's A1 bytes unchanged. No image processing, sprite drawing or art generation. */
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
const plans = {
  ship: { at: [579, 264], clearance: [24, 50], zones: { helm: [[530,264],[553,264]], bow: [[174,280],[199,283]], station: [[300,275],[352,278],[286,284],[366,283],[418,284],[473,283]] } },
  "japanese-ship": { at: [381,240], clearance: [22,24], zones: { stern: [[337,239],[358,240]], bow: [[77,230],[103,234],[129,235]], rigging: [[252,236],[191,233],[218,240],[270,233],[292,233],[314,233]] } },
  "ghost-ship": { at: [744,259], clearance: [52,60], zones: { helm: [[690,259]], bow: [[220,305],[256,317]], rigging: [[298,326],[340,326],[424,326],[454,326],[486,326],[522,326]] } },
  "sky-airship": { at: [420,205], clearance: [24,42], zones: { helm: [[390,205]], bow: [[114,234],[138,234],[162,234]], engine: [[210,234],[222,234],[306,234],[330,234],[354,234],[198,234]] } },
};
for (const [id, plan] of Object.entries(plans)) {
  const path = `art/settings/${id}/setting.json`;
  const manifest = JSON.parse(readFileSync(path));
  const supplied = `docs/attention-firstmate-art/output/${id}`;
  const asset = JSON.parse(readFileSync(`${supplied}/manifest.json`));
  const bytes = readFileSync(`${supplied}/firstmate.png`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== asset.images["firstmate.png"].sha256) throw new Error(`${id}: A1 bytes changed`);
  copyFileSync(`${supplied}/firstmate.png`, `art/settings/${id}/firstmate-a1.png`);
  manifest.images["firstmate-a1"] = { path: "firstmate-a1.png", size: asset.images["firstmate.png"].size, sha256 };
  manifest.firstMate = { at: plan.at, clearance: plan.clearance, image: "firstmate-a1", lane: asset.reference.lane, pose: asset.standing.sourcePose, facing: "left" };
  if (!manifest.requires.includes("first-mate@1")) manifest.requires.push("first-mate@1");
  for (const zone of manifest.zones.zones) {
    const positions = plan.zones[zone.id];
    if (positions) zone.posts = positions.map((at, i) => ({ ...zone.posts[i], at }));
    // One aligned lane preserves room for 24 crew after reserving the narrow stern.
    if (id === "sky-airship" && zone.overflow.kind === "beside") zone.overflow.spacing = [12, 40];
  }
  // One new minor version for reserved-role and post data, reproducible on repeated runs.
  manifest.version = { ship: "2.1.0", "japanese-ship": "1.3.0", "ghost-ship": "1.1.0", "sky-airship": "1.2.0" }[id];
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
}
