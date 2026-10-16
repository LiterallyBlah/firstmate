import { usePaseo } from "@getpaseo/plugin/client";
import { useEffect, useRef, useState } from "react";

import type { TimelinePage, TimelineEntry } from "./transcript-rows";
import { mergeTimelineHistory } from "./timeline-history";

/** Wait for a pause in the stream before re-reading, so one burst is one read. */
const QUIET_MS = 300;
/** A stream that never pauses is still re-read this often. */
const CEILING_MS = 1500;
type BeforeHistoryCommit = (prefix: readonly TimelineEntry[], hasOlder: boolean) => void;

export interface AgentTimeline {
  entries: TimelineEntry[];
  /**
   * The agent as of the last read. Every timeline page carries it, and a
   * permission request arrives as a stream event like any other, so this is
   * how a question the agent just asked reaches the pane without a poll.
   */
  agent: TimelinePage["agent"];
  /** Whether the daemon has entries before the ones read — the tail is `limit` long. */
  hasOlder: boolean;
  error: string | null;
  loading: boolean;
  loadingOlder: boolean;
  loadOlder(beforeCommit?: BeforeHistoryCommit): void;
}

/**
 * The daemon's timeline for one agent, re-read shortly after any stream event.
 *
 * Re-reading rather than appending stream deltas keeps the provider's own
 * merging — reasoning chunks and tool lifecycle updates arrive already folded
 * — so the pane never shows fragments. One read is in flight at a time; events
 * during it coalesce into a single follow-up, and the ceiling keeps a turn
 * that streams without pause from freezing the pane.
 */
export function useAgentTimeline(agentId: string | null, revision = "", limit = 150): AgentTimeline {
  const paseo = usePaseo();
  /** The current subscription's re-read, for the revision effect below. */
  const reread = useRef<() => void>(() => {});
  const older = useRef<(beforeCommit?: BeforeHistoryCommit) => void>(() => {});
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [agent, setAgent] = useState<TimelinePage["agent"]>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  useEffect(() => {
    if (agentId === null) {
      setEntries([]);
      setAgent(null);
      setHasOlder(false);
      setError(null);
      setLoading(false);
      setLoadingOlder(false);
      return;
    }
    const timeline = paseo.agents.ref(agentId).timeline;
    let kept: TimelinePage | null = null;
    let keepHistory = false;
    let alive = true;
    let inFlight = false;
    let queued = false;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    let ceiling: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);

    function clearTimers(): void {
      clearTimeout(quiet);
      clearTimeout(ceiling);
      quiet = undefined;
      ceiling = undefined;
    }

    // An async function, not an async arrow: Hermes evaluates an async arrow
    // in an eval'd bundle to `undefined`.
    async function load(before = false, beforeCommit?: BeforeHistoryCommit): Promise<void> {
      if (inFlight) {
        if (!before) queued = true;
        return;
      }
      if (before && (!kept?.hasOlder || kept.startCursor === null)) return;
      inFlight = true;
      if (before) setLoadingOlder(true);
      try {
        const page = await timeline.refetch({
          direction: before ? "before" : "tail",
          limit,
          projection: "projected",
          ...(before && kept?.startCursor ? { cursor: kept.startCursor } : {}),
        });
        if (!alive) return;
        if (page.error) throw new Error(page.error);
        if (before && (page.staleCursor || page.reset || page.gap || page.epoch !== kept?.epoch)) {
          kept = null;
          keepHistory = false;
          queued = true;
          return;
        }
        if (before) {
          keepHistory = true;
          const first = kept?.entries[0]?.seqStart ?? Infinity;
          beforeCommit?.(
            page.entries.filter((entry) => entry.seqEnd < first),
            page.hasOlder,
          );
        }
        kept = keepHistory ? mergeTimelineHistory(kept, page) : page;
        setEntries(kept.entries);
        if (page.agent !== null) setAgent(page.agent);
        setHasOlder(kept.hasOlder);
        setError(page.error ?? null);
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        inFlight = false;
        if (alive) {
          setLoading(false);
          setLoadingOlder(false);
          if (queued) {
            queued = false;
            void load();
          }
        }
      }
    }

    function refresh(): void {
      clearTimers();
      void load();
    }

    function schedule(): void {
      clearTimeout(quiet);
      quiet = setTimeout(refresh, QUIET_MS);
      if (ceiling === undefined) ceiling = setTimeout(refresh, CEILING_MS);
    }

    reread.current = schedule;
    older.current = (beforeCommit) => {
      void load(true, beforeCommit);
    };
    void load();
    const unsubscribe = timeline.subscribe(schedule);
    return () => {
      alive = false;
      clearTimers();
      unsubscribe();
      older.current = () => {};
    };
  }, [paseo, agentId, limit]);

  /**
   * A second way in, for whatever the stream did not say: the caller passes
   * something that changes when the agent does (the board's poll of it), and
   * a change is a re-read. A question the agent asked in the instant between
   * a read and its own tool call's last event is still seen within a poll.
   */
  useEffect(() => {
    if (revision !== "") reread.current();
  }, [revision]);

  return {
    entries,
    agent,
    hasOlder,
    error,
    loading,
    loadingOlder,
    loadOlder: (beforeCommit) => older.current(beforeCommit),
  };
}
