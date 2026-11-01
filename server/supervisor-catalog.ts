import type { PaseoApi } from "./host-types";
import { migrationTargets } from "./migration";
import { SupervisorCatalogSchema, profileProblem, type SupervisorProfile } from "../shared/supervisor-profile";
import { refuse } from "./supervision-effects";
/** Bounded discovery on the exact intended host cwd. No provider trial or fallback. */
export async function supervisorCatalog(paseo: PaseoApi, cwd: string) {
  let timer!: ReturnType<typeof setTimeout>;
  try { return SupervisorCatalogSchema.parse(await Promise.race([migrationTargets(paseo, cwd).then(r => r.targets),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("Supervisor catalog unavailable. Reconnect this host and refresh.")), 5000); })])); }
  finally { clearTimeout(timer); }
}
export async function checkedSupervisorCatalog(paseo: PaseoApi, cwd: string, profile: SupervisorProfile) {
  const catalog = await supervisorCatalog(paseo, cwd), problem = profileProblem(profile, catalog);
  if (problem) refuse("UNSUPPORTED", problem);
  return catalog;
}
