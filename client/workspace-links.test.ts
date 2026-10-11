import { describe, expect, it, vi } from "vitest";
import type { PluginHostSummary } from "@getpaseo/plugin/client";
import { fileCandidates, inlineTokens, lookupIn } from "./file-links";
import { fileLineDescription, parseFileLink, relativeWorkspaceFile, type FileReference } from "./workspace-links";
import { openWorkspaceForFile, resolveWorkspaceFile, type WorkspaceLinkClient, type WorkspaceLinkServices } from "./workspace-link-routing";

const options = { workspaceAware: true };
const title = "firstmate:serverId=remote&workspaceId=remote-ws";
function reference(path: string, metadata?: string): FileReference {
  const parsed = parseFileLink(path, metadata);
  if (parsed.kind !== "file") throw new Error("Expected a file reference");
  return parsed.reference;
}
const local: PluginHostSummary = { serverId: "local", label: "Desktop", status: "online" };
const remote: PluginHostSummary = { serverId: "remote", label: "Remote", status: "online" };
const workspace = (id: string, workspaceDirectory = "C:/repo", archivingAt: string | null = null) => ({ id, name: id, workspaceDirectory, archivingAt });
function fixtures() {
  const hosts: PluginHostSummary[] = [local, remote];
  const roots = { local: [workspace("local-ws"), workspace("unix", "/srv/repo")], remote: [workspace("remote-ws")] };
  const listLocal = vi.fn<WorkspaceLinkClient["workspaces"]["list"]>(async () => ({ entries: roots.local, pageInfo: { hasMore: false, nextCursor: null } }));
  const listRemote = vi.fn<WorkspaceLinkClient["workspaces"]["list"]>(async () => ({ entries: roots.remote, pageInfo: { hasMore: false, nextCursor: null } }));
  const services: WorkspaceLinkServices = { hosts: () => hosts, client: id => ({ workspaces: { list: id === "local" ? listLocal : listRemote } }) };
  const openWorkspace = vi.fn(), navigation = { openWorkspace, openAgent: vi.fn() };
  return { hosts, roots, services, listLocal, listRemote, navigation, openWorkspace };
}

