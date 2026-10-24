/** Local OS identity only. A failed/unsupported probe is unknown, never permission to take over. */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

export type ProcessIdentity = { state: "alive"; start: string } | { state: "dead" | "unknown" };
const exec = promisify(execFile);
export async function supervisionProcessIdentity(pid: number): Promise<ProcessIdentity> {
  if (!Number.isSafeInteger(pid) || pid < 1) return { state: "unknown" };
  try {
    if (process.platform === "linux") {
      const [record, boot] = await Promise.all([readFile(`/proc/${pid}/stat`, "utf8"), readFile("/proc/sys/kernel/random/boot_id", "utf8")]);
      const fields = record.slice(record.lastIndexOf(")") + 2).split(" ");
      const ticks = fields[19]; // field 22; state is field 3, after the parenthesized comm.
      if (!ticks || !/^[0-9]+$/.test(ticks) || !boot.trim()) return { state: "unknown" };
      // A zombie cannot execute; its children/effects still need separate reconciliation.
      return fields[0] === "Z" ? { state: "dead" } : { state: "alive", start: `${boot.trim()}:${ticks}` };
    }
    if (process.platform === "win32") {
      const script = `try { $p = Get-Process -Id ${pid} -ErrorAction Stop; $s = $p.StartTime; if ($null -eq $s) { 'unknown' } else { 'alive:' + $s.ToUniversalTime().Ticks.ToString() } } catch { if ($_.CategoryInfo.Category -eq 'ObjectNotFound') { 'dead' } else { 'unknown' } }`;
      const { stdout } = await exec(join(process.env.SystemRoot ?? "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"),
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 5000, maxBuffer: 4096 });
      const value = stdout.trim();
      if (/^alive:[0-9]+$/.test(value)) return { state: "alive", start: value.slice(6) };
      return { state: value === "dead" ? "dead" : "unknown" };
    }
  } catch (error) {
    if (process.platform === "linux" && (error as NodeJS.ErrnoException).code === "ENOENT") return { state: "dead" };
  }
  return { state: "unknown" };
}
