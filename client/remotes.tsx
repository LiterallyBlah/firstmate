import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { ScrollView, Text, View } from "react-native";
import { readRemotes, type RemoteHost } from "../shared/remotes";

/** A host clock this far off gets a line, as the helper warns from the same distance. */
const SKEW_WARNING_SECONDS = 180;

/** The remote snapshot, one query for the Remote hosts card and the board's host tabs. */
export function useRemotes() {
  const read = useRpc(readRemotes);
  return useQuery({ queryKey: ["firstmate", "remotes"], queryFn: () => read({}), refetchInterval: 10000 });
}

/** One host's health: reachability, what it has, its workers. The Remote hosts card lists every host this way; a host's tab shows its own. */
export function HostHealth({ host, theme }: { host: RemoteHost; theme: PluginTheme }) {
  return (
    <View style={{ gap: 3 }}>
      <Text style={{ color: theme.colors.foreground }}>{host.label} · {host.online ? "online" : host.checkedAt ? "unreachable" : "connecting"}</Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{host.projects.length} projects · {host.workspaces.length} workspaces · {host.providers.length} providers · {host.workers.length} workers</Text>
      {host.error ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{host.error}</Text> : null}
      {Math.abs(host.clockSkew?.seconds ?? 0) >= SKEW_WARNING_SECONDS ? (
        <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>
          Clock about {Math.round(Math.abs(host.clockSkew!.seconds) / 60)} minutes {host.clockSkew!.seconds < 0 ? "behind" : "ahead of"} this machine; card times are corrected.
        </Text>
      ) : null}
      {host.workers.map((worker) => <Text key={worker.id} style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{worker.name} · {worker.status}{worker.permissions ? ` · ${worker.permissions} awaiting permission` : ""}</Text>)}
    </View>
  );
}

/** A host's health above its tab's columns. */
export function HostHealthCard({ host, theme }: { host: RemoteHost; theme: PluginTheme }) {
  return (
    <View style={{ margin: 10, marginBottom: 0, maxHeight: 160, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 10 }}>
      <ScrollView>
        <HostHealth host={host} theme={theme} />
      </ScrollView>
    </View>
  );
}

export function RemoteHosts({ theme }: { theme: PluginTheme }) {
  const query = useRemotes();
  const snapshot = query.data;
  return (
    <View style={{ margin: 10, marginTop: 0, maxHeight: 240, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 10, gap: 6 }}>
      <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>Remote hosts</Text>
      <ScrollView contentContainerStyle={{ gap: 8 }}>
        {query.isError ? <Text style={{ color: theme.colors.foregroundMuted }}>Remote status unavailable.</Text> : null}
        {snapshot?.syncError ? <Text style={{ color: theme.colors.foregroundMuted }}>{snapshot.syncError}</Text> : null}
        {snapshot?.hosts.length === 0 ? <Text style={{ color: theme.colors.foregroundMuted }}>{snapshot.syncedAt ? "No remote hosts saved in Paseo." : "Waiting for Paseo desktop to synchronize saved hosts."}</Text> : null}
        {snapshot?.hosts.map((host) => <HostHealth key={host.serverId} host={host} theme={theme} />)}
      </ScrollView>
    </View>
  );
}
