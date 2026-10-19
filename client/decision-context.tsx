/** Drawer slots shared with the decision UI. Files are resolved by the existing confined home RPC. */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { Pressable, Text, View } from "react-native";
import type { DecisionSource } from "../shared/needs-you";
import { findHomeFiles, readHomeFile } from "../shared/files";
import { fileCandidates, inlineTokens, lookupIn } from "./file-links";
import { ControlTooltip, errorText } from "./ui";
import { Markdown } from "./markdown";
import { decisionMaterialPaths, draftPreview, githubMaterialLabel, namedDraft } from "./decision-materials";

export interface DecisionContextProps {
  theme: PluginTheme;
  source: DecisionSource;
  homeId: string;
  onOpenFile(path: string): void;
  compact?: boolean;
}

function useDecisionFiles({ source, homeId }: DecisionContextProps) {
  const find = useRpc(findHomeFiles);
  const paths = [...new Set([...fileCandidates(source.ask), ...decisionMaterialPaths(source)])];
  const query = useQuery({
    queryKey: ["firstmate.decision.files", homeId, paths],
    queryFn: () => find({ paths }),
    enabled: paths.length > 0,
    staleTime: 5000,
  });
  return { query, lookup: lookupIn(query.data?.files ?? {}) };
}

export function DecisionAsk(props: DecisionContextProps) {
  const { theme, source, onOpenFile } = props;
  const { lookup } = useDecisionFiles(props);
  const toast = useToast();
  return <Markdown source={source.ask} fontSize={15}
    theme={{ ...theme, colors: { ...theme.colors, accent: theme.colors.foreground } }}
    files={lookup} onOpenFile={onOpenFile}
    onOpenLink={url => {
      if (/^https?:\/\//i.test(url)) void openExternalUrl(url).catch(error => toast.error(errorText(error)));
    }} />;
}

export function DecisionMaterials(props: DecisionContextProps) {
  const { theme, source, homeId, onOpenFile, compact = false } = props;
  const { query, lookup } = useDecisionFiles(props);
  const read = useRpc(readHomeFile);
  const toast = useToast();
  const draft = namedDraft(source.ask, lookup);
  const preview = useQuery({
    queryKey: ["firstmate.decision.preview", homeId, draft],
    queryFn: () => read({ path: draft! }),
    enabled: draft !== null,
    staleTime: 5000,
  });
  const paths = [...new Set([draft, ...decisionMaterialPaths(source).map(lookup)].filter((p): p is string => p !== null))];
  const urls = [...new Set([source.url, ...inlineTokens(source.ask, lookup).flatMap(token => token.kind === "link" ? [token.url] : [])]
    .filter((url): url is string => !!url && /^https?:\/\//i.test(url)))];
  if (!paths.length && !urls.length && !query.isError && !query.isFetching) return null;
  const colors = theme.colors;
  return <View style={{ gap: 8 }}>
    <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>TO READ FIRST</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {paths.map(path => <MaterialLink key={path} theme={theme} compact={compact} icon="FileText" label={path.split("/").pop() ?? path}
        target={path} onPress={() => onOpenFile(path)} />)}
      {urls.map(url => <MaterialLink key={url} theme={theme} compact={compact} icon="ExternalLink" label={githubMaterialLabel(url)}
        target={url} onPress={() => void openExternalUrl(url).catch(error => toast.error(errorText(error)))} />)}
    </View>
    {query.isError ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Home file links are unavailable.</Text> : null}
    {draft ? <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, gap: 6 }}>
      {preview.data?.content != null ? <Text numberOfLines={4} style={{ color: colors.foreground, fontSize: 12, lineHeight: 18 }}>
        {draftPreview(preview.data.content) || "This file is empty."}
      </Text> : <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
        {preview.isPending ? "Loading preview…" : "Preview unavailable."}
      </Text>}
      <Pressable accessibilityRole="link" onPress={() => onOpenFile(draft)}
        style={{ minHeight: compact ? 44 : 28, justifyContent: "center" }}>
        <Text style={{ color: colors.foreground, textDecorationLine: "underline", fontSize: 12 }}>Read the whole draft</Text>
      </Pressable>
    </View> : null}
  </View>;
}

function MaterialLink({ theme, compact, icon, label, target, onPress }: {
  theme: PluginTheme; compact: boolean; icon: string; label: string; target: string; onPress(): void;
}) {
  const colors = theme.colors;
  return <ControlTooltip theme={theme} text={target}>{description =>
    <Pressable {...description} accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={{ minHeight: compact ? 44 : 28, paddingHorizontal: 10, paddingVertical: 6,
        borderWidth: 1, borderColor: colors.border, borderRadius: 7, backgroundColor: colors.surface1,
        flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Icon name={icon} size={14} color={colors.foreground} />
      <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "500", flexShrink: 1 }}>{label}</Text>
    </Pressable>
  }</ControlTooltip>;
}
