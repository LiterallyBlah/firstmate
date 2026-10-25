/** Lifecycle-owned backlog observation; no Paseo handle, agent turn or mounted UI required. */
import { createHash, randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { FirstmateConfigSchema } from "../shared/fleet";
import { quarantinesSource, type NeedsYouSnapshot, type NeedsYouTarget } from "../shared/needs-you";
import { observeNeedsYou, type HostCatalog, type NeedsYouDetection } from "./needs-you-detect";
import {
  mutateNeedsYou,
  needsYouSnapshot,
  reconcileNeedsYou,
  type NeedsYouMutation,
} from "./needs-you-ledger";
import {
  canonicalDecisionHome,
  NeedsYouStore,
  normalizedHome,
  recoverDecisionHome,
} from "./needs-you-store";
import { serialized } from "./serialize";
import { resolveHome } from "./config";
import { dataPath } from "./data-dir";
import { withDecisionOptions } from "./decision-options";
import type { SupervisionStatus } from "../shared/supervision";
import { decisionOwner } from "../shared/workflow-plans";
import { planDecisionReady } from "../shared/plan-readiness";

/** Read-only opt-in composition seam for S05/S06. No polling/wake/send or legacy mutation. */
export function withScopedNeedsYou(snapshot: NeedsYouSnapshot, status: SupervisionStatus): NeedsYouSnapshot {
  if (snapshot.homeId !== null && snapshot.homeId !== status.homeId) throw new Error("Scoped and legacy decision homes differ.");
  const plans = status.plans.map(p => p.plan), problems = [...status.problems];
  const rows = status.decisions.filter(d => d.state !== "superseded").flatMap(decision => {
    const plan = status.plans.find(p => p.scopeId === decision.ownerScopeId && p.plan.definition.id === decision.planId)?.plan;
    const node = plan?.definition.nodes.find(n => n.id === decision.nodeId);
    if (plan && node && decisionOwner(plan, node) === "firstmate") return [];
    const owner = status.scopes.find(s => s.id === decision.ownerScopeId), binding = status.bindings.find(b => b.scopeId === decision.ownerScopeId);
    const backend = status.backends.find(b => b.planId === decision.planId);
    const held = status.operationHolds.some(h => h.scopeId === decision.ownerScopeId && h.planId === decision.planId && h.state === "held" && h.operations.includes("decision.answer"));
    const ready = status.freshness === "current" && backend?.backend === "scoped" && backend.state === "active" && owner?.kind === "plan" && owner.mode === "scoped" && ["active", "held", "transferring"].includes(owner.state) &&
      !held && !!plan && !!node && decision.state === "pending" && planDecisionReady(plan, node, plans);
    return [{ decision, ready, waitingFor: decision.state === "answered" ? null : ready ? null : "Waiting for current plan evidence or ownership reconciliation.",
      ownerEpoch: binding?.state === "active" ? binding.epoch : null }];
  });
  const holds = status.operationHolds.filter(h => h.state === "held");
  const holdPlans = new Set(holds.map(h => h.planId));
  const count = rows.filter(r => r.ready).length + holdPlans.size;
  const priorHoldPlans = new Set(snapshot.scopedHolds?.map(h => h.planId) ?? []);
  const priorCount = (snapshot.scopedDecisions?.filter(r => r.ready).length ?? 0) + priorHoldPlans.size;
  const pending = status.outbox.filter(o => o.kind === "decision.answer" && o.state === "pending").length;
  if (status.freshness !== "current") problems.push("Scoped decision inventory is incomplete; counts are a lower bound.");
  return { ...snapshot, homeId: snapshot.homeId ?? status.homeId, scopedDecisions: rows, scopedSequence: status.sequence, scopedProblems: problems, scopedHolds: holds, scopedComplete: status.freshness === "current", scopedPendingAnswerCount: pending,
    actionCount: snapshot.actionCount === null ? count || null : snapshot.actionCount - priorCount + count,
    pendingAnswerCount: snapshot.pendingAnswerCount === null ? null : snapshot.pendingAnswerCount - (snapshot.scopedPendingAnswerCount ?? 0) + pending };
}

/** The board tolerates broken config with defaults; durable identities must not. */
export async function readConfiguredDecisionHome(): Promise<string> {
  return resolveHome(
    FirstmateConfigSchema.parse(
      JSON.parse(await readFile(dataPath("config.json"), "utf8")),
    ),
  );
}

export type BacklogObservation = (
  | { markdown: string; problem: null }
  | { markdown: null; problem: string }
) & { sequence?: number };
// Order source reads before asynchronous fleet assembly; an old fleet response must
// not undo a newer detector observation. This is process-local, never a durable ID.
let readSequence = 0;
export async function readDecisionBacklog(
  home: string,
): Promise<BacklogObservation> {
  const path = join(home, "data", "backlog.md");
  const sequence = ++readSequence;
  try {
    const before = await stat(path);
    if (!before.isFile() || before.size > 2 * 1024 * 1024)
      return {
        sequence,
        markdown: null,
        problem:
          "Backlog is not a text file within the 2 MiB observation limit.",
      };
    const markdown = await readFile(path, "utf8");
    const after = await stat(path);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      before.ino !== after.ino
    ) {
      return {
        sequence,
        markdown: null,
        problem: "Backlog changed while it was being read.",
      };
    }
    return { sequence, markdown, problem: null };
  } catch (error) {
    return {
      sequence,
      markdown: null,
      problem:
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "Backlog source is missing."
          : "Backlog source is unreadable.",
    };
  }
}

