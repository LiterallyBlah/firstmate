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
export const WINDOWS_IDENTITY_TIMEOUT_MS = 5000;
type Run = (file: string, args: string[], options: { windowsHide: boolean; timeout: number; maxBuffer: number }) => Promise<{ stdout: string }>;
/** One bounded probe, never retried: a probe that misses its deadline is unknown, not dead. */
export async function windowsSupervisionProcessIdentity(pid: number, run: Run = exec): Promise<ProcessIdentity> {
  if (!Number.isSafeInteger(pid) || pid < 1) return { state: "unknown" };
  try {
    const { file, args } = windowsIdentityCommand(pid);
    const value = (await run(file, args, { windowsHide: true, timeout: WINDOWS_IDENTITY_TIMEOUT_MS, maxBuffer: 4096 })).stdout.trim();
    if (/^alive:[0-9]+$/.test(value)) return { state: "alive", start: value.slice(6) };
    return { state: value === "dead" ? "dead" : "unknown" };
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
