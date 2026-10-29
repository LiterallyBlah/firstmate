/** A failed fleet read need not take the independently streamed chat away. */
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";
import { readConfig, type AgentSummary } from "../shared/fleet";
import { MateChat } from "./chat";
import { FilesView, type FilesRequest } from "./files";

export function FleetLoadRecovery({ theme, compact, navigation, serverId, onChanged, active = true }: {
  theme: PluginScreenProps["theme"];
  compact: boolean;
  navigation?: PluginScreenProps["navigation"];
  serverId?: string | undefined;
  onChanged(): void;
  active?: boolean;
}) {
  const read = useRpc(readConfig);
  const paseo = usePaseo();
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: ["firstmate", "config"], queryFn: () => read({}) });
  const id = config.data?.config.mateAgentId.trim() ?? "";
  const mate = useQuery({
    queryKey: ["firstmate", "known-mate", id],
    enabled: !!id,
    queryFn: async function (): Promise<AgentSummary | null> {
      const agent = (await paseo.agents.ref(id).refresh())?.agent;
      if (!agent || agent.archivedAt) return null;
      return {
        id: agent.id, workspaceId: agent.workspaceId ?? null, title: agent.title, provider: agent.provider,
        model: agent.model, status: agent.status, cwd: agent.cwd, pendingPermissions: agent.pendingPermissions.length,
        requiresAttention: agent.requiresAttention === true, lastError: agent.lastError ?? null,
        updatedAt: agent.updatedAt, labels: agent.labels,
      };
    },
  });
  const [file, setFile] = useState<FilesRequest | null>(null);
  function changed(): void {
    // A restart retires this identity even when fleet reads keep failing. Clear it before rereading.
    void queryClient.resetQueries({ queryKey: ["firstmate", "config"] });
    void queryClient.resetQueries({ queryKey: ["firstmate", "known-mate"] });
    onChanged();
  }
  if (!mate.data || !config.data) return null;
  return <>
    <MateChat key={mate.data.id} mate={mate.data} mateSince={config.data.config.mateSince || null} theme={theme} compact={compact} active={active}
      imageContext={{ ...(serverId ? { serverId } : {}), home: config.data.resolvedHome }} navigation={navigation} onChanged={changed}
      onOpenFile={path => setFile({ path, at: Date.now() })} />
    <Modal title="Home files" open={file !== null} onOpenChange={open => { if (!open) setFile(null); }}>
      <Modal.Content scrollable={false}>
        <View style={{ height: compact ? 400 : 600, maxHeight: "100%" }}>
          <FilesView theme={theme} compact={compact} request={file} />
        </View>
      </Modal.Content>
    </Modal>
  </>;
}