interface ServiceOptions {
  root: string;
  home: () => Promise<string>;
  catalog: () => Promise<HostCatalog>;
  enabled?: () => boolean;
  now?: () => number;
  pollMs?: number;
  stableMs?: number;
  readSource?: (home: string) => Promise<BacklogObservation>;
  store?: (root: string, home: string) => NeedsYouStore;
}

interface HomeState {
  store: NeedsYouStore;
  candidate: { fingerprint: string; since: number } | null;
  snapshot: NeedsYouSnapshot | null;
  sequence: number;
}

export class NeedsYouService {
  private readonly lock = `firstmate.needs-you:${randomUUID()}`;
  private readonly states = new Map<string, HomeState>();
  private readonly aliases = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private watcher: FSWatcher | null = null;
  private watchedHome: string | null = null;
  private running = false;
  private stopped = false;
  private pollPending: Promise<NeedsYouSnapshot> | null = null;
  private lastSnapshot: NeedsYouSnapshot | null = null;
  private lastCatalog: HostCatalog = null;
  private readonly now: () => number;
  readonly readSource: (home: string) => Promise<BacklogObservation>;

  constructor(private readonly options: ServiceOptions) {
    this.now = options.now ?? Date.now;
    this.readSource = options.readSource ?? readDecisionBacklog;
  }

  private enabled() {
    return this.options.enabled?.() ?? process.env.FIRSTMATE_NEEDS_YOU !== "0";
  }

  start() {
    if (this.running || this.stopped) return;
    this.running = true;
    void this.read();
    this.timer = setInterval(() => {
      void this.read();
    }, this.options.pollMs ?? 5000);
    this.timer.unref?.();
  }

  async stop() {
    this.stopped = true;
    this.running = false;
    if (this.timer !== null) clearInterval(this.timer);
    if (this.debounce !== null) clearTimeout(this.debounce);
    this.watcher?.close();
    this.watcher = null;
    await serialized(this.lock, async () => undefined);
  }

  private unavailable(status: "disabled" | "unknown", problems: string[] = []) {
    return needsYouSnapshot(null, {
      status,
      asOf: null,
      checkedAt: this.now(),
      problems,
    });
  }

  private sourceUnavailable(): NeedsYouSnapshot {
    const problems = [
      "The configured decision source is unavailable or changed.",
    ];
    return this.lastSnapshot === null
      ? this.unavailable("unknown", problems)
      : {
          ...this.lastSnapshot,
          freshness: {
            ...this.lastSnapshot.freshness,
            status: "stale",
            checkedAt: this.now(),
            problems,
          },
        };
  }

