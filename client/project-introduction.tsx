/** Quiet discovery only. A missing setup destination keeps this completely dark. */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { dismissUpdateIntroduction, IntroductionStateSchema, PROJECT_INTRODUCTION_VERSION, readUpdateIntroduction } from "../shared/update-introduction";
import { SetupButton } from "./setup-button";

export interface ProjectIntroductionReadiness {
  firstmateExists: boolean;
  conversationExists: boolean;
  fleetReady: boolean;
  projectsReady: boolean;
  policyReady: boolean;
  projectsNeedSetup: boolean;
}
export function introductionEligible(state: ProjectIntroductionReadiness, setupAvailable: boolean) {
  return setupAvailable && Object.values(state).every(value => value === true);
}
export function ProjectMateIntroduction({ theme, hostId, homeId, readiness, onSetup }: {
  theme: PluginTheme; hostId: string; homeId: string; readiness: ProjectIntroductionReadiness; onSetup?: (() => void) | undefined;
}) {
  // Do not even read preferences until all source reads succeeded and setup is usable.
  return introductionEligible(readiness, !!onSetup) ? <ReadyIntroduction key={`${hostId}:${homeId}`} theme={theme} hostId={hostId} homeId={homeId} onSetup={onSetup!} /> : null;
}
function ReadyIntroduction({ theme, hostId, homeId, onSetup }: { theme: PluginTheme; hostId: string; homeId: string; onSetup(): void }) {
  const read = useRpc(readUpdateIntroduction), dismiss = useRpc(dismissUpdateIntroduction), cache = useQueryClient();
  const input = { homeId, version: PROJECT_INTRODUCTION_VERSION } as const, key = ["firstmate", "introduction", hostId, homeId, input.version];
  const query = useQuery({ queryKey: key, queryFn: async () => IntroductionStateSchema.parse(await read(input)), retry: false, refetchOnMount: "always" });
  const [busy, setBusy] = useState(false), [error, setError] = useState(false), gate = useRef(false);
  if (query.isPending || query.isError || query.data?.homeId !== homeId || query.data.state !== "available") return null;
  async function notNow() {
    if (gate.current) return;
    gate.current = true; setBusy(true); setError(false);
    try {
      const result = IntroductionStateSchema.parse(await dismiss(input));
      if (result.homeId !== homeId || result.state !== "dismissed") throw new Error("Unexpected introduction reply");
      await cache.cancelQueries({ queryKey: key, exact: true });
      cache.setQueryData(key, result);
    } catch { setError(true); }
    finally { gate.current = false; setBusy(false); }
  }
  return <View testID="project-introduction" style={{ gap: 12, padding: 16, borderBottomWidth: 1, borderColor: theme.colors.border }}>
    <Text accessibilityRole="header" style={{ color: theme.colors.foreground, fontSize: 18, fontWeight: "600" }}>A mate for each project</Text>
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 14, lineHeight: 21 }}>Give each project a mate to keep track of its work. You can still talk to FirstMate here.</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <SetupButton theme={theme} label="Set up project mates" disabled={busy} onPress={onSetup} />
      <SetupButton theme={theme} label={busy ? "Saving choice…" : "Not now"} disabled={busy} onPress={() => { void notNow(); }} />
    </View>
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>Choose projects and review limits before anything starts. You can also set this up in FirstMate settings.</Text>
    {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.foreground }}>Couldn't save this choice. Try Not now again after reconnecting.</Text> : null}
  </View>;
}
