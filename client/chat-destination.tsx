import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { ScopeDiscussion } from "./scope-discussion";
import { useScopeSnapshot } from "./scope-query";
import { IconButton } from "./ui";
import type { AgentSummary } from "../shared/fleet";
import type { DiscussionTarget } from "../shared/scope-discussion";
import { sameConversationTarget } from "./conversation-target";

export interface ScopeRequest { scopeId: string; homeId: string; navigationId?: string; target?: DiscussionTarget; compose?: boolean }

/**
 * FirstMate is the only conversation here: a scoped discussion opens only from an
 * explicit route (Plans, Needs you, a Supervisor's details), never from a list of
 * bound scopes. The return is deliberate even for a refused/restored target.
 * Never reroute a scoped draft.
 */
export function ChatDestination({ scopeRequest, imageContext, theme, compact, navigation, children, onDismissScope, mate }: {
  scopeRequest?: ScopeRequest | undefined;
  imageContext?: { serverId?: string; home?: string };
  theme: PluginTheme; compact: boolean; navigation?: PluginScreenProps["navigation"];
  children: ReactNode | ((active: boolean) => ReactNode);
  onDismissScope?: (() => void) | undefined;
  mate?: AgentSummary | undefined;
}) {
  const route = JSON.stringify(scopeRequest ?? null);
  const [local, setLocal] = useState<{ route: string; request: ScopeRequest } | null>(null);
  const request = local?.route === route ? local.request : scopeRequest;
  const selectedRoute = JSON.stringify(request ?? null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => { setDismissed(null); }, [route]);
  const contextual = !!request && dismissed !== selectedRoute;
  const host = imageContext?.serverId ?? "local";
  const back = () => { setDismissed(selectedRoute); onDismissScope?.(); };
  return <View style={{ flex: 1, minHeight: 0 }}>
    <View style={{ flex: 1, minHeight: 0, display: contextual ? "none" : "flex" }} accessibilityElementsHidden={contextual} importantForAccessibility={contextual ? "no-hide-descendants" : "auto"}>
      {typeof children === "function" ? children(!contextual) : children}
    </View>
    {contextual ? <ContextualDiscussion key={`${host}:${selectedRoute}`} request={request} imageContext={imageContext} theme={theme} compact={compact} navigation={navigation} mate={mate}
      onBack={back} onSelectScope={(scopeId, target) => {
        if (scopeId === "general") { back(); return; }
        setLocal({ route, request: { scopeId, homeId: request.homeId, ...(target ? { target: { ...target } } : {}) } });
        setDismissed(null);
      }} /> : null}
  </View>;
}

function ContextualDiscussion({ request, imageContext, theme, compact, navigation, onBack, mate, onSelectScope }: {
  request: ScopeRequest; imageContext?: { serverId?: string; home?: string } | undefined;
  theme: PluginTheme; compact: boolean; navigation?: PluginScreenProps["navigation"]; onBack(): void;
  mate?: AgentSummary | undefined;
  onSelectScope(id: string, target: DiscussionTarget | undefined): void;
}) {
  const host = imageContext?.serverId ?? "local";
  const scopes = useScopeSnapshot(host, imageContext?.home ?? request.homeId);
  const snapshot = scopes.data;
  const scopeId = request.scopeId;
  const target = snapshot?.scopes.find(scope => scope.id === scopeId);
  const crossHome = snapshot && request.homeId !== snapshot.homeId;
  const changedOwner = request.target && target && scopeId === request.scopeId && !sameConversationTarget(request.target, target.target);
  return <View testID="contextual-chat" style={{ flex: 1, minHeight: 0 }}>
    <View style={{ padding: 8, gap: 4 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to FirstMate" onPress={onBack}
        style={{ minHeight: 44, padding: 8, justifyContent: "center", alignSelf: "flex-start" }}>
        <Text style={{ color: theme.colors.foreground, textDecorationLine: "underline" }}>Back to FirstMate</Text>
      </Pressable>
      {!snapshot || crossHome || !snapshot.uiEnabled || !target ? <Text accessibilityRole="header" style={{ color: theme.colors.foreground, fontSize: 14 }}>To: {crossHome ? "Selected conversation" : target?.title ?? "Selected conversation"}</Text> : null}
    </View>
    {!snapshot || crossHome || !snapshot.uiEnabled || !target || changedOwner ? <View style={{ padding: 16, gap: 12 }}>
      <Text style={{ color: scopes.error || crossHome ? theme.colors.statusDanger : theme.colors.foregroundMuted }}>
        {changedOwner ? "This conversation's owner changed. Your draft and recipient are kept. Go back and open the conversation again before sending."
          : crossHome ? "This discussion belongs to a different home. Open its original host and home."
          : scopes.error ? "This conversation couldn't be checked. Try again before sending."
          : !snapshot ? "Loading conversation…"
          : !snapshot.uiEnabled ? "This conversation is unavailable while discussion controls are off. Your draft is kept."
          : "This conversation is unavailable. Your draft and recipient are kept; refresh before sending."}
      </Text>
      <IconButton icon="RefreshCw" label="Refresh conversation" showLabel compact theme={theme} disabled={scopes.isFetching} onPress={() => { void scopes.refetch(); }} />
    </View> : <ScopeDiscussion key={`${host}:${request.homeId}:${scopeId}`} snapshot={snapshot} offline={!!scopes.error}
      hostId={host} theme={theme} compact={compact} navigation={navigation} generalMate={mate} initialScope={scopeId} onSelectScope={id => onSelectScope(id, snapshot.scopes.find(s => s.id === id)?.target)} onBackToFirstMate={onBack} capturedTarget={request.target} focusComposer={request.compose} refresh={() => { void scopes.refetch(); }} />}
  </View>;
}