  private async catalog(): Promise<HostCatalog> {
    try {
      this.lastCatalog = await this.options.catalog();
    } catch {
      /* Worker/catalog outage cannot erase a locally recorded hold or its known host ID. */
    }
    return this.lastCatalog;
  }

  /** Coalesce timer ticks; a slow filesystem must not build an unbounded queue. */
  read(): Promise<NeedsYouSnapshot> {
    if (this.pollPending) return this.pollPending;
    const pending = serialized(this.lock, async () => {
      if (!this.enabled() || this.stopped) return this.unavailable("disabled");
      try {
        const home = await this.options.home();
        const [source, catalog] = await Promise.all([
          this.readSource(home),
          this.catalog(),
        ]);
        return await withDecisionOptions(home, await this.observeLocked(home, source, catalog));
      } catch {
        // Config failures cannot select a different home or manufacture a zero.
        return this.sourceUnavailable();
      }
    });
    this.pollPending = pending;
    void pending.finally(() => {
      if (this.pollPending === pending) this.pollPending = null;
    });
    return pending;
  }

  /** The fleet passes the exact file read used for its cards. */
  observe(
    home: string,
    source: BacklogObservation,
    catalog: HostCatalog,
  ): Promise<NeedsYouSnapshot> {
    return serialized(this.lock, async () => {
      if (!this.enabled() || this.stopped) return this.unavailable("disabled");
      try {
        const configured = await this.options.home();
        if (
          normalizedHome(home) !== normalizedHome(configured) &&
          (await canonicalDecisionHome(home)) !==
            (await canonicalDecisionHome(configured))
        )
          return this.sourceUnavailable();
      } catch {
        return this.sourceUnavailable();
      }
      return withDecisionOptions(home, await this.observeLocked(home, source, catalog));
    });
  }

  async mutate(
    target: NeedsYouTarget,
    mutation: NeedsYouMutation,
  ): Promise<NeedsYouSnapshot> {
    return serialized(this.lock, async () => {
      if (!this.enabled() || this.stopped)
        throw new Error("Needs-you observation is disabled.");
      const home = await this.options.home();
      const [source, catalog] = await Promise.all([
        this.readSource(home),
        this.catalog(),
      ]);
      const snapshot = await this.observeLocked(home, source, catalog);
      if (
        snapshot.freshness.status !== "fresh" ||
        snapshot.homeId !== target.homeId ||
        snapshot.requests.some(request => request.id === target.id &&
          quarantinesSource(snapshot.quarantined ?? [], request.source))
      )
        throw new Error(
          "The decision source is stale or the home changed. Refresh before acting.",
        );
      const state = this.states.get(await canonicalDecisionHome(home))!;
      // Re-read the store under its per-home lock, including when another caller committed first.
      const ledger = await state.store.transact((previous) =>
        mutateNeedsYou(previous, target, mutation, this.now()),
      );
      state.snapshot = needsYouSnapshot(ledger, snapshot.freshness);
      this.lastSnapshot = state.snapshot;
      return withDecisionOptions(home, state.snapshot);
    });
  }

