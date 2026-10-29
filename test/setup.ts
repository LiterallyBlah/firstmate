import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

// Run before each test file's imports, including when Vitest is invoked directly.
// Never let tests inherit the daemon's opt-in flag or restore its live home.
const home = mkdtempSync(join(tmpdir(), "firstmate-tests-"));
process.env.FIRSTMATE_RECEIPT_JOURNAL = "0";
process.env.FIRSTMATE_ATTENTION_OBSERVE = "0";
process.env.FIRSTMATE_NEEDS_YOU = "0";
process.env.FIRSTMATE_SCOPED_ACTIVATION = "0";
process.env.FIRSTMATE_PROJECT_MATES = "0";
process.env.FIRSTMATE_SCOPE_UI = "0";
process.env.FIRSTMATE_SCOPE_EXECUTION = "0";
process.env.FIRSTMATE_MAINTENANCE = "0";
process.env.PASEO_HOME = home;

// Receipt-specific tests may opt in and use their own temporary homes. Everyone
// else (and any child process) still has this disposable home as a second guard.
afterAll(() => rm(home, { recursive: true, force: true }));
