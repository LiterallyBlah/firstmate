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
/** One attempt's deadline, and the whole probe's budget. A single longer deadline does not slow a probe that
 * finishes quickly (a warm one takes well under a second), and unlike a short first attempt it never kills a
 * cold PowerShell start part-way (measured 5.3 s on a CI runner, 3.3 s when green) only to retry it cold.
 * 12 s caps one probe; two probes per coordinator claim stay well under the host's 30 s RPC limit. */
export const WINDOWS_IDENTITY_TIMEOUT_MS = 12000;
export const WINDOWS_IDENTITY_BUDGET_MS = 12000;
const WINDOWS_IDENTITY_RETRY_BACKOFF_MS = 250;
const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });
type Run = (file: string, args: string[], options: { windowsHide: boolean; timeout: number; maxBuffer: number }) => Promise<{ stdout: string }>;
/** One bounded probe, plus at most one quick retry when the first attempt failed fast (a spawn error or a fast
 * unusable answer) and the retry fits the same budget. A timed-out attempt spends the budget and is not retried.
 * A definitive alive/dead answer returns at once; exhaustion returns unknown, never dead or alive. */
export async function windowsSupervisionProcessIdentity(pid: number, run: Run = exec,
  options: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {}): Promise<ProcessIdentity> {
  if (!Number.isSafeInteger(pid) || pid < 1) return { state: "unknown" };
  try {
    const { file, args } = windowsIdentityCommand(pid);
    const now = options.now ?? Date.now, started = now();
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = WINDOWS_IDENTITY_BUDGET_MS - (now() - started);
      if (remaining <= 0) break;
      let timedOut = false;
      try {
        const value = (await run(file, args, { windowsHide: true, timeout: attempt === 0 ? WINDOWS_IDENTITY_TIMEOUT_MS : remaining, maxBuffer: 4096 })).stdout.trim();
        if (/^alive:[0-9]+$/.test(value)) return { state: "alive", start: value.slice(6) };
        if (value === "dead") return { state: "dead" };
      } catch (error) { timedOut = (error as { killed?: boolean }).killed === true; }
      // Retry only a fast failure, and only while a second attempt still fits the budget.
      if (timedOut || now() - started + WINDOWS_IDENTITY_RETRY_BACKOFF_MS >= WINDOWS_IDENTITY_BUDGET_MS) break;
      await (options.sleep ?? defaultSleep)(WINDOWS_IDENTITY_RETRY_BACKOFF_MS);
    }
  } catch { /* A failed probe is unknown, never permission. */ }
  return { state: "unknown" };
}
async function osProcessIdentity(pid: number): Promise<ProcessIdentity> {
  try {
    if (process.platform === "linux") return linuxSupervisionProcessIdentity(pid);
    if (process.platform === "win32") return windowsSupervisionProcessIdentity(pid);
  } catch { /* Unsupported/failed OS probes remain unknown. */ }
  return { state: "unknown" };
}
/** After an unknown result, the same PID is not re-probed for this long. The answer repeats as unknown
 * (fail closed, exactly as an exhausted probe would), but a failed coordinator claim does not repay the
 * full spawn cost on every one-second tick. An unknown is never remembered as an identity. */
export const SUPERVISION_IDENTITY_REPROBE_THROTTLE_MS = 30000;
/** This process's start time cannot change while it runs, so its first verified identity is kept for the
 * process's lifetime and every later claim skips the OS probe entirely. Only "alive" for process.pid is
 * cached — never unknown, never another PID's answer (other processes can die and their PIDs be reused). */
let verifiedSelf: { pid: number; start: string } | null = null;
const inFlight = new Map<number, Promise<ProcessIdentity>>();
const unknownAt = new Map<number, number>();
type SupervisionIdentityOptions = { probe?: (pid: number) => Promise<ProcessIdentity>; now?: () => number };
export function supervisionProcessIdentity(pid: number, options: SupervisionIdentityOptions = {}): Promise<ProcessIdentity> {
  if (!Number.isSafeInteger(pid) || pid < 1) return Promise.resolve({ state: "unknown" });
  if (pid === process.pid && verifiedSelf?.pid === pid) return Promise.resolve({ state: "alive", start: verifiedSelf.start });
  const now = options.now ?? Date.now, throttled = unknownAt.get(pid);
  if (throttled !== undefined && now() - throttled < SUPERVISION_IDENTITY_REPROBE_THROTTLE_MS) return Promise.resolve({ state: "unknown" });
  const running = inFlight.get(pid);
  if (running) return running; // Concurrent callers (a prime and a claim) share one OS probe.
  const probe = options.probe ?? osProcessIdentity;
  const pending = (async (): Promise<ProcessIdentity> => {
    try {
      const result = await probe(pid);
      if (result.state === "unknown") unknownAt.set(pid, now());
      else {
        unknownAt.delete(pid);
        if (result.state === "alive" && pid === process.pid) verifiedSelf = { pid, start: result.start };
      }
      return result;
    } catch { unknownAt.set(pid, now()); return { state: "unknown" }; }
    finally { inFlight.delete(pid); }
  })();
  inFlight.set(pid, pending);
  return pending;
}
/** Starts (or joins) this process's identity probe outside any lock, e.g. at runtime construction, so a
 * later coordinator claim normally finds it already verified and cached. Never rejects. */
export function primeSupervisionSelfIdentity(options: SupervisionIdentityOptions = {}): Promise<ProcessIdentity> {
  return supervisionProcessIdentity(process.pid, options);
}