describe("workspace file authoring convention", () => {
  const lookup = lookupIn({ "reports/chart one.png": "reports/chart one.png", "data/backlog.md": "data/backlog.md" });
  it("parses an angle destination and exact title, preserves line anchors, and bypasses home lookup", () => {
    const text = `[Report](<file:///C:/repo/reports/report%20one.md#L12-L18> "${title}")`;
    expect(inlineTokens(text, lookup, options)).toEqual([{ kind: "link", text: "Report", url: "file:///C:/repo/reports/report%20one.md#L12-L18", title }]);
    expect(fileCandidates(text, options)).toEqual([]);
    const file = reference("file:///C:/repo/reports/report%20one.md#L12-L18", title);
    expect(relativeWorkspaceFile("C:\\repo", file)).toBe("reports/report one.md");
    expect(fileLineDescription(file)).toBe("Lines 12–18");
  });
  it("keeps image markup as a clickable file reference without fetching bytes", () => {
    expect(inlineTokens(`![Chart](<reports/chart%20one.png> "${title}")`, lookup, options)).toEqual([{ kind: "link", text: "Chart", url: "reports/chart%20one.png", title }]);
    expect(fileCandidates(`[Chart](<reports/chart%20one.png> "${title}")`, options)).toEqual([]);
  });
  it("does not guess home for unannotated relative links, code or plain text", () => {
    expect(inlineTokens("[Backlog](data/backlog.md)", lookup, options)).toEqual([{ kind: "link", text: "Backlog", url: "data/backlog.md" }]);
    expect(inlineTokens("`data/backlog.md`", lookup, options)).toEqual([{ kind: "code", text: "data/backlog.md" }]);
    expect(inlineTokens("data/backlog.md", lookup, options)).toEqual([{ kind: "text", text: "data/backlog.md" }]);
    expect(fileCandidates("[Backlog](data/backlog.md) data/backlog.md `data/backlog.md`", options)).toEqual([]);
  });
  it("requires explicit home provenance and still depends on the confined daemon answer", () => {
    const text = '[Backlog](data/backlog.md#L12 "firstmate:home")';
    expect(fileCandidates(text, options)).toEqual(["data/backlog.md"]);
    expect(inlineTokens(text, lookup, options)).toEqual([{ kind: "file", text: "Backlog", path: "data/backlog.md", code: false }]);
    expect(inlineTokens(text, lookupIn({}), options)[0]?.kind).toBe("link");
    expect(fileCandidates('[Outside](../secrets.md "firstmate:home")', options)).toEqual([]);
    expect(fileCandidates('[Outside](C:/repo/file.md "firstmate:home")', options)).toEqual([]);
    expect(fileCandidates('[Space](<data/my%20note.md> "firstmate:home")', options)).toEqual(["data/my note.md"]);
  });
  it("leaves HTTPS external, including encoded filenames, query strings and normal titles", () => {
    expect(parseFileLink("https://example.com/report%20one.pdf?q=1#L12", title)).toEqual({ kind: "external", url: "https://example.com/report%20one.pdf?q=1#L12" });
    expect(inlineTokens('[Docs](<https://example.com/end.> "Read docs")', lookup, options)).toEqual([{ kind: "link", text: "Docs", url: "https://example.com/end.", title: "Read docs" }]);
  });
  it("does not resolve malformed provenance through a coincident home file", () => {
    const malformed = '[Chart](<reports/chart%20one.png> "firstmate:serverId=remote")';
    expect(inlineTokens(malformed, lookup, options)[0]?.kind).toBe("link");
    expect(fileCandidates(malformed, options)).toEqual([]);
    expect(() => reference("reports/chart.png", "firstmate:serverId=remote")).toThrow("exact Paseo IDs");
  });
  it("links existing absolute mentions with their original identity rather than home aliases", () => {
    const path = "C:\\repo\\file.ts:12:4";
    expect(inlineTokens(`\`${path}\``, lookup, options)).toEqual([{ kind: "link", text: path, url: path, code: true }]);
    expect(inlineTokens("At /srv/repo/file.ts.", lookup, options)).toEqual([{ kind: "text", text: "At " }, { kind: "link", text: "/srv/repo/file.ts", url: "/srv/repo/file.ts" }, { kind: "text", text: "." }]);
    expect(fileLineDescription(reference(path))).toBe("Line 12, column 4");
  });
  it("decodes IDs and filenames exactly once, keeping encoded filename hashes apart from lines", () => {
    const file = reference("reports/a%23b%3F%25%28c%29.md#L3", "firstmate:serverId=remote%20one&workspaceId=ws%2Fone");
    expect(file.provenance).toEqual({ serverId: "remote one", workspaceId: "ws/one" });
    expect(relativeWorkspaceFile("/srv/repo", file)).toBe("reports/a#b?%(c).md");
    expect(reference("reports/%252e%252e.md", title).path).toBe("reports/%2e%2e.md");
  });
  it.each(["../outside.md", "dir/../../outside.md", "%2e%2e/outside.md", "C:drive-relative.md", "file://remote/reports/a.md", "a.md?secret=1", "a.md#bad", "a.md#L0", "a.md#L12-L3", "a.md%ZZ", "a%00.md", "~/.keys", "reports/"])("refuses unsafe or unsupported target %s", path => {
    expect(() => reference(path, title)).toThrow();
  });
  it("confines Windows, Unix, drive-root and UNC paths at component boundaries", () => {
    expect(relativeWorkspaceFile("C:/REPO", reference("c:\\repo\\nested\\a.md"))).toBe("nested/a.md");
    expect(relativeWorkspaceFile("C:/repo", reference("C:/repo-other/a.md"))).toBeNull();
    expect(relativeWorkspaceFile("/srv/repo", reference("/srv/REPO/a.md"))).toBeNull();
    expect(relativeWorkspaceFile("/", reference("/a.md"))).toBe("a.md");
    expect(relativeWorkspaceFile("C:/", reference("C:/a.md"))).toBe("a.md");
    expect(relativeWorkspaceFile("\\\\share\\repo", reference("\\\\share\\repo\\a.md"))).toBe("a.md");
    expect(relativeWorkspaceFile("C:/repo", reference("C:/repo"))).toBeNull();
    expect(() => relativeWorkspaceFile("C:/repo", reference("dir/name.txt%3Astream", title))).toThrow("Windows filename");
    expect(() => relativeWorkspaceFile("/srv/repo", reference("dir\\name.md", title))).toThrow("Unix workspace");
  });
});

