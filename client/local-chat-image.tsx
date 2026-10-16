import type { PluginTheme } from "@getpaseo/plugin";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { Text } from "react-native";
import type { ChatImageResult } from "../shared/chat-images";
import { ChatImage } from "./chat-image";

export interface ChatImageLoader {
  /** The contributing host and configured home; bytes must never cross host caches. */
  key: string;
  read(href: string, title?: string): Promise<ChatImageResult>;
}

export function LocalChatImage({ uri, title, label, theme, loader, viewerOnly, onClose }: {
  uri: string; title?: string | undefined; label: string; theme: PluginTheme; loader: ChatImageLoader;
  viewerOnly?: boolean; onClose?: () => void;
}) {
  const image = useQuery({
    queryKey: ["firstmate", "local-image", loader.key, uri, title],
    queryFn: () => loader.read(uri, title),
    staleTime: 60_000,
    gcTime: 60_000,
    retry: false,
  });
  if (image.data?.status === "ready") return <ChatImage uri={image.data.dataUrl} label={label} theme={theme} viewerOnly={viewerOnly} onClose={onClose} />;
  const status = <Text style={{ color: theme.colors.foregroundMuted }}>
    {image.isPending ? "Loading image" : "Image unavailable"}: {label}
  </Text>;
  return viewerOnly ? <Modal title={label} open onOpenChange={value => { if (!value) onClose?.(); }}><Modal.Content>{status}</Modal.Content></Modal> : status;
}
