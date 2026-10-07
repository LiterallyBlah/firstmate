import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { ScrollView, Text, View } from "react-native";
import { readRemotes } from "../shared/remotes";

export function RemoteHosts({ theme }: { theme: PluginTheme }) {
  const read = useRpc(readRemotes);
  const query = useQuery({ queryKey: ["firstmate", "remotes"], queryFn: () => read({}), refetchInterval: 10000 });
  const snapshot = query.data;
  return (
    <View style={{ margin: 10, marginTop: 0, maxHeight: 240, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 10, gap: 6 }}>
      <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>Remote hosts</Text>
      <ScrollView contentContainerStyle={{ gap: 8 }}>
        {query.isError ? <Text style={{ color: theme.colors.foregroundMuted }}>Remote status unavailable.</Text> : null}
        {snapshot?.syncError ? <Text style={{ color: theme.colors.foregroundMuted }}>{snapshot.syncError}</Text> : null}
        {snapshot?.hosts.length === 0 ? <Text style={{ color: theme.colors.foregroundMuted }}>{snapshot.syncedAt ? "No remote hosts saved in Paseo." : "Waiting for Paseo desktop to synchronize saved hosts."}</Text> : null}
        {snapshot?.hosts.map((host) => (
          <View key={host.serverId} style={{ gap: 3 }}>
            <Text style={{ color: theme.colors.foreground }}>{host.label} · {host.online ? "online" : host.checkedAt ? "unreachable" : "connecting"}</Text>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{host.projects.length} projects · {host.workspaces.length} workspaces · {host.providers.length} providers · {host.workers.length} workers</Text>
            {host.error ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{host.error}</Text> : null}
            {host.workers.map((worker) => <Text key={worker.id} style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{worker.name} · {worker.status}{worker.permissions ? ` · ${worker.permissions} awaiting permission` : ""}</Text>)}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
