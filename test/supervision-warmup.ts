/** Pays Windows' cold first PowerShell start (image load and scanning, 3.3–5.3 s on CI runners) once, before any timed
 * identity probe. Its own long bound is for this warm-up only; its result decides nothing. The product probe has a
 * bounded retry budget and fails closed, but suites warm up so a cold start is not paid per probe. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { windowsIdentityCommand } from "../server/supervision-process";

export const WARMUP_TIMEOUT_MS = 60000;
type Run = (file: string, args: string[], options: { windowsHide: boolean; timeout: number; maxBuffer: number }) => Promise<{ stdout: string }>;
export async function warmWindowsIdentityProbe(run: Run = promisify(execFile)): Promise<string> {
  const { file, args } = windowsIdentityCommand(process.pid);
  return (await run(file, args, { windowsHide: true, timeout: WARMUP_TIMEOUT_MS, maxBuffer: 4096 })).stdout.trim();
}