  private async observeLocked(
    home: string,
    source: BacklogObservation,
    catalog: HostCatalog,
  ): Promise<NeedsYouSnapshot> {
    let canonical: string;
    let observedAlias: string | undefined;
    try {
      canonical = await canonicalDecisionHome(home);
      observedAlias = normalizedHome(home);
      this.aliases.set(observedAlias, canonical);
    } catch {
      const recovered =
        this.aliases.get(normalizedHome(home)) ??
        (await recoverDecisionHome(this.options.root, home));
      if (recovered === null)
        return this.unavailable("unknown", ["FirstMate home is unavailable."]);
      canonical = recovered;
      const known = this.states.get(canonical);
      if (!known) {
        // Read an existing ledger even when the canonical directory disappeared across restart.
        // Store initialization is forbidden here: the absent home is not a new namespace.
        const store = new NeedsYouStore(this.options.root, canonical);
        try {
          await stat(store.path);
        } catch {
          return this.unavailable("unknown", [
            "FirstMate home is unavailable.",
          ]);
        }
        this.states.set(canonical, {
          store,
          candidate: null,
          snapshot: null,
          sequence: 0,
        });
      }
      source = { markdown: null, problem: "FirstMate home is unavailable." };
    }
    this.watchHome(canonical);
    let state = this.states.get(canonical);
    if (!state) {
      state = {
        store:
          this.options.store?.(this.options.root, canonical) ??
          new NeedsYouStore(this.options.root, canonical),
        candidate: null,
        snapshot: null,
        sequence: 0,
      };
      this.states.set(canonical, state);
    }
    if (source.sequence !== undefined) {
      if (source.sequence <= state.sequence && state.snapshot !== null)
        return state.snapshot;
      state.sequence = source.sequence;
    }
    const now = this.now();
    const detection: NeedsYouDetection =
      source.markdown === null
        ? { valid: false, problems: [source.problem], sources: [] }
        : observeNeedsYou(source.markdown, catalog);
    const problems = [...detection.problems];
    // Hash exactly what was read plus resolved identities. Tag/runtime edits can delay
    // observation but never revise a gate; changed host mappings require stability too.
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([source.markdown, detection.sources]))
      .digest("hex");
    let stable = false;
    if (!detection.valid) state.candidate = null;
    else if (state.candidate?.fingerprint !== fingerprint)
      state.candidate = { fingerprint, since: now };
    else
      stable = now - state.candidate.since >= (this.options.stableMs ?? 2000);
    if (detection.valid && !stable)
      problems.push("Waiting for a stable backlog observation.");
    try {
      const ledger = await state.store.transact((previous) => {
        return stable && detection.valid
          ? reconcileNeedsYou(previous, detection, now)
          : previous;
      }, observedAlias);
      const fresh = stable && detection.valid;
      if (fresh) for (const row of ledger.quarantined) {
        if (!problems.includes(row.problem)) problems.push(row.problem);
      }
      state.snapshot = needsYouSnapshot(ledger, {
        status: fresh
          ? "fresh"
          : ledger.initializedAt === null
            ? "unknown"
            : "stale",
        asOf: fresh
          ? now
          : (state.snapshot?.freshness.asOf ?? ledger.observedAt),
        checkedAt: now,
        problems,
      });
    } catch {
      state.snapshot = needsYouSnapshot(state.store.lastGood, {
        status:
          state.store.lastGood?.initializedAt != null ? "stale" : "unknown",
        asOf:
          state.snapshot?.freshness.asOf ??
          state.store.lastGood?.observedAt ??
          null,
        checkedAt: now,
        problems: [
          ...problems,
          "Decision ledger could not be read or committed; retained last durable state.",
        ],
      });
    }
    this.lastSnapshot = state.snapshot;
    return state.snapshot;
  }

  private watchHome(home: string) {
    if (
      !this.running ||
      this.stopped ||
      (this.watchedHome === home && this.watcher !== null)
    )
      return;
    this.watcher?.close();
    this.watcher = null;
    this.watchedHome = home;
    try {
      // Watch the directory: an atomic replacement does not strand a file-inode watch.
      const watcher = watch(
        join(home, "data"),
        { persistent: false },
        (_event, filename) => {
          if (filename !== null && String(filename) !== "backlog.md") return;
          if (this.debounce !== null) clearTimeout(this.debounce);
          this.debounce = setTimeout(() => {
            this.debounce = null;
            void this.read();
          }, 2000);
          this.debounce.unref?.();
        },
      );
      watcher.on("error", () => {
        watcher.close();
        if (this.watcher === watcher) this.watcher = null;
      });
      this.watcher = watcher;
    } catch {
      /* Periodic reads retry even when the directory/watch is unavailable. */
    }
  }
}
