/** Shared destination for Settings and Home. Mount only on an explicit setup action. */
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { addProjectSetupFolder, commitProjectSetup, previewProjectSetup, readProjectSetup, readSavedProjectSetup, resumeProjectSetup, saveProjectSetupInstructions,
  ProjectSetupCatalogSchema, ProjectSetupPreviewSchema, ProjectSetupChoicesSchema, ProjectSetupStatusSchema, type ProjectSetupCatalog, type ProjectSetupChoices, type ProjectSetupPreview } from "../shared/project-setup";
import { ProjectSetupInputSchema } from "../shared/supervision-policy";
import type { z } from "zod";
import { OptionPicker } from "./option-picker";
import { workflowRequestId } from "./workflow-plans";
import { errorText } from "./format";
import { ProjectBatchPanel, type ProjectBatchDraft } from "./project-setup-batch";
import { readProjectBatches, ProjectBatchStatusSchema } from "../shared/project-setup-batch";
import { checkboxKeyProps } from "./checkbox-keyboard";

export function SetupAction({ theme, label, onPress, disabled = false, primary = false }: {
  theme: PluginTheme; label: string; onPress(): void; disabled?: boolean; primary?: boolean;
}) {
  const [focused, focus] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    onFocus={() => focus(true)} onBlur={() => focus(false)}
    style={{ minHeight: 44, minWidth: 44, maxWidth: "100%", flexShrink: 1, justifyContent: "center", paddingHorizontal: 12, paddingVertical: 10,
      borderWidth: 2, borderRadius: 8, borderColor: focused || primary ? theme.colors.accent : theme.colors.border,
      backgroundColor: primary && !focused ? theme.colors.accent : theme.colors.surface1, opacity: disabled ? 0.5 : 1 }}>
    <Text style={{ color: primary && !focused ? theme.colors.accentForeground : theme.colors.foreground, fontSize: 14, flexShrink: 1 }}>{label}</Text>
  </Pressable>;
}
function ProjectSelection({ theme, name, checked, disabled, reviewed, onPress }: { theme: PluginTheme; name: string; checked: boolean; disabled: boolean; reviewed: boolean; onPress(): void }) {
  const [focused, focus] = useState(false);
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={`Select ${name}`} accessibilityState={{ checked, disabled }} aria-checked={checked} aria-disabled={disabled} disabled={disabled}
    {...checkboxKeyProps(onPress, disabled)}
    onPress={onPress} onFocus={() => focus(true)} onBlur={() => focus(false)}
    style={{ minHeight: 44, padding: 10, borderWidth: 2, borderRadius: 8, borderColor: focused ? theme.colors.accent : theme.colors.border, backgroundColor: theme.colors.surface1 }}>
    <Text style={{ color: theme.colors.foreground, fontSize: 14, lineHeight: 21 }}>{checked ? "Selected" : "Select project"}{reviewed ? " · Settings reviewed" : ""}</Text>
  </Pressable>;
}
export type ProjectSetupProps = { theme: PluginTheme; compact: boolean; home: string; hostId: string; open: boolean; onClose(): void;
  navigation?: PluginSurfaceProps["navigation"]; online?: boolean; initialProjectName?: string };
