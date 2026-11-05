/** Local OS identity only. A failed/unsupported probe is unknown, never permission to take over. */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

export type ProcessIdentity = { state: "alive"; start: string } | { state: "dead" | "unknown" };
const exec = promisify(execFile);
export async function linuxSupervisionProcessIdentity(pid: number,
  readText: (path: string) => Promise<string> = path => readFile(path, "utf8")): Promise<ProcessIdentity> {
  let record: string;
  try { record = await readText(`/proc/${pid}/stat`); }
  catch (error) { return { state: (error as NodeJS.ErrnoException).code === "ENOENT" ? "dead" : "unknown" }; }
  try {
    const boot = await readText("/proc/sys/kernel/random/boot_id");
    const fields = record.slice(record.lastIndexOf(")") + 2).split(" ");
    const ticks = fields[19]; // field 22; state is field 3, after the parenthesized comm.
    if (!ticks || !/^[0-9]+$/.test(ticks) || !boot.trim()) return { state: "unknown" };
    // A zombie cannot execute; its children/effects still need separate reconciliation.
    return fields[0] === "Z" ? { state: "dead" } : { state: "alive", start: `${boot.trim()}:${ticks}` };
  } catch { return { state: "unknown" }; } // Missing boot identity is NOT evidence of process death.
}
/** The Windows probe's command. It calls .NET directly rather than the Get-Process cmdlet, so a cold PowerShell skips
 * command discovery and module autoload; the StartTime expression, and so the recorded start, is the one the cmdlet
 * read. A missing process (ArgumentException) is dead; access denied or any other failure stays unknown. */
export function windowsIdentityCommand(pid: number): { file: string; args: string[] } {
  const script = `try { $s = [System.Diagnostics.Process]::GetProcessById(${pid}).StartTime; if ($null -eq $s) { 'unknown' } else { 'alive:' + $s.ToUniversalTime().Ticks.ToString() } } catch [System.ArgumentException] { 'dead' } catch { 'unknown' }`;
  return { file: join(process.env.SystemRoot ?? "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"),
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script] };
}
/** Per-attempt deadlines. The first stays the historical 5 s, so a warm probe is exactly as before; later attempts
 * escalate because repeating the same deadline cannot outlast the cold start that just missed it (a first PowerShell
 * start measured 5.3 s on a CI runner, 3.3 s when green). The sum plus backoff is the probe's whole budget:
 * 30 s of attempts and 0.75 s of pauses, paid in full only when every attempt times out. */
export const WINDOWS_IDENTITY_ATTEMPT_TIMEOUTS_MS = [5000, 10000, 15000] as const;
export const WINDOWS_IDENTITY_TIMEOUT_MS = WINDOWS_IDENTITY_ATTEMPT_TIMEOUTS_MS[0];
const WINDOWS_IDENTITY_RETRY_BACKOFF_MS = [250, 500] as const;
const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });
type Run = (file: string, args: string[], options: { windowsHide: boolean; timeout: number; maxBuffer: number }) => Promise<{ stdout: string }>;
/** Bounded retries of an unverifiable probe: only an "unknown" attempt (timeout, spawn failure, unusable output) is
 * retried, after a short growing pause; a definitive alive/dead answer returns at once and is never second-guessed.
 * Every attempt re-queries the OS, so a retry can only replace stale ignorance with a fresher answer — exhaustion
 * still returns unknown, never dead or alive, so callers keep failing closed (no takeover, no unverified claim). */
export async function windowsSupervisionProcessIdentity(pid: number, run: Run = exec,
  options: { sleep?: (ms: number) => Promise<void> } = {}): Promise<ProcessIdentity> {
  if (!Number.isSafeInteger(pid) || pid < 1) return { state: "unknown" };
  try {
    const { file, args } = windowsIdentityCommand(pid);
    const sleep = options.sleep ?? defaultSleep;
    for (let attempt = 0; attempt < WINDOWS_IDENTITY_ATTEMPT_TIMEOUTS_MS.length; attempt++) {
      try {
        const value = (await run(file, args, { windowsHide: true, timeout: WINDOWS_IDENTITY_ATTEMPT_TIMEOUTS_MS[attempt]!, maxBuffer: 4096 })).stdout.trim();
        if (/^alive:[0-9]+$/.test(value)) return { state: "alive", start: value.slice(6) };
        if (value === "dead") return { state: "dead" };
      } catch { /* This attempt is unknown; a later one may still verify. */ }
      const backoff = WINDOWS_IDENTITY_RETRY_BACKOFF_MS[attempt];
      if (backoff !== undefined) await sleep(backoff);
    }
    return { state: "unknown" };
  } catch { return { state: "unknown" }; }
}
export async function supervisionProcessIdentity(pid: number): Promise<ProcessIdentity> {
  if (!Number.isSafeInteger(pid) || pid < 1) return { state: "unknown" };
  try {
    if (process.platform === "linux") {
      return linuxSupervisionProcessIdentity(pid);
    }
    if (process.platform === "win32") return windowsSupervisionProcessIdentity(pid);
  } catch { /* Unsupported/failed OS probes remain unknown. */ }
  return { state: "unknown" };
}
