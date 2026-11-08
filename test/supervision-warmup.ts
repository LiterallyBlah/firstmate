/** Pays Windows' cold first PowerShell start (image load and scanning, 3.3–5.3 s on CI runners) once, before any timed
 * identity probe. Its own long bound is for this warm-up only. The product probe has a bounded retry budget and fails
 * closed, which on a loaded runner still answered unknown ("Cannot verify this process start identity"), so the
 * warm-up also hands its verified answer to the product's process-lifetime cache of this process's own identity:
 * the same OS probe, with a long bound, made once per suite. Other PIDs are still probed by the product path. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { primeSupervisionSelfIdentity, windowsIdentityCommand } from "../server/supervision-process";

export const WARMUP_TIMEOUT_MS = 60000;
type Run = (file: string, args: string[], options: { windowsHide: boolean; timeout: number; maxBuffer: number }) => Promise<{ stdout: string }>;
/** A supplied `run` (a unit test's stand-in) is never trusted as this process's identity. */
export async function warmWindowsIdentityProbe(run?: Run): Promise<string> {
  const { file, args } = windowsIdentityCommand(process.pid);
  const value = (await (run ?? promisify(execFile) as Run)(file, args, { windowsHide: true, timeout: WARMUP_TIMEOUT_MS, maxBuffer: 4096 })).stdout.trim();
  if (!run && /^alive:[0-9]+$/.test(value)) await primeSupervisionSelfIdentity({ probe: async () => ({ state: "alive", start: value.slice(6) }) });
  return value;
}
