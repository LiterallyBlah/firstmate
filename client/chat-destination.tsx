import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { ScopeDiscussion } from "./scope-discussion";
import { useScopeSnapshot } from "./scope-query";
import { IconButton } from "./ui";
import type { AgentSummary } from "../shared/fleet";

export interface ScopeRequest { scopeId: string; homeId: string; navigationId?: string }

/** The return is deliberate even for a refused/restored target. Never reroute a scoped draft. */
export function ChatDestination({ scopeRequest, imageContext, theme, compact, navigation, children, onDismissScope, mate }: {
  scopeRequest?: ScopeRequest | undefined;
  imageContext?: { serverId?: string; home?: string };
  theme: PluginTheme; compact: boolean; navigation?: PluginScreenProps["navigation"];
  children: ReactNode | ((active: boolean) => ReactNode);
  onDismissScope?: (() => void) | undefined;
  mate?: AgentSummary | undefined;
}) {
  const route = JSON.stringify(scopeRequest ?? null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => { setDismissed(null); }, [route]);
  const contextual = !!scopeRequest && dismissed !== route;
  return <View style={{ flex: 1, minHeight: 0 }}>
    <View style={{ flex: 1, minHeight: 0, display: contextual ? "none" : "flex" }} accessibilityElementsHidden={contextual} importantForAccessibility={contextual ? "no-hide-descendants" : "auto"}>
      {typeof children === "function" ? children(!contextual) : children}
    </View>
    {contextual ? <ContextualDiscussion key={`${imageContext?.serverId ?? "local"}:${route}`} request={scopeRequest} imageContext={imageContext} theme={theme} compact={compact} navigation={navigation} mate={mate}
      onBack={() => { setDismissed(route); onDismissScope?.(); }} /> : null}
  </View>;
}

function ContextualDiscussion({ request, imageContext, theme, compact, navigation, onBack, mate }: {
  request: { scopeId: string; homeId: string }; imageContext?: { serverId?: string; home?: string } | undefined;
  theme: PluginTheme; compact: boolean; navigation?: PluginScreenProps["navigation"]; onBack(): void;
  mate?: AgentSummary | undefined;
}) {
  const host = imageContext?.serverId ?? "local";
  const scopes = useScopeSnapshot(host, imageContext?.home ?? request.homeId);
  const snapshot = scopes.data;
  const [scopeId, setScopeId] = useState(request.scopeId);
  const target = snapshot?.scopes.find(scope => scope.id === scopeId);
  const crossHome = snapshot && request.homeId !== snapshot.homeId;
  return <View testID="contextual-chat" style={{ flex: 1, minHeight: 0 }}>
    <View style={{ padding: 8, gap: 4 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to FirstMate" onPress={onBack}
        style={{ minHeight: 44, padding: 8, justifyContent: "center", alignSelf: "flex-start" }}>
        <Text style={{ color: theme.colors.foreground, textDecorationLine: "underline" }}>Back to FirstMate</Text>
      </Pressable>
      {!snapshot || crossHome || !snapshot.uiEnabled || !target ? <Text accessibilityRole="header" style={{ color: theme.colors.foreground, fontSize: 14 }}>To: {crossHome ? "Selected conversation" : target?.title ?? "Selected conversation"}</Text> : null}
    </View>
    {!snapshot || crossHome || !snapshot.uiEnabled || !target ? <View style={{ padding: 16, gap: 12 }}>
      <Text style={{ color: scopes.error || crossHome ? theme.colors.statusDanger : theme.colors.foregroundMuted }}>
        {crossHome ? "This discussion belongs to a different home. Open its original host and home."
          : scopes.error ? "This conversation couldn't be checked. Try again before sending."
          : !snapshot ? "Loading conversation…"
          : !snapshot.uiEnabled ? "This conversation is unavailable while discussion controls are off. Your draft is kept."
          : "This conversation is unavailable. Your draft and recipient are kept; refresh before sending."}
      </Text>
      <IconButton icon="RefreshCw" label="Refresh conversation" showLabel compact theme={theme} disabled={scopes.isFetching} onPress={() => { void scopes.refetch(); }} />
    </View> : <ScopeDiscussion key={`${host}:${request.homeId}:${scopeId}`} snapshot={snapshot} offline={!!scopes.error}
      hostId={host} theme={theme} compact={compact} navigation={navigation} generalMate={mate} initialScope={scopeId} onSelectScope={setScopeId} onBackToFirstMate={onBack} refresh={() => { void scopes.refetch(); }} />}
  </View>;
}

