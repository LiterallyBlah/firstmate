import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { Text, View } from "react-native";
import type { WatchSummary } from "../shared/fleet";
import { configureWatch, createWatch, watchHistory, watchOptions, CURRENT_ROUTING, watchRouting, type WatchRouting } from "../shared/watch-routing";
import { IconButton, errorText } from "./ui";

export function WatchEditor({ theme, watch, onChanged }: { theme: PluginTheme; watch?: WatchSummary; onChanged: () => void }) {
  const create = useRpc(createWatch); const configure = useRpc(configureWatch); const options = useRpc(watchOptions);
  const [open, setOpen] = useState(false); const [name, setName] = useState(watch?.name ?? "");
  const [schedule, setSchedule] = useState(watch?.schedule ?? "*/10 * * * *");
  const [prompt, setPrompt] = useState(watch?.prompt ?? "");
  const [routing, setRouting] = useState<WatchRouting>(watch?.routing ?? CURRENT_ROUTING);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false); const gate = useRef(false);
  const choices = useQuery({ queryKey: ["firstmate", "watch-options"], queryFn: () => options({}), enabled: open, staleTime: 0 });
  const managed = watch === undefined || watch.managed === true;
  const text = { color: theme.colors.foreground, fontSize: 13, lineHeight: 19 };
  const muted = { ...text, color: theme.colors.foregroundMuted };
  const inputStyle = { ...text, padding: 10, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, backgroundColor: theme.colors.surface1 };
  const offered = [{ value: "inherit", label: "Inherit current session" }, ...(choices.data?.thinking ?? []).map(({ id, label }) => ({ value: id, label }))];
  if (!offered.some((option) => option.value === routing.newSessionReasoning)) offered.push({ value: routing.newSessionReasoning, label: `${routing.newSessionReasoning} (unavailable)` });
  async function save() {
    if (gate.current) return; gate.current = true; setBusy(true); setError(null);
    try {
      if (watch) await configure({ name, ...routing, ...(managed ? { schedule, prompt } : {}) });
      else await create({ name, schedule, prompt, enabled: true, ...routing });
      setOpen(false); onChanged();
    } catch (caught) { setError(errorText(caught)); }
    finally { gate.current = false; setBusy(false); }
  }
  return <>
    <IconButton theme={theme} icon={watch ? "Settings2" : "Plus"} label={watch ? `Configure ${watch.name}` : "Add watch"} showLabel={!watch}
      onPress={() => { setName(watch?.name ?? ""); setSchedule(watch?.schedule ?? "*/10 * * * *"); setPrompt(watch?.prompt ?? "");
        setRouting(watch?.routing ?? CURRENT_ROUTING); setError(null); setOpen(true); }} />
    <Modal title={watch ? `Configure ${watch.name}` : "Add inspection watch"} open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}>
      <Modal.Content>
        {!watch ? <IconButton theme={theme} icon="ClipboardCheck" label="Use Board review defaults" showLabel disabled={!choices.data}
          onPress={() => { const preset = choices.data!.boardReview; setName(preset.name); setSchedule(preset.schedule); setPrompt(preset.prompt); setRouting(watchRouting(preset)); }} /> : null}
        {!watch ? <><Text style={text}>Name</Text><TextInput accessibilityLabel="Watch name" value={name} onChangeText={setName} style={inputStyle} autoCapitalize="none" /></> : null}
        {managed ? <><Text style={text}>Schedule · daemon local time</Text><TextInput accessibilityLabel="Watch schedule" value={schedule} onChangeText={setSchedule} style={inputStyle} autoCapitalize="none" />
          <Text style={text}>Inspection brief</Text><TextInput accessibilityLabel="Inspection brief" value={prompt} onChangeText={setPrompt} multiline style={[inputStyle, { minHeight: 110 }]} /></> : <Text style={muted}>Edit the script and its schedule in Files. Non-empty output is routed using these settings.</Text>}
        <SettingsSelect label="Run in" value={routing.executionSession} options={[{ value: "current", label: "Current first-mate session" }, { value: "new", label: "New isolated inspection session" }]}
          onValueChange={(value) => setRouting(value === "current" ? CURRENT_ROUTING : { executionSession: "new", newSessionReasoning: "inherit", notificationPolicy: "actionable" })} />
        {routing.executionSession === "current" ? <Text style={muted}>Keeps the current session's reasoning. The watch already runs there; no separate result notification.</Text> : <>
          <Text style={muted}>Uses the current first mate's provider/model at launch. Read-only inspection; the main first mate alone changes shared records and manages crew.</Text>
          <SettingsSelect label="New-session reasoning" value={routing.newSessionReasoning} options={offered} onValueChange={(newSessionReasoning) => setRouting({ ...routing, newSessionReasoning })} />
          <SettingsSelect label="Notify first mate" value={routing.notificationPolicy} options={[{ value: "actionable", label: "Actionable findings only" }, { value: "always", label: "Every result" }, { value: "never", label: "Keep results in Watches" }]}
            onValueChange={(notificationPolicy) => setRouting({ ...routing, notificationPolicy: notificationPolicy as WatchRouting["notificationPolicy"] })} />
          <Text style={muted}>Failures always notify the current first mate. No-change results stay in Watches unless Every result is selected. Routing is decided before launch, without waking the main session.</Text>
          {choices.data?.reason ? <Text style={{ ...text, color: theme.colors.statusWarning }}>{choices.data.reason}</Text> : null}
        </>}
        <Text style={muted}>Changes apply to future runs. A running inspection keeps its captured settings; its report remains available.</Text>
        {error || choices.error ? <Text style={{ ...text, color: theme.colors.statusDanger }}>{error ?? errorText(choices.error)}</Text> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
          <IconButton theme={theme} icon="X" label="Close" showLabel disabled={busy} onPress={() => setOpen(false)} />
          <IconButton theme={theme} icon="Save" label={busy ? "Saving…" : "Save watch"} showLabel disabled={busy || (routing.executionSession === "new" && choices.data?.available !== true)} onPress={() => void save()} />
        </View>
      </Modal.Content>
    </Modal>
  </>;
}

export function WatchReports({ name, theme }: { name: string; theme: PluginTheme }) {
  const history = useRpc(watchHistory); const [open, setOpen] = useState(false);
  const reports = useQuery({ queryKey: ["firstmate", "watch-history", name], queryFn: () => history({ name }), enabled: open, refetchInterval: open ? 5000 : false });
  const text = { color: theme.colors.foreground, fontSize: 12, lineHeight: 18 };
  return <><IconButton theme={theme} icon="FileText" label={`Reports for ${name}`} onPress={() => setOpen(true)} />
    <Modal title={`${name} · retained reports`} open={open} onOpenChange={setOpen}><Modal.Content>
      <Text style={text}>Reports, status and input evidence remain after inspector sessions are archived. Pending delivery and cleanup stay visible.</Text>
      {reports.error ? <Text style={text}>{errorText(reports.error)}</Text> : null}
      {reports.data?.runs.length === 0 ? <Text style={text}>No isolated inspections recorded.</Text> : null}
      {reports.data?.runs.map((run) => <View key={run.runId} style={{ gap: 6, borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: 10 }}>
        <Text style={text}>{run.at} · {run.status} · notification {run.delivery} · session {run.cleanup}</Text>
        <Text style={text}>Run: {run.runId}{run.agentId ? `\nConversation: ${run.agentId}` : ""}</Text>
        <Text selectable style={text}>{run.report}</Text>
      </View>)}
    </Modal.Content></Modal></>;
}
