/**
 * A first mate's reply, inline: bold, code, links and file references. Pure, so what is found
 * and what is drawn are the same walk and can be tested without a renderer.
 *
 * Finding a path is only half of it: whether `data/backlog.md` is a file in
 * the home is the daemon's to say (`firstmate.files.find`), so the chat first
 * collects every candidate a message could link (`fileCandidates`), asks, and
 * then tokenizes again with the answer (`inlineTokens`). Anything the daemon
 * does not vouch for — outside the home, missing, a folder — stays text in legacy mode.
 * Workspace-aware chat preserves original file identity for click-time routing,
 * and asks the home RPC only about explicitly titled firstmate:home references.
 */

import { MAX_FILE_PATH_LENGTH } from "../shared/files";
import { inlineTexts, parseMarkdown } from "./markdown-parse";
import { absoluteFileTarget, homeLinkCandidate } from "./workspace-links";

/** Bold, inline code and links, in one pass; everything else stays as written. */
const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|!?\[[^\]\n]*\]\((?:<[^<>\n]*>|[^()\s]+)(?:[ \t]+"[^"\n]*")?[ \t]*\)|https?:\/\/[^\s)<>]+)/g;
const MARKDOWN_LINK = /^!?\[([^\]]*)\]\((?:<([^<>\n]*)>|([^()\s]+))(?:[ \t]+"([^"\n]*)")?[ \t]*\)$/;
export interface FileLinkOptions { workspaceAware?: boolean }

/** A run of plain text that could be a path: whatever brackets, quotes, commas and spaces leave. A source only; each walk makes its own. */
const WORD = /[^\s()[\]{}<>"'`,;]+/g;
/** Sentence punctuation after a path, which is not part of it. */
const TRAILING_PUNCTUATION = /[.:!?]+$/;
/** `:12` or `:12:4` after a path — a line, which the Files view cannot go to, so it is linked but not looked up. */
const LINE_SUFFIX = /(?::\d+){1,2}$/;
/** A URL scheme, as in a Markdown link's target: not a file. */
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; url: string; title?: string; code?: boolean }
  /** A file in the home; `code` when it was written as inline code, which keeps that look. */
  | { kind: "file"; text: string; path: string; code: boolean };

/** Home-relative path of the file a candidate names, or null when it names none. */
export type FileLookup = (candidate: string) => string | null;

/**
 * The path `text` would name, without a trailing line number, or null when it
 * does not look like one: a path has a `/` in it or ends in an extension, so
 * `data/scout-x/report.md`, `watches/pr-watch` and `AGENTS.md` are, and
 * `backlog` is not. Nor is anything longer than the daemon will look up.
 */
export function pathCandidate(text: string): string | null {
  const path = text.replace(LINE_SUFFIX, "");
  if (path === "" || path.length > MAX_FILE_PATH_LENGTH || /\s/.test(path) || (SCHEME.test(path) && !path.startsWith("/"))) return null;
  if (path.includes("/")) return /[\w-]/.test(path) ? path : null;
  return /^[\w.@+-]*\w\.[a-zA-Z0-9]{1,10}$/.test(path) ? path : null;
}

/** Plain text split into what stays text and the files in it that `lookup` knows. */
function plainTokens(text: string, lookup: FileLookup, options: FileLinkOptions): InlineToken[] {
  const tokens: InlineToken[] = [];
  let pending = "";
  let at = 0;
  const words = new RegExp(WORD.source, "g");
  let match: RegExpExecArray | null;
  while ((match = words.exec(text)) !== null) {
    const start = match.index;
    const word = match[0].replace(TRAILING_PUNCTUATION, "");
    const workspacePath = options.workspaceAware === true && absoluteFileTarget(word);
    const candidate = pathCandidate(word);
    const path = options.workspaceAware === true || candidate === null ? null : lookup(candidate);
    if (path === null && !workspacePath) continue;
    pending += text.slice(at, start);
    if (pending !== "") tokens.push({ kind: "text", text: pending });
    tokens.push(workspacePath ? { kind: "link", text: word, url: word } : { kind: "file", text: word, path: path!, code: false });
    pending = "";
    at = start + word.length;
  }
  pending += text.slice(at);
  if (pending !== "") tokens.push({ kind: "text", text: pending });
  return tokens;
}

