/** Drawer slots shared with the decision UI. Files are resolved by the existing confined home RPC. */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import type { DecisionSource } from "../shared/needs-you";
import { findHomeFiles, readHomeFile } from "../shared/files";
import { fileCandidates, inlineTokens, lookupIn } from "./file-links";
import { IconButton, errorText } from "./ui";
import { decisionMaterialPaths, draftPreview, githubMaterialLabel, namedDraft } from "./decision-materials";

export interface DecisionContextProps {
  theme: PluginTheme;
  source: DecisionSource;
  homeId: string;
  onOpenFile(path: string): void;
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
  const link = { color: theme.colors.foreground, textDecorationLine: "underline" as const };
  return <Text style={{ color: theme.colors.foreground, fontSize: 14, lineHeight: 21 }}>
    {inlineTokens(source.ask, lookup).map((token, index) => {
      if (token.kind === "file") return <Text key={index} accessibilityRole="link" style={link}
        onPress={() => onOpenFile(token.path)}>{token.text}</Text>;
      if (token.kind === "link" && /^https?:\/\//i.test(token.url)) return <Text key={index} accessibilityRole="link" style={link}
        onPress={() => void openExternalUrl(token.url).catch(error => toast.error(errorText(error)))}>{token.text}</Text>;
      return <Text key={index} style={token.kind === "bold" ? { fontWeight: "600" } : undefined}>{token.text}</Text>;
    })}
  </Text>;
}

export function DecisionMaterials(props: DecisionContextProps) {
  const { theme, source, homeId, onOpenFile } = props;
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
      {paths.map(path => <IconButton key={path} theme={theme} icon="FileText" label={path.split("/").pop() ?? path}
        tooltip={path} showLabel onPress={() => onOpenFile(path)} />)}
      {urls.map(url => <IconButton key={url} theme={theme} icon="ExternalLink" label={githubMaterialLabel(url)}
        tooltip={url} showLabel onPress={() => void openExternalUrl(url).catch(error => toast.error(errorText(error)))} />)}
    </View>
    {query.isError ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Home file links are unavailable.</Text> : null}
    {draft ? <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, gap: 6 }}>
      {preview.data?.content != null ? <Text numberOfLines={4} style={{ color: colors.foreground, fontSize: 12, lineHeight: 18 }}>
        {draftPreview(preview.data.content) || "This file is empty."}
      </Text> : <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
        {preview.isPending ? "Loading preview…" : "Preview unavailable."}
      </Text>}
      <Text accessibilityRole="link" onPress={() => onOpenFile(draft)}
        style={{ color: colors.foreground, textDecorationLine: "underline", fontSize: 12 }}>Read the whole draft</Text>
    </View> : null}
  </View>;
}