/** Slice 10 can mount this same destination; no separate Home setup logic is needed. */
export function ProjectSetup(props: ProjectSetupProps) {
  return props.open ? <ProjectSetupSession key={`${props.hostId}:${props.home}`} {...props} /> : null;
}
function ProjectSetupSession({ theme, compact, home, hostId, onClose, navigation, online = true, initialProjectName }: ProjectSetupProps) {
  const read = useRpc(readProjectSetup), preview = useRpc(previewProjectSetup), commit = useRpc(commitProjectSetup), status = useRpc(readSavedProjectSetup), resume = useRpc(resumeProjectSetup), folder = useRpc(addProjectSetupFolder), saveInstructions = useRpc(saveProjectSetupInstructions);
  const cache = useQueryClient(), query = useQuery({ queryKey: ["firstmate", "project-setup", hostId, home], queryFn: async () => ProjectSetupCatalogSchema.parse(await read({ homeId: home })), retry: false });
  const saved = useQuery({ queryKey: ["firstmate", "project-setup-saved", hostId, home], queryFn: async () => ProjectSetupStatusSchema.parse(await status({ homeId: home })), retry: false });
  const readBatches = useRpc(readProjectBatches), batches = useQuery({ queryKey: ["firstmate", "project-batches", hostId, home], queryFn: async () => ProjectBatchStatusSchema.array().parse(await readBatches({ homeId: home })), retry: false });
  const [choices, choose] = useState<ProjectSetupChoices | null>(null), [review, setReview] = useState<ProjectSetupPreview | null>(null);
  const [request, setRequest] = useState<z.infer<typeof ProjectSetupInputSchema> | null>(null), [busy, setBusy] = useState(false), [failure, fail] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null), [details, setDetails] = useState(false), [folderName, setFolderName] = useState("");
  const [selected, setSelected] = useState<string[]>([]), [batchChoices, saveBatchChoices] = useState<Record<string, ProjectSetupChoices>>({}), [batch, showBatch] = useState(false);
  const batchDraft = useRef<ProjectBatchDraft>({ batchId: workflowRequestId(), review: null, exact: null });
  const [instructions, setInstructions] = useState(""), instructionRequest = useRef<Parameters<typeof saveInstructions>[0] | null>(null);
  const gate = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const data = query.data, text = { color: theme.colors.foreground, fontSize: 14, lineHeight: 21 }, note = { ...text, color: theme.colors.foregroundMuted };
  const disabled = busy || !online || query.isError || saved.isError || batches.isPending || batches.isError;
  async function act(run: () => Promise<void>) {
    if (gate.current || !online) return; gate.current = true; setBusy(true); fail(null);
    try { await run(); } catch (e) { if (mounted.current) fail(errorText(e)); }
    finally { gate.current = false; if (mounted.current) setBusy(false); }
  }
  async function refresh() { await Promise.all([query.refetch(), saved.refetch(), cache.refetchQueries({ queryKey: ["firstmate", "project-batches", hostId, home] })]); }
  function select(name: string) {
    if (!data) return;
    const existing = data.reviewed.find(p => p.name === name);
    choose(existing ?? { homeId: home, name, profile: null, limits: null, budget: null, sourcePath: null }); setReview(null); fail(null); setResult(null);
    setInstructions(""); instructionRequest.current = null;
  }
  const initialChosen = useRef(false);
  useEffect(() => {
    if (!initialProjectName || !data || initialChosen.current) return;
    initialChosen.current = true;
    const project = data.snapshot.projects.find(p => p.name === initialProjectName);
    if (project?.directory && !project.agentId && !project.provisionInput && !project.uncertain && project.state !== "stopped") select(project.name);
    else if (!project) fail("This project is no longer listed. Choose its current entry below.");
  }, [initialProjectName, data]);
  function outcome(snapshot: Awaited<ReturnType<typeof commit>>, name: string) {
    const p = snapshot.projects.find(p => p.name === name);
    return p?.agentId && !p.reason && p.state !== "stopped" ? `${name} is ready. Open its conversation when you want to talk.` :
      p?.uncertain ? "Setup needs checking. Use saved setup below to see whether its original operation can continue." :
      p?.provisionInput ? "Setup is saved. Check its result before continuing the recorded operation." : "Your review is saved. Admission can be continued with its original choices.";
  }
  async function confirm() {
    if (!review?.review || !review.reviewDigest || disabled) return;
    const input = request ?? ProjectSetupInputSchema.parse({ homeId: home, requestId: workflowRequestId(), review: review.review, reviewDigest: review.reviewDigest });
    setRequest(input);
    await act(async () => {
      try { const snapshot = await commit(input); if (mounted.current) setResult(outcome(snapshot, input.review.name)); }
      catch (e) { if (mounted.current) fail(`Couldn't confirm setup. Check saved setup before continuing; keep this review. ${errorText(e)}`); }
      await refresh(); void cache.invalidateQueries({ queryKey: ["firstmate", "project-ownership"] });
    });
  }
  const model = data?.models.find(m => m.provider === choices?.profile?.provider);
  const field = (label: string, value: string, change: (v: string) => void) => <View style={{ gap: 5 }}><Text style={text}>{label}</Text><TextInput accessibilityLabel={label} value={value}
    editable={!disabled && !request} keyboardType="number-pad" onChangeText={change} style={{ ...text, minHeight: 44, padding: 10, borderWidth: 1, borderRadius: 8, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 }} /></View>;
  const eligible = data?.snapshot.projects.filter(p => !!p.projectId && !!p.directory && p.hostId === "local" && ["admitted", "unadmitted"].includes(p.state) &&
    !p.agentId && !p.provisionInput && !p.uncertain && !saved.data?.requests.some(r => r.review.projectId === p.projectId) &&
    !batches.data?.some(b => b.children.some(c => c.projectId === p.projectId && c.state !== "cancelled"))) ?? [];
  const step = batch ? "batch" : result ? "result" : review?.review ? "review" : choices ? "profile" : "chooser";
  return <Modal key={step} title={result ? "Project setup result" : review?.review ? `Review ${review.review.name} mate` : choices ? `${choices.name} setup` : "Set up project mates"} open onOpenChange={open => { if (!open && !busy) onClose(); }}><Modal.Content>
    <View testID="project-setup" style={{ gap: 18 }}>
      {!data ? <Text accessibilityLiveRegion="polite" style={text}>{query.isError ? "Project setup couldn't be read. Check the connection and try again." : "Getting your projects ready…"}</Text> : null}
      {!online ? <Text style={text}>This host is offline. Your review is kept; reconnect before continuing.</Text> : null}
      {data?.problems.map((s, i) => <Text key={i} style={text}>{s}</Text>)}
      {failure ? <Text accessibilityRole="alert" style={text}>{failure}</Text> : null}
      {result ? <Text accessibilityLiveRegion="polite" style={text}>{result}</Text> : null}
      {batch && data ? <ProjectBatchPanel theme={theme} home={home} hostId={hostId} online={online} navigation={navigation} onClose={onClose} draft={batchDraft}
        choices={selected.map(name => batchChoices[name] ?? data.reviewed.find(r => r.name === name) ?? { homeId: home, name, profile: null, limits: null, budget: null, sourcePath: null })}
        data={data} onBack={() => showBatch(false)} onRefresh={refresh} /> : review?.review && !result ? <>
        <ProjectSetupReview theme={theme} data={data!} review={review} />
        <Text style={note}>This creates a separate project conversation and one opening message. Your FirstMate chat stays where it is. Plan execution and release actions keep their separate approvals.</Text>
        {request ? <Text style={text}>This request keeps its original model, permissions and limits. Check saved setup after a lost reply; uncertain messages are never automatically resent.</Text> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {selected.includes(review.review.name) && !request ? <SetupAction theme={theme} primary label={`Use reviewed settings for ${review.review.name}`} disabled={disabled} onPress={() => {
            saveBatchChoices({ ...batchChoices, [review.review!.name]: review.choices }); choose(null); setReview(null);
          }} /> : !result ? <SetupAction theme={theme} primary label={busy ? "Setting up…" : request ? "Continue exact setup" : "Create project mate"} disabled={disabled} onPress={() => { void confirm(); }} /> : null}
          {!request ? <SetupAction theme={theme} label="Back to projects" disabled={busy} onPress={() => setReview(null)} /> : null}
        </View>
        <SetupAction theme={theme} label={details ? "Hide setup details" : "Setup details"} onPress={() => setDetails(!details)} />
        {details ? <View style={{ gap: 10 }}><Text selectable style={note}>{review.review.source.path} · version {review.review.source.version}</Text>
          <Text selectable style={text}>{data?.sources.find(s => s.path === review.review!.source.path)?.text}</Text>
          <Text selectable style={text}>{review.review.opening}</Text>
          <Text selectable style={note}>{JSON.stringify(review.review.sourceVector)}</Text>
          <Text selectable style={note}>Review {review.reviewDigest}. Recorded app action; caller identity is unverified.</Text></View> : null}
      </> : data && !result ? <>
        {!choices ? <>
          <Text style={text}>Choose the projects that should have their own mate. Your FirstMate chat stays here. Review each project's settings before anything starts.</Text>
          <Text style={note}>{batches.data ? `${eligible.length} available to set up · ${data.snapshot.projects.filter(p => p.agentId && !p.reason).length} already set up · ${data.snapshot.projects.filter(p => !eligible.includes(p) && !(p.agentId && !p.reason)).length} unavailable or saved` : batches.isError ? "Saved setup couldn't be checked. Check the connection before selecting projects." : "Checking saved setup…"}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <SetupAction theme={theme} label="Select all eligible projects" disabled={disabled || !eligible.length || eligible.length > 64} onPress={() => setSelected(eligible.map(p => p.name))} />
            {selected.length ? <SetupAction theme={theme} label="Clear selection" disabled={disabled} onPress={() => setSelected([])} /> : null}
            <SetupAction theme={theme} primary label={`Review ${selected.length} selected ${selected.length === 1 ? "project" : "projects"}`} disabled={disabled || !selected.length || selected.length > 64} onPress={() => {
              // A known saved batch keeps its own recovery controls below. A new explicit review
              // may start a different batch; an unconfirmed request must retain its original ID.
              if (batches.data?.some(b => b.commit.manifest.batchId === batchDraft.current.batchId))
                batchDraft.current = { batchId: workflowRequestId(), review: null, exact: null };
              showBatch(true);
            }} />
          </View>
          {selected.length ? <Text style={text}>{selected.length} selected. {selected.filter(name => !batchChoices[name] && !data.reviewed.some(r => r.name === name)).length} need model, permissions, limits and instructions reviewed. Use each project's Review action below.</Text> : null}
          {eligible.length > 64 ? <Text style={text}>Select up to 64 projects for one reviewed setup.</Text> : null}
        </> : null}
        {!choices ? [...data.snapshot.projects].sort((a, b) => Number(b.name === initialProjectName) - Number(a.name === initialProjectName)).map((project, i) => {
          const savedRequest = saved.data?.requests.find(r => r.review.projectId === project.projectId), ready = !!project.agentId && !project.reason && project.state !== "stopped";
          const issue = data.folderIssues.find(r => r.name === project.name);
          return <View key={`${project.name}:${i}`} style={{ gap: 8, paddingBottom: 14, borderBottomWidth: 1, borderColor: theme.colors.border }}>
            <Text style={{ ...text, fontSize: 16, fontWeight: "600" }}>{project.name}</Text>
            {eligible.includes(project) ? <ProjectSelection theme={theme} name={project.name} checked={selected.includes(project.name)} disabled={disabled || !selected.includes(project.name) && selected.length >= 64}
              reviewed={!!batchChoices[project.name]} onPress={() => setSelected(selected.includes(project.name) ? selected.filter(n => n !== project.name) : [...selected, project.name])} /> : null}
            <Text selectable style={note}>{project.directory ?? issue?.location ?? "Folder unavailable"} · {project.hostId ?? "Original computer"}</Text>
            <Text style={text}>{ready ? "Already set up" : project.uncertain ? "Checking whether setup finished" :
              project.state === "stopped" || project.reason?.startsWith("Provisioning stopped") ? "Setup was stopped. Review the saved operation before continuing." :
              savedRequest || project.provisionInput ? "Waiting to finish saved setup" : !project.directory ? issue?.canReplace ? "This folder is unavailable. Choose its replacement, then review setup again." : issue ? "Restore this project's original folder at the path above on its original computer, then check saved setup. Its saved identity cannot be moved to another folder here." : "This project needs a checked local folder on its original computer. Review its setup for the required mapping." :
              project.state === "held" ? "This project's identity needs a change. Review its setup to see the next step." : "Ready to review"}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {project.agentId && navigation ? <SetupAction theme={theme} label={`Open ${project.name} conversation`} onPress={() => { navigation.openAgent({ agentId: project.agentId!, ...(hostId === "local" ? {} : { serverId: hostId }) }); onClose(); }} /> : null}
              {!ready && !savedRequest && !project.provisionInput && (project.directory || !issue) ? <SetupAction theme={theme} label={`Review ${project.name}`} disabled={disabled} onPress={() => select(project.name)} /> : null}
              {issue?.canReplace && hostId === "local" ? <SetupAction theme={theme} label={`Choose a replacement folder for ${project.name}`} disabled={disabled || !data.snapshot.registryDigest} onPress={() => { void act(async () => {
                await folder({ homeId: home, registryDigest: data.snapshot.registryDigest!, name: project.name, replace: { location: issue.location, rowDigest: issue.rowDigest } });
                await refresh(); choose(null); setReview(null); setRequest(null);
              }); }} /> : null}
              {project.provisionInput && !savedRequest ? <Text style={note}>Continue this project's original setup in Advanced work details. Its identity and spending are kept.</Text> : null}
              {project.state === "stopped" || project.reason?.startsWith("Provisioning stopped") ? <Text style={text}>Setup was stopped. Review the retained operation in Advanced work details; no replacement mate is created.</Text> : null}
            </View>
          </View>;
        }) : null}
        {!data.snapshot.projects.length ? <Text style={text}>Choose a local project folder to get started.</Text> : null}
        {choices ? <View style={{ gap: 14 }}>
          <SetupAction theme={theme} label="Back to projects" disabled={disabled} onPress={() => { choose(null); setReview(null); }} />
          {data.reviewed.some(r => r.name === choices.name) ? <Text style={text}>Using this project's reviewed model, permissions and limits. Unavailable choices remain blocked; another model is never substituted.</Text> : <Text style={note}>Choose the model, permissions and limits you want this mate to use. No spending limits are chosen for you.</Text>}
          <OptionPicker roomy theme={theme} compact={compact} label="Model" title="Choose a model" value={choices.profile?.provider ?? ""} options={data.models.map(m => ({ label: m.label, value: m.provider }))}
            disabled={disabled || data.reviewed.some(r => r.name === choices.name)} onSelect={provider => choose({ ...choices, profile: { provider, modeId: "" } })} />
          <OptionPicker roomy theme={theme} compact={compact} label="Permissions" title="Choose permissions" value={choices.profile?.modeId ?? ""} options={(model?.modes ?? []).map(m => ({ label: `${m.label} (${m.id})`, value: m.id }))}
            disabled={disabled || !model || data.reviewed.some(r => r.name === choices.name)} onSelect={modeId => choose({ ...choices, profile: { ...choices.profile!, modeId } })} />
          {model?.thinking.length ? <OptionPicker roomy theme={theme} compact={compact} label="Reasoning" title="Choose reasoning" value={choices.profile?.thinkingOptionId ?? ""} options={[{ label: "Provider default", value: "" }, ...model.thinking.map(t => ({ label: t.label, value: t.id }))]}
            disabled={disabled || data.reviewed.some(r => r.name === choices.name)} onSelect={thinkingOptionId => choose({ ...choices, profile: { ...choices.profile!, ...(thinkingOptionId ? { thinkingOptionId } : { thinkingOptionId: undefined }) } })} /> : null}
          {!data.reviewed.some(r => r.name === choices.name) ? <>
            <Text style={text}>One persistent session. Setup and every later reply count toward the total turn limit.</Text>
            {field("Total conversation turns", choices.limits ? String(choices.limits.supervisorTurns) : "", v => choose({ ...choices, limits: /^\d+$/.test(v) ? { supervisorSessions: 1, supervisorTurns: Number(v) } : null }))}
            {field("Project agent allocation", choices.budget ? String(choices.budget.agents) : "", v => choose({ ...choices, budget: { agents: Number(v), turns: choices.budget?.turns ?? 0 } }))}
            {field("Project turn allocation", choices.budget ? String(choices.budget.turns) : "", v => choose({ ...choices, budget: { agents: choices.budget?.agents ?? 0, turns: Number(v) } }))}
            <Text style={note}>These allocations bound later checked project work. They do not approve a plan, grant release authority or change other projects' budgets.</Text>
            <OptionPicker roomy theme={theme} compact={compact} label="Recorded instructions" title="Choose project instructions" value={choices.sourcePath ?? ""}
              options={data.sources.map(s => ({ label: s.path.replace(/^data\//, "").replace(/\.md$/, ""), value: s.path, ...(s.problem ? { detail: s.problem, disabled: true } : {}) }))}
              disabled={disabled} onSelect={sourcePath => choose({ ...choices, sourcePath })} />
            <Text style={text}>Or record instructions here: what may this mate do for {choices.name}?</Text>
            <TextInput accessibilityLabel="Project instructions" multiline value={instructions} editable={!disabled && !instructionRequest.current} onChangeText={setInstructions}
              style={{ ...text, minHeight: 100, padding: 10, borderWidth: 1, borderRadius: 8, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 }} />
            <SetupAction theme={theme} label={instructionRequest.current ? "Check exact instructions save" : "Save project instructions"} disabled={disabled || !instructions.trim() || !data.snapshot.registryDigest}
              onPress={() => { void act(async () => {
                const input = instructionRequest.current ?? { homeId: home, requestId: workflowRequestId(), registryDigest: data.snapshot.registryDigest!, name: choices.name, text: instructions.trim() };
                instructionRequest.current = input;
                const saved = await saveInstructions(input); await query.refetch();
                if (mounted.current) { choose({ ...choices, sourcePath: saved.path }); instructionRequest.current = null; setInstructions(""); }
              }); }} />
            <Text style={note}>Saving records only the instructions you wrote. It starts no mate and grants no permission beyond those instructions. Review them again before creation.</Text>
          </> : null}
          {choices.sourcePath ? <View style={{ gap: 8 }}><Text style={text}>Review the recorded permission for this project:</Text><Text selectable style={note}>{data.sources.find(s => s.path === choices.sourcePath)?.text ?? "Instructions unavailable. Refresh before continuing."}</Text></View> :
            <Text style={note}>Choose existing instructions or write and save this project's permission above. Setup waits until there is a recorded source to review.</Text>}
          {review?.reasons.map((r, i) => <Text key={i} accessibilityRole="alert" style={text}>{r}</Text>)}
          <SetupAction theme={theme} primary label={busy ? "Checking review…" : `Review ${choices.name} setup`} disabled={disabled} onPress={() => { void act(async () => {
            const parsed = ProjectSetupChoicesSchemaForUi(choices); if (!parsed) { fail("Enter positive whole-number limits and select a model, permissions and recorded instructions."); return; }
            const next = ProjectSetupPreviewSchema.parse(await preview(parsed)); if (mounted.current) setReview(next);
          }); }} />
        </View> : null}
        <Text style={note}>FirstMate keeps {data.snapshot.general.headroom} of {data.snapshot.general.slots} plugin slots. Provider availability is checked separately. Capacity changes need their own review in Help settings.</Text>
        {!choices && hostId === "local" ? <View style={{ gap: 8 }}>
          <Text style={text}>Add a local project</Text><TextInput accessibilityLabel="New project name" placeholder="Project name (no spaces)" value={folderName} editable={!busy} onChangeText={setFolderName}
            style={{ ...text, minHeight: 44, padding: 10, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, backgroundColor: theme.colors.surface1 }} />
          <SetupAction theme={theme} label="Choose another folder" disabled={disabled || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(folderName) || !data.snapshot.registryDigest} onPress={() => { void act(async () => {
            await folder({ homeId: home, registryDigest: data.snapshot.registryDigest!, name: folderName }); await refresh(); choose(null); setReview(null);
          }); }} />
          <Text style={note}>Choosing a folder only adds it to this home's project list. Setup still needs a fresh review.</Text>
        </View> : !choices ? <Text style={text}>To add a folder, open setup on this project's original computer. Remote folder identities cannot be guessed.</Text> : null}
      </> : null}
      {!batch ? <ProjectBatchPanel theme={theme} home={home} hostId={hostId} online={online} navigation={navigation} onClose={onClose} data={data} draft={batchDraft}
        onBack={() => {}} onRefresh={refresh} /> : null}
      {saved.data?.requests.filter(input => !batches.data?.some(b => b.commit.manifest.children.some(c => c.requestId === input.requestId))).map(input => {
        const project = saved.data.snapshot.projects.find(p => p.projectId === input.review.projectId), ready = !!project?.agentId && !project.reason && project.state !== "stopped";
        const recoverableCreate = saved.data.recoverableCreates.includes(input.requestId);
        return <View key={input.requestId} style={{ gap: 8 }}>
          <Text style={{ ...text, fontWeight: "600" }}>{input.review.name} · {ready ? "Ready" : project?.uncertain ? "Checking whether setup finished" : "Saved setup"}</Text>
          <Text style={note}>{input.review.profile.provider} · {input.review.profile.modeId} · {input.review.limits.supervisorTurns} total turns. Spent: {project?.sessions ?? 0} sessions, {project?.turns ?? 0} turns.</Text>
          {ready && project?.agentId && navigation ? <SetupAction theme={theme} label={`Open ${input.review.name} conversation`} onPress={() => { navigation.openAgent({ agentId: project.agentId!, ...(hostId === "local" ? {} : { serverId: hostId }) }); onClose(); }} /> : null}
          {!ready ? <SetupAction theme={theme} label={`Continue ${input.review.name} saved setup`} disabled={disabled || !data?.snapshot.enabled || !!project?.uncertain && !recoverableCreate || project?.state === "stopped" || !!project?.reason?.startsWith("Provisioning stopped")}
            onPress={() => { void act(async () => { const next = await resume({ homeId: home, requestId: input.requestId }); if (mounted.current) setResult(outcome(next, input.review.name)); await refresh(); }); }} /> : null}
          {project?.uncertain ? <Text style={text}>{recoverableCreate ? "The setup reply was lost. Continue saved setup to find the same mate and send its first message once creation is confirmed. Its model, permissions and spending limits are kept." : "Keep this identity and spent budget. Check saved setup to inspect the result; an uncertain opening stays held."}</Text> : null}
        </View>;
      })}
      {saved.isError ? <Text accessibilityRole="alert" style={text}>Saved setup couldn't be checked. Refresh before creating or continuing a mate.</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <SetupAction theme={theme} label="Check saved setup" disabled={busy || !online} onPress={() => { void act(refresh); }} />
        <SetupAction theme={theme} label="Close setup" disabled={busy} onPress={onClose} />
      </View>
    </View>
  </Modal.Content></Modal>;
}
// Validate drafts before transport so malformed input gets a readable next step.
function ProjectSetupChoicesSchemaForUi(choices: ProjectSetupChoices) {
  const result = ProjectSetupChoicesSchema.safeParse(choices); return result.success ? result.data : null;
}
export function ProjectSetupReview({ theme, data, review }: { theme: PluginTheme; data: ProjectSetupCatalog; review: ProjectSetupPreview }) {
  const r = review.review; if (!r) return null;
  const model = data.models.find(m => m.provider === r.profile.provider), mode = model?.modes.find(m => m.id === r.profile.modeId);
  const text = { color: theme.colors.foreground, fontSize: 14, lineHeight: 22 };
  return <View style={{ gap: 10 }}>
    <Text style={text}>Model: {model?.label ?? r.profile.provider} · {r.profile.provider}</Text>
    <Text style={text}>Permissions: {mode?.label ?? r.profile.modeId} ({r.profile.modeId}). {permissionPower(r.profile.modeId)} Plugin limits do not restrict tools outside the plugin.</Text>
    <Text style={text}>Session limit: {r.limits.supervisorSessions}. Total conversation turns: {r.limits.supervisorTurns}, including setup and replies.</Text>
    <Text style={text}>Project allocation: {r.budget.agents} agents and {r.budget.turns} turns. Existing spend: {r.spent.sessions} sessions and {r.spent.turns} turns.</Text>
    <Text style={text}>What starts now: one workspace, one persistent project mate and one opening message. Failed or uncertain setup keeps its identity and spent budget.</Text>
    <Text style={text}>FirstMate retains {r.capacity.generalHeadroom} of {r.capacity.slots} plugin slots. Provider quota is unknown.</Text>
    <Text style={text}>Recorded instructions: {r.source.path}. Confirm only if these instructions authorize this project's setup.</Text>
  </View>;
}
export function permissionPower(mode: string): string {
  if (["full-access", "bypassPermissions", "bypass-permissions", "danger-full-access", "yolo"].includes(mode)) return "Can read and change files and run commands with this provider's full-access permissions.";
  if (["read-only", "readOnly"].includes(mode)) return "Uses this provider's read-only permission mode. File changes require a separately reviewed permission change.";
  return "Uses this provider's permission checks for files and commands. Review its permission policy before confirming.";
}
