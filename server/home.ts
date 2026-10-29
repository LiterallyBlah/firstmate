/**
 * The first mate's home: the directory it runs in, and the only place it
 * writes. FirstMate called this the distro — a charter and a set of records
 * that turn a general-purpose agent into a first mate — and it is the same
 * here, minus the scripts.
 *
 *     <home>/AGENTS.md           the charter, rendered from data/charter.md on every launch
 *     <home>/data/charter.md     the charter's source; follows the plugin until the captain edits it
 *     <home>/data/captain.md     standing orders; the captain's, never overwritten
 *     <home>/data/projects.md    the project registry
 *     <home>/data/backlog.md     every work item; the board reads it
 *     <home>/data/suggestions.md what the captain might do next; the board's buttons
 *     <home>/data/learnings.md
 *     <home>/data/opening.md     a new first mate's first message; the captain's, never overwritten
 *     <home>/watches/            scripts the plugin runs on a schedule (watch-files.ts, watches.ts)
 *     <home>/projects/           clones for projects with no local checkout
 *     <home>/icon.svg            the icon Paseo's sidebar shows for the home
 *
 * Every file starts as its namesake in the plugin's `templates/` folder, which
 * is laid out the same way (`templates.ts`). The charter, remote helper and
 * remote access guide follow the plugin. Other records are written only when
 * missing, so a relaunch never loses a record the first mate has been keeping.
 *
 * The icon is Lucide's ship — the plugin's own sidebar icon, ISC-licensed — in
 * white on a blue rounded square. It is a file, not something the plugin sets:
 * Paseo looks for an icon in every project's folder on its own (`favicon.svg`,
 * `icon.svg`, `icon.png` and more, square and 32 KB at most; an SVG counts as
 * square) and shows it unless the captain uploaded one in the project's
 * settings.
 *
 * There is no `CLAUDE.md`. Claude Code and Codex both read `AGENTS.md` from
 * the working directory, and a `CLAUDE.md` importing it risks the charter
 * twice over in every turn's context; the launch prompt asks a harness that
 * reads neither to open the file itself.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { FirstmateConfigSchema, type BacklogItem, type FirstmateConfig, type Project, type Suggestion } from "../shared/fleet";
import { parseBacklog } from "./backlog";
import { renderCharter } from "./charter";
import { syncCharter } from "./charter-file";
import { FileChangedError, readTextFile, replaceTextIfUnchanged, type WriteHooks } from "./files";
import { parseSuggestions, withoutSuggestion } from "./suggestions";
import { TEMPLATES, fill, readTemplate, withoutNotes, type TemplatePath } from "./templates";
import { seedWatches } from "./watch-files";
import { remoteQueue } from "./remotes";
import { paseoHome } from "./data-dir";
import { newAction, observedWrite, type RecordOrigin } from "./receipts";
import { renderLaunchTool } from "./launch-tool";

/** The home's records: written from their templates when missing, and the captain's or the first mate's after. */
const RECORDS: readonly TemplatePath[] = [
  TEMPLATES.captain,
  TEMPLATES.projects,
  TEMPLATES.learnings,
  TEMPLATES.backlog,
  TEMPLATES.suggestions,
  TEMPLATES.opening,
  TEMPLATES.icon,
  TEMPLATES.remoteHosts,
  TEMPLATES.remoteFollow,
  TEMPLATES.artReady,
  TEMPLATES.land,
  TEMPLATES.deployGo,
  TEMPLATES.panelReviewer,
];

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Whether it wrote: false when the file was already there. */
async function writeIfMissing(path: string, content: string): Promise<boolean> {
  try {
    await writeFile(path, content, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return false;
  }
}

/** A plugin write into the home, for the receipt journal's record ledger; just the write while it is off. */
function homeWrite(home: string, path: string, origin: RecordOrigin, content: string): Promise<void> {
  return observedWrite({ absolute: join(home, path), path }, origin, () => writeFile(join(home, path), content, "utf8"), { after: content });
}

/**
 * Creates whatever of the home is missing, brings `data/charter.md` in step with the plugin's charter
 * (`charter-file.ts`) and the built-in watches with theirs (`watch-files.ts`), and renders `AGENTS.md`
 * from the charter with the current config.
 */
export async function prepareHome(home: string, config: FirstmateConfig, origin: RecordOrigin = newAction("prepare-home")): Promise<void> {
  await mkdir(join(home, "data"), { recursive: true });
  await mkdir(join(home, "projects"), { recursive: true });
  await mkdir(join(home, "tools"), { recursive: true });
  await mkdir(join(home, "data", "templates"), { recursive: true });
  const charter = await syncCharter(home, undefined, origin);
  await homeWrite(home, TEMPLATES.agents, origin,
    await renderCharter({ home, crewProvider: config.crewProvider, crewModeId: config.crewModeId }, charter.template));
  for (const record of RECORDS) {
    const content = await readTemplate(record);
    await observedWrite({ absolute: join(home, record), path: record }, origin, () => writeIfMissing(join(home, record), content), { before: null, after: content });
  }
  // The helper is plugin-owned transport code, rather than a captain's record.
  await homeWrite(home, TEMPLATES.remoteHelper, origin, fill(await readTemplate(TEMPLATES.remoteHelper), { remoteQueueJson: JSON.stringify(remoteQueue()) }));
  await homeWrite(home, TEMPLATES.remoteAccess, origin, await readTemplate(TEMPLATES.remoteAccess));
  await homeWrite(home, TEMPLATES.watchHelper, origin, await readTemplate(TEMPLATES.watchHelper));
  await homeWrite(home, TEMPLATES.roleHelper, origin, fill(await readTemplate(TEMPLATES.roleHelper), {
    paseoHomeJson: JSON.stringify(paseoHome()), homeJson: JSON.stringify(home),
    configSchemaJson: JSON.stringify(z.toJSONSchema(FirstmateConfigSchema, { io: "input" })),
  }));
  await homeWrite(home, TEMPLATES.launchHelper, origin, await renderLaunchTool(home));
  await homeWrite(home, TEMPLATES.workflowHelper, origin, await readTemplate(TEMPLATES.workflowHelper));
  if (process.env.FIRSTMATE_PROJECT_MATES === "1") {
    await homeWrite(home, TEMPLATES.projectHelper, origin, await readTemplate(TEMPLATES.projectHelper));
    await homeWrite(home, TEMPLATES.projectGuide, origin, await readTemplate(TEMPLATES.projectGuide));
  }
  if (process.env.FIRSTMATE_MAINTENANCE === "1") {
    await homeWrite(home, TEMPLATES.maintenanceHelper, origin, await readTemplate(TEMPLATES.maintenanceHelper));
    await homeWrite(home, TEMPLATES.maintenanceGuide, origin, await readTemplate(TEMPLATES.maintenanceGuide));
  }
  await homeWrite(home, TEMPLATES.backlogLint, origin, await readTemplate(TEMPLATES.backlogLint));
  await homeWrite(home, TEMPLATES.workflowGuide, origin, await readTemplate(TEMPLATES.workflowGuide));
  await homeWrite(home, TEMPLATES.recallHelper, origin, await readTemplate(TEMPLATES.recallHelper));
  await homeWrite(home, TEMPLATES.recallGuide, origin, await readTemplate(TEMPLATES.recallGuide));
  await seedWatches(home, origin);
}

/** Whether a launch has ever prepared this home. */
export function isHomeReady(home: string): Promise<boolean> {
  return exists(join(home, TEMPLATES.agents));
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * A new first mate's first message: `data/opening.md` without its HTML comments, which are notes to the
 * captain. A missing or empty file gives the template's wording, so a first mate is never started with
 * nothing to act on.
 */
export async function readOpening(home: string): Promise<string> {
  const text = withoutNotes((await readOptional(join(home, TEMPLATES.opening))) ?? "");
  return text === "" ? withoutNotes(await readTemplate(TEMPLATES.opening)) : text;
}

export async function readBacklog(home: string): Promise<BacklogItem[]> {
  const markdown = await readOptional(join(home, "data", "backlog.md"));
  return markdown === null ? [] : parseBacklog(markdown);
}

export async function readSuggestions(home: string): Promise<Suggestion[]> {
  const markdown = await readOptional(join(home, TEMPLATES.suggestions));
  return markdown === null ? [] : parseSuggestions(markdown);
}

/** How many times a removal starts over when the first mate rewrites the file under it. */
export const REMOVE_ATTEMPTS = 3;

/**
 * Takes one suggestion out of `data/suggestions.md`, leaving every other byte as it was, and answers
 * with the suggestions left. One the file no longer has — the first mate rewrote it since the board
 * looked — is not an error: nothing is written.
 *
 * The write is confined to the home, staged in a temporary file and renamed into place, and refused
 * if the file no longer reads as it did (`replaceTextIfUnchanged`), checked again just before the
 * rename. A refusal is the first mate rewriting its list at the same moment, and the removal starts
 * over from what it wrote. A write of its that lands between that last check and the rename is still
 * lost; see `stageAndReplace`.
 */
export async function removeSuggestion(home: string, target: Suggestion, hooks: WriteHooks = {}): Promise<Suggestion[]> {
  for (let attempt = 1; ; attempt++) {
    let file: Awaited<ReturnType<typeof readTextFile>>;
    try {
      file = await readTextFile(home, TEMPLATES.suggestions);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    if (file.content === null) throw new Error(`${TEMPLATES.suggestions} is not a text file the board can edit.`);
    const next = withoutSuggestion(file.content, target);
    if (next === null) return parseSuggestions(file.content);
    try {
      await replaceTextIfUnchanged(home, TEMPLATES.suggestions, file.content, next, hooks);
      return parseSuggestions(next);
    } catch (error) {
      if (!(error instanceof FileChangedError)) throw error;
      if (attempt >= REMOVE_ATTEMPTS) {
        throw new Error("The first mate kept rewriting its suggestions while this one was being removed. Try again.");
      }
    }
  }
}

/**
 * `- <name> [<mode> +yolo] - <location> - <description>`, as the charter asks.
 * The line splits on ` - ` first, and only the name part is read for the
 * bracket, so a Markdown link or a `[WIP]` in the description stays text. The
 * bracket, the location and the description are each optional, and a line
 * that is not a list item is not a project.
 */
export function parseProjects(markdown: string): Project[] {
  const projects: Project[] = [];
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const item = /^\s*[-*]\s+(?!\[[ xX]\])(.+)$/.exec(line);
    if (item === null) continue;
    const [head = "", ...rest] = (item[1] ?? "").split(/\s+[-–—]\s+/).map((part) => part.trim());
    const bracket = /^(.*?)\s*\[([^\]]*)\]\s*$/.exec(head);
    const name = (bracket?.[1] ?? head).replace(/[`*]/g, "").trim();
    if (name === "" || name.startsWith("(") || /\s/.test(name)) continue;
    const flags = (bracket?.[2] ?? "").split(/\s+/).filter((flag) => flag !== "");
    const parts = rest.filter((part) => part !== "");
    projects.push({
      name,
      mode: flags.find((flag) => !flag.startsWith("+")) ?? null,
      yolo: flags.includes("+yolo"),
      location: parts[0] ?? null,
      description: parts.slice(1).join(" - ") || null,
    });
  }
  return projects;
}

export async function readProjects(home: string): Promise<Project[]> {
  const markdown = await readOptional(join(home, "data", "projects.md"));
  return markdown === null ? [] : parseProjects(markdown);
}