/**
 * One line of Markdown as tokens. Bold is left alone; inline code, a
 * Markdown link's target and plain text are checked for files. A plain URL's
 * trailing punctuation is dropped from what it opens, not from what it shows.
 */
export function inlineTokens(text: string, lookup: FileLookup, options: FileLinkOptions = {}): InlineToken[] {
  // Splitting on a capturing group interleaves plain text (even indexes) with the tokens it matched.
  return text.split(INLINE).flatMap((part, index): InlineToken[] => {
    if (part === "") return [];
    if (index % 2 === 0) return plainTokens(part, lookup, options);
    if (part.startsWith("`")) {
      const code = part.slice(1, -1);
      if (options.workspaceAware === true && absoluteFileTarget(code.trim())) return [{ kind: "link", text: code, url: code.trim(), code: true }];
      if (options.workspaceAware === true) return [{ kind: "code", text: code }];
      const candidate = pathCandidate(code.trim());
      const path = candidate === null ? null : lookup(candidate);
      return [path === null ? { kind: "code", text: code } : { kind: "file", text: code, path, code: true }];
    }
    if (part.startsWith("**") || part.startsWith("__")) return [{ kind: "bold", text: part.slice(2, -2) }];
    const link = MARKDOWN_LINK.exec(part);
    if (link !== null) {
      const target = link[2] ?? link[3] ?? "";
      const title = link[4];
      const candidate = title === "firstmate:home" ? homeLinkCandidate(target) : title?.startsWith("firstmate:") || options.workspaceAware === true ? null : pathCandidate(target);
      const path = candidate === null ? null : lookup(candidate);
      const label = link[1] === "" ? target : (link[1] ?? target);
      if (path !== null) return [{ kind: "file", text: label, path, code: false }];
      return [{ kind: "link", text: label, url: target, ...(title === undefined ? {} : { title }) }];
    }
    const url = part.replace(/[.,;:]+$/, "");
    return [{ kind: "link", text: part, url }];
  });
}

/**
 * Every path `source` mentions that could be linked, once per mention, in
 * order. Only the text the renderer draws inline is walked, so a path in a
 * fenced code block, which is never linked, is never asked about.
 */
function mentions(source: string, options: FileLinkOptions): string[] {
  const found: string[] = [];
  const collect: FileLookup = (candidate) => {
    found.push(candidate);
    return null;
  };
  for (const text of inlineTexts(parseMarkdown(source))) {
    for (const line of text.split("\n")) inlineTokens(line, collect, options);
  }
  return found;
}

/** Every path `source` could link, in order of first mention, each once — what to ask the daemon about. */
export function fileCandidates(source: string, options: FileLinkOptions = {}): string[] {
  return [...new Set(mentions(source, options))];
}

/**
 * The candidates of a whole conversation, oldest message first, each once and
 * at its latest mention — within a reply as much as across replies — keeping
 * the `max` most recently mentioned, so a file named early and again just now
 * is not the one left out.
 */
export function recentCandidates(messages: readonly string[], max: number, options: FileLinkOptions = {}): string[] {
  const order = new Set<string>();
  for (const message of messages) {
    for (const candidate of mentions(message, options)) {
      order.delete(candidate);
      order.add(candidate);
    }
  }
  return [...order].slice(-max);
}

/** A lookup over the daemon's answer. */
export function lookupIn(files: Readonly<Record<string, string>>): FileLookup {
  return (candidate) => (Object.prototype.hasOwnProperty.call(files, candidate) ? (files[candidate] ?? null) : null);
}
