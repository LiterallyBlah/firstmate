/** Only host APIs are stubbed; the panel, chat, rows, cards and watch content are real. */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TextInput as NativeTextInput } from "react-native-web";
export { FlatList, ScrollView } from "react-native-web";
import { icons } from "lucide-react";
import { fleet, snapshot, entries } from "./fixtures";

export const defineRpc = (contract) => contract;
export const defineSettings = (contract) => contract;
export const TextInput = NativeTextInput;
export const Icon = ({ name, size, color }) => {
  const Glyph = icons[name === "Trash2" ? "Trash" : name] ?? icons.Circle;
  return <Glyph size={size} color={color} aria-hidden style={{ flexShrink: 0 }} />;
};
const toast = {
  show() {},
  error(message) {
    window.fixtureErrors.push(message);
  },
};
export const useToast = () => toast;
export const openExternalUrl = async () => {};
export const useHosts = () => [];
export const getPaseoClient = () => { throw new Error("No host API in this fixture"); };
export const copyText = async () => {};
export const useRevealedText = (text) => text;
export const SettingsSection = ({ children }) => <div>{children}</div>;
export const SettingsSelect = ({ label, hint, value, options, onValueChange, disabled }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    {label}
    <small>{hint}</small>
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
      style={{ padding: 8 }}
    >
      {options?.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </label>
);
export const SettingsRow = ({ label, hint, children }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <div>{label}</div>
    {hint ? <small>{hint}</small> : null}
    {children}
  </div>
);
export const SettingsSwitch = SettingsSection;

const calls = (window.fixtureCalls = []);
window.fixtureSnapshot = snapshot;
window.fixtureErrors = [];
const rpc = new Map();
export function useRpc(contract) {
  if (!rpc.has(contract.name))
    rpc.set(contract.name, async (input) => {
      calls.push({ name: contract.name, input });
      switch (contract.name) {
        case "firstmate.config.read":
          return {
            config: { migration: window.fixtureMigration ?? null, previousMateIds: window.fixtureHistory ?? [] },
          };
        case "firstmate.mate.targets":
          return {
            targets: [
              {
                provider: "claude/opus",
                label: "Claude Opus · claude",
                modes: [{ id: "bypassPermissions", label: "Bypass permissions" }],
                thinking: [{ id: "max", label: "Max" }],
              },
              {
                provider: "codex/gpt",
                label: "GPT · codex",
                modes: [{ id: "safe", label: "Read only" }],
                thinking: [{ id: "high", label: "High" }],
              },
            ],
          };
        case "firstmate.mate.migrate":
          if (window.fixtureFailMigration) {
            window.fixtureMigration = {
              sourceId: fleet.mate.id,
              agentId: "replacement",
              target: input.target,
              handoffPath: "data/handoffs/replacement.md",
            };
            throw new Error(
              "Handover paused: provider unavailable. The saved migration and queued notes are kept. Use Recover migration.",
            );
          }
          window.fixtureHistory = [fleet.mate.id];
          window.fixtureMigration = null;
          return { agentId: "replacement", workspaceId: "home" };
        case "firstmate.fleet.load":
          return {
            ...structuredClone(fleet),
            mate: { ...fleet.mate, status: window.fixtureMateStatus ?? fleet.mate.status },
          };
        case "firstmate.remotes.read":
          return structuredClone(snapshot);
        case "firstmate.files.find":
          return { files: {} };
        case "firstmate.mate.seen":
          return { cleared: false };
        case "firstmate.suggestion.remove":
          fleet.suggestions = fleet.suggestions.filter((s) => s.label !== input.label || s.prompt !== input.prompt);
          return { suggestions: fleet.suggestions };
        case "firstmate.watch.toggle":
          fleet.watches.find((w) => w.name === input.name).enabled = input.enabled;
          return {};
        case "firstmate.remote-crew.logs":
          return {
            text: "Worker log: completing the chapter controls",
            readAt: "2026-10-08T12:00:00.000Z",
          };
        default:
          return {};
      }
    });
  return rpc.get(contract.name);
}
export function useSettings(contract) {
  const [values, setValues] = useState(() => contract.schema.parse({ chatWidthFraction: 0.45 }));
  const [revision, setRevision] = useState(1);
  const save = useCallback(async (next) => {
    window.fixtureSettings = next;
    setValues(next);
    setRevision((r) => r + 1);
    return true;
  }, []);
  return { status: "ready", values, revision, save, saveError: null };
}
const paseo = {
  agents: {
    ref: () => ({
      timeline: {
        refetch: async () => ({
          entries,
          agent: {
            ...fleet.mate,
            pendingPermissions: [],
            lastUsage: {
              contextWindowUsedTokens: 34000,
              contextWindowMaxTokens: 200000,
            },
          },
          hasOlder: false,
          error: null,
        }),
        subscribe: () => () => {},
      },
      respondToPermission: async () => {},
    }),
  },
};
export const usePaseo = () => paseo;

function ModalView({ title, open, onOpenChange, children }) {
  const body = useRef(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    body.current?.querySelector("button")?.focus();
    const key = (event) => {
      if (event.key === "Escape") onOpenChange(false);
      if (event.key !== "Tab") return;
      const focusable = [...body.current.querySelectorAll('button,[tabindex="0"],textarea')];
      const first = focusable[0],
        last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#0008",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10,
      }}
    >
      <div
        ref={body}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          background: window.fixtureTheme?.colors.surface1 ?? "#1e221f",
          color: window.fixtureTheme?.colors.foreground ?? "#f1f3f1",
          border: `1px solid ${window.fixtureTheme?.colors.border ?? "#303531"}`,
          borderRadius: 12,
          width: "min(620px, 92vw)",
          maxHeight: "85vh",
          overflow: "auto",
          padding: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 16,
            justifyContent: "space-between",
            marginBottom: 20,
          }}
        >
          <strong>{title}</strong>
          <button aria-label="Close" onClick={() => onOpenChange(false)}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
export const Modal = Object.assign(ModalView, {
  Content: ({ children }) => <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>{children}</div>,
});
