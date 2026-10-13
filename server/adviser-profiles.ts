/** Phase 0 qualification is fail closed. No provider/mode is an adviser option yet.
 * A future allowlist must pin the complete runtime/settings profile and its evidence,
 * not accept a provider's advertised mode string. See docs/topic-phase0/README.md.
 */
export interface AdviserProfile {
  provider: string;
  model: string;
  modeId: string;
  runtimeFingerprint: string;
}

export function availableAdviserProfiles(): readonly AdviserProfile[] { return []; }

export function requireQualifiedAdviserProfile(_profile: AdviserProfile): never {
  throw new Error("Topic advisers are unavailable: no runtime profile has passed enforcement qualification.");
}
