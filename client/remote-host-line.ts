/** The reviewed remote-host line for Supervisors and Attach: where the workers run, where their
 * Supervisor runs, and what an unreachable host means. Pure; labels come from the remote catalog. */
export function remoteWorkerHostLine(hosts: readonly string[], label: (serverId: string) => string): string | null {
  if (!hosts.length) return null;
  return `Workers run on ${hosts.map(label).join(", ")}; this Supervisor runs locally; if the host is unreachable the loop pauses and nothing is resent`;
}
