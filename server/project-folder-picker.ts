/** Explicit local-app action only. Fixed native scripts; no user text enters shell code. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
export async function selectProjectFolder(): Promise<string | null> {
  const options = { timeout: 120000, maxBuffer: 32768, windowsHide: true };
  if (process.platform === "win32") {
    const script = `Add-Type -AssemblyName System.Windows.Forms; $picker = New-Object System.Windows.Forms.FolderBrowserDialog; $picker.Description = 'Choose a FirstMate project folder'; if ($picker.ShowDialog() -eq 'OK') { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::Write($picker.SelectedPath) }; $picker.Dispose()`;
    const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], options);
    return stdout.trim() || null;
  }
  if (process.platform === "darwin") {
    try { return (await run("/usr/bin/osascript", ["-e", 'POSIX path of (choose folder with prompt "Choose a FirstMate project folder")'], options)).stdout.trim() || null; }
    catch (error) { if (String((error as { stderr?: string }).stderr).includes("(-128)")) return null; throw error; }
  }
  if (process.platform === "linux") {
    try { return (await run("zenity", ["--file-selection", "--directory", "--title=Choose a FirstMate project folder"], options)).stdout.trim() || null; }
    catch (error) { if ((error as { code?: number }).code === 1) return null; throw error; }
  }
  throw new Error("This computer has no supported folder picker. Choose an existing project or open setup on its original computer.");
}
