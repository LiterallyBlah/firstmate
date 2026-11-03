/** Folder mapping only ("Add project"): checked registration of a local folder in the project list. No admission, session or work. */
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { z } from "zod";
import { addProjectFolder, ProjectFolderSchema } from "../shared/project-folders";
import { normalizedName } from "../shared/supervision-projects";
import type { SupervisionStatus } from "../shared/supervision";
import type { ProjectRuntime } from "./project-runtime";
import { digest } from "./submissions";
import { refuse } from "./supervision-effects";
import { readTextFile, replaceTextIfUnchanged } from "./files";
import { selectProjectFolder } from "./project-folder-picker";
import { requireNoMigration } from "./mate";
import { parseProjects } from "./home";

export class ProjectFolderService {
  constructor(readonly projects: ProjectRuntime, private readonly options: { folder?: () => Promise<string | null> } = {}) {}
  private async context(homeId: string, observed?: SupervisionStatus) {
    const c = await this.projects.inputs(observed);
    if (c.status.homeId !== homeId) refuse("STALE", "FirstMate's home changed. Close setup and open it again on this home.");
    requireNoMigration(c.config);
    return c;
  }
  private folderIssues(c: Awaited<ReturnType<ProjectRuntime["inputs"]>>) {
    const norm = (path: string) => process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
    return c.catalog.rows.filter(r => !r.directory && r.location && isAbsolute(r.location)).map(r => {
      const retained = c.status.projects?.projects.some(p => [p.name, ...p.aliases].some(n => normalizedName(n) === normalizedName(r.name)) ||
        p.owner && norm(p.owner.directory) === norm(r.location!)) || c.status.commands.some(command => {
          const review = command.result.projectSetup?.review;
          return review && [review.name, ...review.aliases].some(n => normalizedName(n) === normalizedName(r.name));
        });
      return { name: r.name, location: r.location!, rowDigest: digest({ name: r.name, location: r.location }),
        canReplace: !retained && isAbsolute(r.location!) && ["Project directory is unavailable; identity was not guessed.", "Project location is not a directory."].includes(r.reason ?? "") &&
          !c.status.problems.length && !c.problems.length && ["current", "uninitialized"].includes(c.status.freshness) };
    });
  }
  async folder(raw: z.infer<typeof ProjectFolderSchema>) {
    const input = ProjectFolderSchema.parse(raw);
    const c = await this.context(input.homeId);
    if (c.catalog.digest !== input.registryDigest) refuse("STALE", "Projects changed. Refresh before choosing a folder.");
    const checkReplacement = (current: typeof c) => {
      if (!input.replace) return;
      const issue = this.folderIssues(current).find(r => r.name === input.name && r.location === input.replace!.location && r.rowDigest === input.replace!.rowDigest);
      if (!issue?.canReplace) refuse("HELD", "This folder cannot be replaced. Restore the original folder for a retained project; refresh projects before reviewing an unadmitted correction.");
    };
    checkReplacement(c);
    let picked: string | null;
    try { picked = await (this.options.folder?.() ?? selectProjectFolder()); }
    catch { return refuse("UNSUPPORTED", "The folder picker couldn't open on this computer. Choose a registered project, or restore access to the computer's folder picker and try again."); }
    if (!picked) return this.projects.read();
    const directory = await realpath(picked);
    if (!(await stat(directory)).isDirectory() || /[\r\n]|\s[-–—]\s/.test(directory)) refuse("HELD", "Choose a local folder whose name can be recorded safely in the project list.");
    return this.projects.withRegistry(input.homeId, async () => {
      const fresh = await this.context(input.homeId), norm = (v: string) => process.platform === "win32" ? resolve(v).toLowerCase() : resolve(v);
      if (fresh.catalog.digest !== input.registryDigest) refuse("STALE", "Projects changed while the picker was open. Refresh and choose the folder again.");
      checkReplacement(fresh);
      if (fresh.catalog.rows.some(r => (!input.replace && normalizedName(r.name) === normalizedName(input.name)) || r.directory === norm(directory)) ||
        fresh.status.projects?.projects.some(p => p.owner && norm(p.owner.directory) === norm(directory))) refuse("CONFLICT", "This name or folder is already registered. Choose its existing project or a different name.");
      const file = await readTextFile(fresh.home, "data/projects.md");
      if (file.content === null || digest(file.content) !== input.registryDigest) refuse("STALE", "The project list changed. Refresh and try again.");
      checkReplacement(await this.context(input.homeId));
      // Registration is identity only: no delivery mode, yolo or authority is inferred.
      let content = `${file.content.trimEnd()}\n- ${input.name} - ${directory}\n`;
      if (input.replace) {
        let replaced = 0;
        const visibleLines = file.content.replace(/<!--[^]*?-->/g, comment => comment.replace(/[^\r\n]/g, " ")).split(/(?<=\n)/);
        content = file.content.split(/(?<=\n)/).map((line, index) => {
          const row = parseProjects(visibleLines[index]!)[0];
          if (!row || row.name !== input.name || row.location !== input.replace!.location) return line;
          const start = line.indexOf(row.location, line.search(/\s+[-–—]\s+/));
          if (start < 0) refuse("STALE", "The original folder row changed. Refresh before correcting it.");
          replaced++; return line.slice(0, start) + directory + line.slice(start + row.location.length);
        }).join("");
        if (replaced !== 1) refuse("HELD", "The original folder row is ambiguous. Restore one unambiguous project entry before correcting it.");
      }
      await replaceTextIfUnchanged(fresh.home, "data/projects.md", file.content, content);
      return this.projects.read();
    });
  }
}
export function registerProjectFolders(server: Pick<PluginServerContext, "handle">, projects: ProjectRuntime) {
  const service = new ProjectFolderService(projects);
  server.handle(addProjectFolder, i => service.folder(i));
}
