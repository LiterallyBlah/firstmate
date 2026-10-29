import type { SupervisionStatus } from "../shared/supervision";
import { portfolioSummary } from "../shared/supervision-projects";
import { maintenanceSummary } from "../shared/supervision-maintenance";
import { compactPortfolioBearings } from "../shared/workflow-plan-summary";
import { bearingsOverview } from "../shared/bearings";
import { goalStatus } from "./supervision-continuation";
const line = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 240);
/** Pure and bounded, including freshness. No session, receiver, model or timeline reads. */
export function scopedBearings(status: SupervisionStatus): string {
  if (!status.scopes.length && !status.problems.length) return "";
  const portfolio = compactPortfolioBearings(portfolioSummary(status)).split("\n");
  const goals = goalStatus(status).goals, maintenance = maintenanceSummary(status);
  const overview = bearingsOverview(`Scoped status: ${status.freshness}; sequence ${status.sequence}${status.freshness !== "current" ? "; counts are a lower bound" : ""}.`,
    portfolio.slice(0, 24).map(line).join("\n") + (portfolio.length > 24 ? `\n${portfolio.length - 24} more portfolio lines; open Projects.` : ""),
    goals.length ? ["Scoped plans", ...goals.slice(0, 24).map(g => `- ${line(g.title)}: ${line(g.state)}; ${line(g.next)}; owner ${g.owner ?? "unavailable"}; ${g.uncertainEffects} uncertain effects.`),
      ...(goals.length > 24 ? [`${goals.length - 24} more plans; open stored status.`] : [])].join("\n") : "",
    maintenance.jobs.length ? [`Maintenance${maintenance.lowerBound ? " (stored lower bound; coverage may be stale)" : ""}`,
      ...maintenance.jobs.slice(0, 16).map(j => `- ${line(j.name)}: ${j.state}; ${j.openIncidents} open incidents; ${j.hosts.offline} offline, ${j.hosts.uncovered} uncovered hosts.`),
      ...(maintenance.jobs.length > 16 ? [`${maintenance.jobs.length - 16} more jobs; open Maintenance.`] : [])].join("\n") : "",
    status.problems.length ? `Stored warnings: ${status.problems.slice(0, 8).map(line).join("; ")}` : "");
  return overview.length > 24000 ? `${overview.slice(0, 23900)}\nMore stored status is available in the scope view.` : overview;
}
