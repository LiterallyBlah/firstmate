import type { DecisionSource } from "../shared/needs-you";
import { fileCandidates, type FileLookup } from "./file-links";

export function decisionMaterialPaths(source: DecisionSource): string[] {
  return [...new Set([source.specPath, source.notesPath, source.reportPath].filter((path): path is string => !!path))];
}
/** Preview only a named draft, never an arbitrary spec/report substituted for it. */
export function namedDraft(ask: string, lookup: FileLookup): string | null {
  return fileCandidates(ask).filter(path => /(?:draft|reply|comment)[^/]*\.(?:md|txt|markdown)$/i.test(path))
    .map(lookup).find((path): path is string => path !== null) ?? null;
}
export function draftPreview(content: string): string {
  return content.trim().split(/\r?\n/).slice(0, 4).join("\n").slice(0, 700);
}
export function githubMaterialLabel(url: string): string {
  const github = /^https?:\/\/github\.com\/[^/]+\/[^/]+\/(discussions|pull|issues)\/(\d+)(?:[/?#]|$)/i.exec(url);
  return github ? `${github[1] === "discussions" ? "Discussion" : github[1] === "pull" ? "PR" : "Issue"} #${github[2]}` : url;
}
