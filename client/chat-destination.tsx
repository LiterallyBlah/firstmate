import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import { useQueries } from "@tanstack/react-query";
import { Pressable, Text, View } from "react-native";
import { ScopeDiscussion } from "./scope-discussion";
import { useScopeSnapshot } from "./scope-query";
import { IconButton } from "./ui";
import type { AgentSummary } from "../shared/fleet";
import { readScopeConversation } from "../shared/supervision-rpc";
import type { DiscussionTarget } from "../shared/scope-discussion";
import { scopeDraftKey } from "../shared/scope-discussion";
import { drafts } from "./draft";
import { ConversationContext } from "./conversation-context";
import { conversationReadKey, conversationReads, mateConversations, sameConversationTarget, type MateConversation } from "./conversation-list";
import { ConversationSwitcher } from "./conversation-switcher";
import { ProjectSetup } from "./project-setup";

export interface ScopeRequest { scopeId: string; homeId: string; navigationId?: string; target?: DiscussionTarget; compose?: boolean }
const reads = conversationReads();

/** The return is deliberate even for a refused/restored target. Never reroute a scoped draft. */
export function ChatDestination({ scopeRequest, imageContext, theme, compact, navigation, children, onDismissScope, mate, active = true }: {
  scopeRequest?: ScopeRequest | undefined;
  imageContext?: { serverId?: string; home?: string };
  theme: PluginTheme; compact: boolean; navigation?: PluginScreenProps["navigation"];
  children: ReactNode | ((active: boolean) => ReactNode);
  onDismissScope?: (() => void) | undefined;
  mate?: AgentSummary | undefined;
  active?: boolean | undefined;
}) {
  const route = JSON.stringify(scopeRequest ?? null);
  const [local, setLocal] = useState<{ route: string; request: ScopeRequest } | null>(null);
  const request = local?.route === route ? local.request : scopeRequest;
  const selectedRoute = JSON.stringify(request ?? null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => { setDismissed(null); }, [route]);
  const contextual = !!request && dismissed !== selectedRoute;
  const host = imageContext?.serverId ?? "local", home = imageContext?.home ?? scopeRequest?.homeId ?? "";
  const scopes = useScopeSnapshot(host, home);
  const snapshot = scopes.data;
  const mates = mateConversations(snapshot);
  const read = useRpc(readScopeConversation);
  const [setup, setSetup] = useState(false);
  const [generalReplies, setGeneralReplies] = useState<readonly string[]>([]);
  const [generalComplete, setGeneralComplete] = useState(false);
  useSyncExternalStore(reads.subscribe, reads.version);
  const generalKey = conversationReadKey(host, home, { scopeId: "general", epoch: 0, agentId: mate?.id ?? null });
  const generalRead = useCallback((ids: readonly string[], visible: boolean, complete: boolean) => {
    setGeneralReplies(previous => JSON.stringify(previous) === JSON.stringify(ids) ? previous : ids);
    setGeneralComplete(complete);
    if (complete) reads.observe(generalKey, ids);
    if (visible) reads.mark(generalKey, ids);
  }, [generalKey]);
  // Same cache and read transport as the named conversation. Only existing owners
  // are observed, with no writer/session creation; failed reads never become zero.
  const histories = useQueries({ queries: mates.map(m => ({
    queryKey: ["firstmate", "scope-conversations", host, snapshot!.homeId, m.scope.id],
    queryFn: async () => ({ threads: [await read({ homeId: snapshot!.homeId, scopeId: m.scope.id, conversationId: "main" })], problems: [] as string[] }),
    enabled: !!snapshot?.uiEnabled && active && !scopes.error,
    refetchInterval: snapshot?.uiEnabled && active ? 15000 : false as const,
  })) });
  const counts: Record<string, number | null> = { general: generalComplete ? reads.unread(generalKey, generalReplies) : null };
  mates.forEach((m, i) => {
    const history = histories[i]!;
    const ids = history.data?.threads.flatMap(t => (t.messages ?? []).filter(message => message.reply !== null).map(message => message.id));
    counts[m.scope.id] = ids && !scopes.error && !history.isError && !history.data?.problems.length ? reads.unread(conversationReadKey(host, snapshot!.homeId, m.scope.target), ids) : null;
  });
  useEffect(() => {
    if (!active || !snapshot?.uiEnabled || scopes.error) return;
    mates.forEach((m, i) => {
      const history = histories[i];
      if (history?.data && !history.isError && !history.data.problems.length) reads.observe(conversationReadKey(host, snapshot.homeId, m.scope.target),
        history.data.threads.flatMap(t => (t.messages ?? []).filter(message => message.reply !== null).map(message => message.id)));
    });
  }, [active, snapshot, scopes.error, histories]);
  useEffect(() => {
    if (!active || !contextual || !snapshot || scopes.error || request.homeId !== snapshot.homeId || !snapshot.uiEnabled) return;
    const index = mates.findIndex(m => m.scope.id === request.scopeId && (!request.target || sameConversationTarget(request.target, m.scope.target)));
    const history = histories[index];
    if (index < 0 || !history?.data || history.isError || history.data.problems.length) return;
    reads.mark(conversationReadKey(host, snapshot.homeId, mates[index]!.scope.target), history.data.threads.flatMap(t => (t.messages ?? []).filter(m => m.reply !== null).map(m => m.id)));
  }, [active, contextual, snapshot, scopes.error, selectedRoute, histories]);
  function open(conversation: MateConversation, message?: string) {
    if (!snapshot) return;
    if (message) {
      const key = scopeDraftKey(host, snapshot.homeId, conversation.scope.id);
      // Keep any existing scoped draft rather than replacing it from Home.
      const previous = drafts.get(key);
      drafts.set(key, previous ? `${previous}\n\n${message}` : message);
    }
    setLocal({ route, request: { scopeId: conversation.scope.id, homeId: snapshot.homeId, target: { ...conversation.scope.target }, compose: message !== undefined } });
    setDismissed(null);
  }
  const back = () => { setDismissed(selectedRoute); onDismissScope?.(); };
  return <ConversationContext.Provider value={{ snapshot, failed: !!scopes.error, mates, open, refresh: () => { void scopes.refetch(); }, setup: () => setSetup(true), generalRead }}><View style={{ flex: 1, minHeight: 0 }}>
    {mate && (mates.length > 0 || contextual) ? <ConversationSwitcher theme={theme} mates={mates} current={contextual ? request.scopeId : "general"} counts={counts} failed={!!scopes.error || snapshot?.freshness === "held"}
      onSelect={m => open(m)} onBack={back} onExpand={() => { void scopes.refetch(); }} /> : null}
    <View style={{ flex: 1, minHeight: 0, display: contextual ? "none" : "flex" }} accessibilityElementsHidden={contextual} importantForAccessibility={contextual ? "no-hide-descendants" : "auto"}>
      {typeof children === "function" ? children(!contextual) : children}
    </View>
    {contextual ? <ContextualDiscussion key={`${host}:${selectedRoute}`} request={request} imageContext={imageContext} theme={theme} compact={compact} navigation={navigation} mate={mate}
      onBack={back} onSelectScope={scopeId => {
        if (scopeId === "general") { back(); return; }
        const target = snapshot?.scopes.find(s => s.id === scopeId)?.target;
        setLocal({ route, request: { scopeId, homeId: request.homeId, ...(target ? { target: { ...target } } : {}) } });
        setDismissed(null);
      }} /> : null}
    {setup ? <ProjectSetup theme={theme} compact={compact} home={home} hostId={host} open onClose={() => { setSetup(false); void scopes.refetch(); }} navigation={navigation} /> : null}
  </View></ConversationContext.Provider>;
}

