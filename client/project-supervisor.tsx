/** A Supervisor for an admitted project, from Supervisors' Add, reviewed like plan and routine-check Supervisors. Opening this starts no work. */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import type { ProjectProvisionInputSchema } from "../shared/supervision-policy";
import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { ProjectRuntimeSnapshotSchema, abortProjectProvisionFromUi, provisionProjectFromUi, type ProjectRuntimeSnapshot } from "../shared/project-runtime";
import { addProjectFolder } from "../shared/project-folders";
import { migrationTargets } from "../shared/fleet";
import { profileProblem, type SupervisorProfile } from "../shared/supervisor-profile";
import { SupervisorProfileFields } from "./supervisor-profile";
import { SetupButton } from "./setup-button";
import { workflowRequestId } from "./workflow-plans";
import { errorText } from "./format";

type Project = ProjectRuntimeSnapshot["projects"][number];
type Provision = z.input<typeof ProjectProvisionInputSchema>;
/** Admitted with an allocation, and with no Supervisor or saved request yet. */
export function projectSupervisorAvailable(project: Project): boolean {
  return project.state === "admitted" && !project.reason && !!project.profile && !!project.limits && !!project.projectId &&
    !project.agentId && !project.provisionInput && !project.provisionRequestId && !project.sessions && !project.turns && !project.uncertain;
}
/** Stopped is terminal: the server refuses to resume it, and it keeps its identity and spending. */
export function projectSupervisorStopped(project: Project): boolean {
  return !!project.provisionInput && (project.state === "stopped" || !!project.reason?.startsWith("Provisioning stopped"));
}
/** A saved request whose Supervisor isn't confirmed yet resumes exactly; it never becomes a second identity. */
export function projectSupervisorResumable(project: Project): boolean {
  return !!project.provisionInput && !projectSupervisorStopped(project) && (!project.agentId || !!project.reason?.startsWith("Provisioning incomplete")) && project.state === "admitted";
}

export function ProjectSupervisorAdd({ theme, compact, data, stale, onRead }: { theme: PluginTheme; compact: boolean; data: ProjectRuntimeSnapshot; stale: boolean; onRead(): void }) {
  const [adding, setAdding] = useState(false), [resuming, setResuming] = useState<Project | null>(null);
  const available = data.projects.filter(projectSupervisorAvailable), resumable = data.projects.filter(projectSupervisorResumable), stopped = data.projects.filter(projectSupervisorStopped);
  const note = { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 20 };
  if (!data.enabled) return <Text style={note}>Turn on project help in FirstMate settings to add a project Supervisor.</Text>;
  return <View style={{ gap: 8 }}>
    {stopped.map(p => <Text key={`stopped:${p.projectId ?? p.name}`} style={note}>{p.name}'s Supervisor setup was stopped. Its saved identity and spending are kept; it can't be resumed.</Text>)}
    {resumable.map(p => <SetupButton key={p.projectId ?? p.name} theme={theme} label={`Resume ${p.name} Supervisor setup`} disabled={stale} onPress={() => setResuming(p)} />)}
    <SetupButton theme={theme} label="Add project Supervisor" disabled={stale || !available.length} onPress={() => setAdding(true)} />
    {!available.length ? <Text style={note}>Only an admitted project without a Supervisor can have one added. FirstMate admits projects and records their allocation.</Text> : null}
    {adding ? <ProjectSupervisorReview theme={theme} compact={compact} data={data} projects={available} onClose={() => setAdding(false)} onRead={onRead} /> : null}
    {resuming?.provisionInput ? <ProjectSupervisorReview theme={theme} compact={compact} data={data} projects={[resuming]} saved={resuming.provisionInput} onClose={() => setResuming(null)} onRead={onRead} /> : null}
  </View>;
}

