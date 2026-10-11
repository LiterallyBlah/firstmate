/** Real plugin renderer beside an installed native callback fixture. No daemon or disk reads. */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Markdown } from "../../client/markdown";
import { lookupIn, inlineTokens, fileCandidates } from "../../client/file-links";
import { theme } from "../board-list/theme";
import { nativeClick, externalOpener, navigationFactory } from "./.generated/native-runtime.js";

const path = "C:/repo/reports/report.md";
const workspaceRoot = "C:/repo";
const source = `[Workspace report](${path}#L12)\n[Workspace image](C:/repo/reports/screen.png)\n[Encoded report](file:///C:/repo/reports/report%20one.md#L12)\n[Home backlog](data/backlog.md)\n[HTTPS docs](https://paseo.sh/docs)`;
window.linkEvidence = { external: [], home: [], native: [], pluginNavigation: [], observations: [] };
const files = lookupIn({ "data/backlog.md": "data/backlog.md" });
window.linkEvidence.tokens = source.split("\n").map(text => inlineTokens(text, files));
window.linkEvidence.candidates = fileCandidates(source);

function App() {
  const [host, setHost] = useState("local-fixture");
  const [result, setResult] = useState("Click a link to compare callback results.");
  function firstMate(url) {
    const before = window.linkEvidence.external.length;
    void externalOpener(url).then(() => {
      const opened = window.linkEvidence.external.length > before;
      window.linkEvidence.observations.push({ source: "firstmate", host, url, opened });
      setResult(opened ? `External HTTP(S) opener: ${url}` : `FirstMate: external opener ignored ${url}. No workspace or file tab opened.`);
    });
  }
  function native(url) {
    const context = {
      configRef: { current: {
        serverId: host, workspaceRoot,
        onOpenWorkspaceFile(target, disposition) {
          window.linkEvidence.native.push({ serverId: host, workspaceId: "workspace-fixture", target, disposition });
          setResult(`Native callback fixture: ${host} / workspace-fixture → ${target.path}${target.lineStart ? ':' + target.lineStart : ''}`);
        },
      } },
      getDirectorySuggestions: async () => ({ entries: [], error: null }),
    };
    nativeClick({ source: { href: url }, disposition: "preferred", context, queryClient: {}, formatNoFileFoundMessage: token => token });
  }
  function workspaceOnly() {
    const navigation = navigationFactory("local-fixture", {
      browserAvailable: false,
      openWorkspace(input) { window.linkEvidence.pluginNavigation.push(input); setResult(JSON.stringify(input)); },
      openAgent() {},
    });
    // Deliberately invalid extra field: the installed public bridge drops it.
    navigation.openWorkspace({ serverId: host, workspaceId: "workspace-fixture", target: { kind: "file", path } });
  }
  return <main style={{ background: theme.colors.surface0, color: theme.colors.foreground, minHeight: "100vh", padding: 24, fontFamily: "Segoe UI,sans-serif" }}>
    <h2>Workspace file links · API gap reproduction</h2>
    <p>All host IDs and files below are fixtures. No daemon connected; no file bytes read.</p>
    <label>Conversation host <select aria-label="Conversation host" value={host} onChange={event => setHost(event.target.value)}>
      <option value="local-fixture">Local fixture</option><option value="remote-fixture">Remote fixture (same Windows path)</option>
    </select></label>
    <div style={{ display: "flex", gap: 32, marginTop: 24, flexWrap: "wrap" }}>
      <section style={{ flex: "1 1 300px", padding: 16, border: `1px solid ${theme.colors.border}` }}>
        <h3>FirstMate chat renderer (real component)</h3>
        <Markdown source={source} theme={theme} files={files} onOpenLink={firstMate} onOpenFile={path => { window.linkEvidence.home.push(path); setResult(`Home Files callback: ${path}`); }} />
      </section>
      <section style={{ flex: "1 1 300px", padding: 16, border: `1px solid ${theme.colors.border}` }}>
        <h3>Native conversation callback fixture</h3>
        <p>Installed resolver + private click handler; pane callback recorded, not rendered.</p>
        <Markdown source={source} theme={theme} onOpenLink={native} />
      </section>
    </div>
    <button style={{ marginTop: 24 }} onClick={workspaceOnly}>Probe supported workspace navigation</button>
    <p role="status" style={{ padding: 16, background: theme.colors.surface2, overflowWrap: "anywhere" }}>{result}</p>
    <p>The public workspace bridge has no file target. A new plugin preview or host API requires a scope decision.</p>
  </main>;
}
createRoot(document.getElementById("root")).render(<App />);
