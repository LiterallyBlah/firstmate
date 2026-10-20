import { readFile } from "node:fs/promises";
import { planPosture, type PlanDefinition, type PlanPostureSource } from "../shared/workflow-plans";
import { resolveInHome } from "./files";

/** Only plan-posture is consumed. Merge, routing and other standing orders belong to slice 6. */
export function resolvePlanPosture(definition: PlanDefinition, markdown: string | null): PlanPostureSource {
  if (definition.request.posture) return { posture: definition.request.posture, source: "request", detail: definition.request.quote ?? "" };
  const fallback: PlanPostureSource = { posture: planPosture(definition), source: "default", detail: "D2: review multiple runs or any decision; otherwise sail." };
  if (markdown === null) return fallback;
  const blocks = [...markdown.replace(/\r\n/g, "\n").matchAll(/^```standing-orders[ \t]*\n([\s\S]*?)^```[ \t]*$/gm)];
  if (!blocks.length && !/^```standing-orders\b/m.test(markdown)) return fallback;
  const invalid: PlanPostureSource = { posture: "review", source: "standing-orders", detail: "Invalid plan-posture entry.", warning: "Plan posture needs review: use one plan-posture: review, sail or default entry in one standing-orders block." };
  if (!blocks.length) return invalid;
  const entries = blocks.flatMap(b => b[1]!.split("\n").filter(line => /^\s*plan-posture\b/.test(line)));
  if (!entries.length) return fallback;
  const value = entries.length === 1 && blocks.length === 1 ? /^plan-posture:\s*(review|sail|default)\s*$/.exec(entries[0]!.trim())?.[1] : null;
  if (!value) return invalid;
  return { posture: value === "default" ? fallback.posture : value as "review" | "sail", source: "standing-orders", detail: `plan-posture: ${value}` };
}
export async function readPlanPosture(home: string, definition: PlanDefinition): Promise<PlanPostureSource> {
  let text: string | null = null;
  try { text = await readFile((await resolveInHome(home, "data/captain.md")).absolute, "utf8"); } catch { /* Absent/unreadable orders use D2. */ }
  return resolvePlanPosture(definition, text);
}