describe("supported workspace-only routing (API fixtures, not a live host test)", () => {
  it("targets the named remote workspace despite an identical local Windows path", async () => {
    const f = fixtures(), file = reference("file:///C:/repo/reports/a%20report.md#L12", title);
    const selection = await resolveWorkspaceFile(file, f.services);
    expect(selection.relativePath).toBe("reports/a report.md");
    expect(f.listLocal).not.toHaveBeenCalled();
    await openWorkspaceForFile(selection, f.services, f.navigation);
    expect(f.openWorkspace.mock.calls).toEqual([[{ serverId: "remote", workspaceId: "remote-ws" }]]);
    expect(f.listRemote).toHaveBeenCalledTimes(2); // Click, then button-time revalidation.
    expect(f.listRemote.mock.calls[0]?.[0]).toEqual({ page: { limit: 200 } });
  });
  it("resolves an unambiguous absolute path across complete inventories", async () => {
    const f = fixtures(), selection = await resolveWorkspaceFile(reference("/srv/repo/report.md:4"), f.services);
    expect(selection.workspace.id).toBe("unix");
    await openWorkspaceForFile(selection, f.services, f.navigation);
    expect(f.openWorkspace).toHaveBeenCalledWith({ serverId: "local", workspaceId: "unix" });
    expect(f.listRemote).toHaveBeenCalledTimes(2);
  });
  it("refuses same paths on multiple hosts and nested workspaces unless provenance is exact", async () => {
    const f = fixtures();
    await expect(resolveWorkspaceFile(reference("C:/repo/report.md"), f.services)).rejects.toThrow("multiple hosts or nested");
    f.roots.remote.length = 0;
    f.roots.local.push(workspace("nested", "C:/repo/packages/a"));
    await expect(resolveWorkspaceFile(reference("C:/repo/packages/a/report.md"), f.services)).rejects.toThrow("multiple hosts or nested");
    const selected = await resolveWorkspaceFile(reference("report.md", "firstmate:serverId=local&workspaceId=nested"), f.services);
    expect(selected.relativePath).toBe("report.md");
  });
  it("will not resolve a relative path, missing host, prefix match, or outside explicit root", async () => {
    const f = fixtures();
    await expect(resolveWorkspaceFile(reference("reports/a.md"), f.services)).rejects.toThrow("provenance");
    await expect(resolveWorkspaceFile(reference("a.md", "firstmate:serverId=missing&workspaceId=remote-ws"), f.services)).rejects.toThrow("host is missing");
    await expect(resolveWorkspaceFile(reference("a.md", "firstmate:serverId=remote&workspaceId=remote"), f.services)).rejects.toThrow("workspace is missing");
    await expect(resolveWorkspaceFile(reference("C:/elsewhere/a.md", title), f.services)).rejects.toThrow("outside the named workspace");
    await expect(resolveWorkspaceFile(reference("/unknown/a.md"), f.services)).rejects.toThrow("No known workspace");
    expect(f.openWorkspace).not.toHaveBeenCalled();
  });
  it("refuses offline inventories for bare paths but explicit local identity can still work", async () => {
    const f = fixtures(); f.hosts[1] = { ...remote, status: "offline" };
    await expect(resolveWorkspaceFile(reference("/srv/repo/a.md"), f.services)).rejects.toThrow("offline");
    await expect(resolveWorkspaceFile(reference("a.md", title), f.services)).rejects.toThrow("offline");
    expect(f.listRemote).not.toHaveBeenCalled();
    expect((await resolveWorkspaceFile(reference("a.md", "firstmate:serverId=local&workspaceId=unix"), f.services)).workspace.id).toBe("unix");
  });
  it("matches exact IDs in unfiltered pages and refuses repeated, absent, inconsistent or nonprogressing cursors", async () => {
    const f = fixtures();
    f.listRemote.mockResolvedValueOnce({ entries: [workspace("other")], pageInfo: { hasMore: true, nextCursor: "page-2" } });
    expect((await resolveWorkspaceFile(reference("a.md", title), f.services)).workspace.id).toBe("remote-ws");
    expect(f.listRemote.mock.calls[1]?.[0]?.page).toEqual({ limit: 200, cursor: "page-2" });
    for (const pageInfo of [{ hasMore: true, nextCursor: "repeat" }, { hasMore: true, nextCursor: null }, { hasMore: false, nextCursor: "inconsistent" }]) {
      f.listRemote.mockResolvedValue({ entries: [workspace("remote-ws")], pageInfo });
      await expect(resolveWorkspaceFile(reference("a.md", title), f.services)).rejects.toThrow("inventory is incomplete");
    }
    f.listRemote.mockResolvedValue({ entries: [], pageInfo: { hasMore: true, nextCursor: "empty" } });
    await expect(resolveWorkspaceFile(reference("a.md", title), f.services)).rejects.toThrow("inventory is incomplete");
  });
  it("rechecks missing/archiving targets, moved roots, disconnects and cancellation before navigation", async () => {
    for (const change of ["missing", "archiving", "root", "offline", "cancel"] as const) {
      const f = fixtures(), selection = await resolveWorkspaceFile(reference("reports/a.md", title), f.services);
      if (change === "missing") f.roots.remote.length = 0;
      if (change === "archiving") f.roots.remote[0]!.archivingAt = "2026-10-11";
      if (change === "root") f.roots.remote[0]!.workspaceDirectory = "C:/moved";
      if (change === "offline") f.hosts[1] = { ...remote, status: "offline" };
      if (change === "cancel") expect(await openWorkspaceForFile(selection, f.services, f.navigation, () => false)).toBe(false);
      else await expect(openWorkspaceForFile(selection, f.services, f.navigation)).rejects.toThrow();
      expect(f.openWorkspace).not.toHaveBeenCalled();
    }
  });
  it("does not leak failed API/connection details or fall back to another host", async () => {
    const f = fixtures(); f.listRemote.mockRejectedValue(new Error("password=secret"));
    await expect(resolveWorkspaceFile(reference("a.md", title), f.services)).rejects.toThrow("inventory could not be read");
    f.services.client = () => { throw new Error("token=secret"); };
    await expect(resolveWorkspaceFile(reference("a.md", title), f.services)).rejects.toThrow("connection is unavailable");
    expect(f.listLocal).not.toHaveBeenCalled();
  });
  it("refuses changed host inventories and unavailable navigation without mutating a workspace", async () => {
    const f = fixtures();
    f.listLocal.mockImplementationOnce(async () => { f.hosts.push({ serverId: "new", label: "New", status: "online" }); return { entries: f.roots.local, pageInfo: { hasMore: false, nextCursor: null } }; });
    await expect(resolveWorkspaceFile(reference("/srv/repo/a.md"), f.services)).rejects.toThrow("host inventory changed");
    const selection = await resolveWorkspaceFile(reference("a.md", title), f.services);
    await expect(openWorkspaceForFile(selection, f.services, undefined)).rejects.toThrow("cannot open workspaces");
    expect(f.openWorkspace).not.toHaveBeenCalled();
  });
});