function ContextualDiscussion({ request, imageContext, theme, compact, navigation, onBack, mate, onSelectScope }: {
  request: ScopeRequest; imageContext?: { serverId?: string; home?: string } | undefined;
  theme: PluginTheme; compact: boolean; navigation?: PluginScreenProps["navigation"]; onBack(): void;
  mate?: AgentSummary | undefined;
  onSelectScope(id: string): void;
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
        {changedOwner ? "This conversation's owner changed. Your draft and recipient are kept. Return to FirstMate and choose the conversation again before sending."
          : crossHome ? "This discussion belongs to a different home. Open its original host and home."
          : scopes.error ? "This conversation couldn't be checked. Try again before sending."
          : !snapshot ? "Loading conversation…"
          : !snapshot.uiEnabled ? "This conversation is unavailable while discussion controls are off. Your draft is kept."
          : "This conversation is unavailable. Your draft and recipient are kept; refresh before sending."}
      </Text>
      <IconButton icon="RefreshCw" label="Refresh conversation" showLabel compact theme={theme} disabled={scopes.isFetching} onPress={() => { void scopes.refetch(); }} />
    </View> : <ScopeDiscussion key={`${host}:${request.homeId}:${scopeId}`} snapshot={snapshot} offline={!!scopes.error}
      hostId={host} theme={theme} compact={compact} navigation={navigation} generalMate={mate} initialScope={scopeId} onSelectScope={onSelectScope} onBackToFirstMate={onBack} capturedTarget={request.target} focusComposer={request.compose} refresh={() => { void scopes.refetch(); }} />}
  </View>;
}

