import type { PluginTheme } from "@getpaseo/plugin";
import { getPaseoClient, openExternalUrl, useHosts, useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { copyText, Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { fileLineDescription, parseFileLink } from "./workspace-links";
import { openWorkspaceForFile, resolveWorkspaceFile, type WorkspaceFileSelection, type WorkspaceLinkServices } from "./workspace-link-routing";
import { IconButton, MONOSPACE, Spinner, errorText } from "./ui";
import { readChatImage } from "../shared/chat-images";
import { chatImageRequest, localImageLink } from "./chat-image-routing";
import { LocalChatImage, type ChatImageLoader } from "./local-chat-image";

type LinkState = { kind: "image"; href: string; title?: string | undefined } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "selection"; selection: WorkspaceFileSelection } | null;

/** The SDK can open a workspace, not its file pane. Show the manual selection before leaving chat. */
export function useWorkspaceFileLink(theme: PluginTheme, navigation: PluginScreenProps["navigation"], imageContext?: { serverId?: string; home?: string }) {
  const hosts = useHosts(), toast = useToast();
  const readImage = useRpc(readChatImage);
  const hostsRef = useRef(hosts);
  hostsRef.current = hosts;
  const services: WorkspaceLinkServices = useMemo(() => ({ hosts: () => hostsRef.current, client: getPaseoClient }), []);
  const imageLoader: ChatImageLoader = useMemo(() => ({
    key: JSON.stringify([imageContext?.serverId, imageContext?.home]),
    async read(href, title) {
      try { return await readImage(await chatImageRequest(href, title, { ...imageContext, services })); }
      catch { return { status: "unavailable", reason: "path" }; }
    },
  }), [readImage, services, imageContext?.serverId, imageContext?.home]);
  const generation = useRef(0);
  const [state, setState] = useState<LinkState>(null);
  const [opening, setOpening] = useState(false);
  useEffect(() => () => { generation.current += 1; }, []);

  function close(): void { generation.current += 1; setState(null); setOpening(false); }
  function open(href: string, title?: string): void {
    const request = ++generation.current;
    setOpening(false);
    try {
      if (imageContext !== undefined && localImageLink(href)) {
        setState({ kind: "image", href, title });
        return;
      }
      if (title === "firstmate:home" && !/^https?:\/\//i.test(href)) throw new Error("This home file is missing, outside the confined home, or not yet checked. Open the home Files view to inspect it.");
      const parsed = parseFileLink(href, title);
      if (parsed.kind === "external") {
        setState(null);
        void openExternalUrl(parsed.url).catch((caught: unknown) => toast.error(errorText(caught)));
        return;
      }
      if (navigation === undefined) throw new Error("This Paseo client cannot open workspaces from plugins.");
      setState({ kind: "loading" });
      resolveWorkspaceFile(parsed.reference, services)
        .then(selection => { if (generation.current === request) setState({ kind: "selection", selection }); })
        .catch((caught: unknown) => { if (generation.current === request) setState({ kind: "error", message: errorText(caught) }); });
    } catch (caught) { setState({ kind: "error", message: errorText(caught) }); }
  }
  function navigate(selection: WorkspaceFileSelection): void {
    if (opening) return;
    const request = generation.current;
    setOpening(true);
    openWorkspaceForFile(selection, services, navigation, () => generation.current === request)
      .then(opened => {
        if (!opened || generation.current !== request) return;
        toast.show(`In ${selection.workspace.name} on ${selection.host.label}, manually select ${selection.relativePath}${fileLineDescription(selection.reference) ? ` — ${fileLineDescription(selection.reference)}` : ""}. File existence has not been checked.`, { variant: "info", durationMs: 15000 });
        close();
      })
      .catch((caught: unknown) => { if (generation.current === request) setState({ kind: "error", message: errorText(caught) }); })
      .finally(() => { if (generation.current === request) setOpening(false); });
  }

  const selection = state?.kind === "selection" ? state.selection : null;
  const styles = {
    text: { color: theme.colors.foreground, fontSize: 14, lineHeight: 20 },
    muted: { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 19 },
    path: { color: theme.colors.foreground, fontFamily: MONOSPACE, fontSize: 13, lineHeight: 19 },
  };
  const dialog = state?.kind === "image"
    ? <LocalChatImage key={`${state.href}:${state.title}`} uri={state.href} title={state.title} label="Image from the first mate" theme={theme} loader={imageLoader} viewerOnly onClose={close} />
    : <Modal title="Workspace file link" open={state !== null} onOpenChange={value => { if (!value) close(); }}>
    <Modal.Content>
      {state?.kind === "loading" ? <View style={{ flexDirection: "row", gap: 8 }}><Spinner size={16} color={theme.colors.foregroundMuted} /><Text style={styles.text}>Finding the workspace…</Text></View> : null}
      {state?.kind === "error" ? <Text selectable accessibilityRole="alert" style={styles.text}>{state.message}</Text> : null}
      {selection === null ? null : <>
        <Text style={styles.text}>Open this workspace, then manually select the file in its explorer.</Text>
        <Text selectable style={styles.muted}>Host: {selection.host.label} ({selection.host.serverId}){"\n"}Workspace: {selection.workspace.name} ({selection.workspace.id})</Text>
        <Text selectable style={styles.path}>{selection.relativePath}</Text>
        {fileLineDescription(selection.reference) ? <Text selectable style={styles.text}>{fileLineDescription(selection.reference)}</Text> : null}
        <Text style={styles.muted}>This opens the workspace only. File existence and symlink destinations have not been checked; no file bytes were read.</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }}>
          <IconButton icon="Copy" label="Copy file location" showLabel theme={theme} onPress={() => void copyText(`${selection.relativePath}${selection.reference.lineStart === undefined ? "" : `#L${selection.reference.lineStart}${selection.reference.lineEnd === undefined ? "" : `-L${selection.reference.lineEnd}`}`}`).catch((caught: unknown) => toast.error(errorText(caught)))} />
          <IconButton icon="FolderOpen" label="Open workspace" showLabel theme={theme} disabled={opening} onPress={() => navigate(selection)} />
        </View>
      </>}
    </Modal.Content>
  </Modal>;
  return { open, dialog, imageLoader };
}