function ProjectSupervisorReview({ theme, compact, data, projects, saved, onClose, onRead }: {
  theme: PluginTheme; compact: boolean; data: ProjectRuntimeSnapshot; projects: Project[]; saved?: Provision; onClose(): void; onRead(): void;
}) {
  const provision = useRpc(provisionProjectFromUi), stop = useRpc(abortProjectProvisionFromUi), catalog = useRpc(migrationTargets);
  const models = useQuery({ queryKey: ["firstmate", "project-supervisor-models", data.homeId], queryFn: () => catalog({}), enabled: !saved });
  const [selected, select] = useState<Project | null>(projects.length === 1 ? projects[0]! : null);
  const [profile, setProfile] = useState<SupervisorProfile | null>(selected?.profile ? { ...selected.profile } : null);
  const [sessions, setSessions] = useState(String(selected?.limits?.supervisorSessions ?? "")), [turns, setTurns] = useState(String(selected?.limits?.supervisorTurns ?? ""));
  const [opening, setOpening] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const pending = useRef<Provision | null>(saved ?? null), gate = useRef(false), locked = busy || !!pending.current;
  const targets = models.data?.targets ?? [];
  const limits = { supervisorSessions: Number(sessions), supervisorTurns: Number(turns) };
  const withinCaps = !!selected?.limits && [limits.supervisorSessions, limits.supervisorTurns].every(n => Number.isSafeInteger(n) && n >= 1) &&
    limits.supervisorSessions <= selected.limits.supervisorSessions && limits.supervisorTurns <= selected.limits.supervisorTurns;
  const valid = !!selected?.projectId && !!profile && !profileProblem(profile, targets) && withinCaps;
  function choose(project: Project) {
    select(project); setProfile(project.profile ? { ...project.profile } : null);
    setSessions(String(project.limits?.supervisorSessions ?? "")); setTurns(String(project.limits?.supervisorTurns ?? ""));
  }
  async function confirm() {
    if (gate.current || !valid && !pending.current || !selected?.projectId) return;
    gate.current = true; setBusy(true); setError(null);
    // A lost reply keeps the exact request, so a retry can never allocate a second identity.
    pending.current ??= { homeId: data.homeId, requestId: workflowRequestId(), projectId: selected.projectId, projectVersion: selected.version, profile: profile!, limits,
      ...(opening.trim() ? { opening: opening.trim() } : {}) };
    try {
      const next = ProjectRuntimeSnapshotSchema.parse(await provision(pending.current)); onRead();
      const current = next.projects.find(p => p.projectId === pending.current!.projectId);
      if (current?.agentId && !current.reason) onClose();
      else setError(current?.reason ?? "The Supervisor is saved but not confirmed yet. Retry this exact request after checking it; an unknown opening is never sent again.");
    } catch (e) { setError(`${errorText(e)} The exact request is kept; retrying it never creates a second Supervisor.`); }
    finally { gate.current = false; setBusy(false); }
  }
  /** Cancels only undispatched steps; the saved identity, spending and any uncertain outcome stay. */
  async function stopSaved() {
    const target = projects[0];
    if (gate.current || !saved || !target?.projectId) return;
    gate.current = true; setBusy(true); setError(null);
    try { await stop({ homeId: data.homeId, projectId: target.projectId, projectVersion: target.version, provisionRequestId: saved.requestId }); onRead(); onClose(); }
    catch (e) { setError(errorText(e)); }
    finally { gate.current = false; setBusy(false); }
  }
  const text = { color: theme.colors.foreground, fontSize: 14, lineHeight: 21 }, note = { ...text, color: theme.colors.foregroundMuted, fontSize: 13 };
  const field = { ...text, minHeight: 44, padding: 10, borderWidth: 1, borderRadius: 8, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 };
  return <Modal title={saved ? `Resume ${projects[0]?.name ?? "project"} Supervisor setup` : "Add project Supervisor"} open onOpenChange={open => { if (!open && !busy) onClose(); }}><Modal.Content>
    <View testID="project-supervisor-review" style={{ gap: 14 }}>
      <Text style={text}>{saved ? "Resume the saved request with its original model, caps and opening. Recovery looks up its exact identity and never repeats an uncertain opening."
        : "Creates one Supervisor session for this project in its own workspace and sends its opening. One session and one turn count against the project's caps, including uncertain outcomes. Its model, permissions and caps can be changed later in Supervisor settings."}</Text>
      {saved ? null : <>
        <Text style={text}>Project</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {projects.map(p => <SetupButton key={p.projectId ?? p.name} theme={theme} label={selected?.projectId === p.projectId ? `${p.name} (selected)` : p.name} disabled={locked} onPress={() => choose(p)} />)}
        </View>
        {selected ? <>
          <SupervisorProfileFields theme={theme} compact={compact} modelLabel="Supervisor model" permissionLabel="Permission mode" catalog={targets} profile={profile} disabled={locked} onChange={setProfile} />
          {[["Cumulative session limit", sessions, setSessions, selected.limits?.supervisorSessions], ["Cumulative turn limit", turns, setTurns, selected.limits?.supervisorTurns]].map(([label, value, set, cap]) =>
            <View key={String(label)} style={{ gap: 5 }}><Text style={text}>{`${String(label)} (up to ${String(cap)}, the project's allocation)`}</Text>
              <TextInput accessibilityLabel={String(label)} value={String(value)} keyboardType="number-pad" editable={!locked} onChangeText={set as (v: string) => void} style={field} /></View>)}
          <Text style={text}>Opening (optional)</Text>
          <TextInput accessibilityLabel="Opening for this project Supervisor" value={opening} onChangeText={setOpening} editable={!locked} multiline maxLength={16000} style={{ ...field, minHeight: 100 }} />
          <Text style={note}>Leave it empty to send the standard opening with the project's quoted context. Accepted memory and conventions are context, never authority.</Text>
        </> : <Text style={note}>Choose an admitted project.</Text>}
        {models.isError ? <Text accessibilityRole="alert" style={text}>Models could not be loaded. Close and reopen to retry.</Text> : null}
      </>}
      <Text style={note}>Paseo cannot verify who pressed this button. The request is recorded for review.</Text>
      {error ? <Text accessibilityRole="alert" style={text}>{error}</Text> : null}
      <SetupButton theme={theme} label={busy ? "Adding Supervisor…" : pending.current ? "Retry this exact request" : `Add Supervisor${selected ? ` for ${selected.name}` : ""}`}
        disabled={busy || !valid && !pending.current} onPress={() => { void confirm(); }} />
      {saved ? <><SetupButton theme={theme} label="Stop this setup" disabled={busy} onPress={() => { void stopSaved(); }} />
        <Text style={note}>Stopping cancels only steps that haven't started. It keeps the saved identity and spending; a step with an unknown result stays saved for checking.</Text></> : null}
      <SetupButton theme={theme} label={pending.current && !saved ? "Close review" : "Cancel"} disabled={busy} onPress={onClose} />
    </View>
  </Modal.Content></Modal>;
}

/** "Add project": a local folder registered in the project list. Admission and any Supervisor stay separate steps. */
export function AddProjectFolder({ theme, data, onRead }: { theme: PluginTheme; data: ProjectRuntimeSnapshot; onRead(): void }) {
  const add = useRpc(addProjectFolder);
  const [name, setName] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const valid = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(name) && !!data.registryDigest;
  async function choose() {
    if (busy || !valid) return;
    setBusy(true); setError(null);
    try { await add({ homeId: data.homeId, registryDigest: data.registryDigest!, name }); setName(""); onRead(); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  const text = { color: theme.colors.foreground, fontSize: 14, lineHeight: 21 };
  return <View style={{ gap: 6 }}>
    <Text style={text}>Add project</Text>
    <TextInput accessibilityLabel="New project name" value={name} onChangeText={setName} editable={!busy} maxLength={100}
      style={{ ...text, minHeight: 44, padding: 10, borderWidth: 1, borderRadius: 8, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 }} />
    <SetupButton theme={theme} label={busy ? "Waiting for the folder picker…" : "Choose folder and add project"} disabled={busy || !valid} onPress={() => { void choose(); }} />
    <Text style={{ ...text, color: theme.colors.foregroundMuted, fontSize: 13 }}>Opens a folder picker on this computer and records the folder in the project list. It admits nothing and starts no work.</Text>
    {error ? <Text accessibilityRole="alert" style={text}>{error}</Text> : null}
  </View>;
}
