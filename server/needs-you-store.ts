/** One atomic snapshot includes both state and its outbox: never publish half a transition. */
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  emptyLedger,
  NeedsYouLedgerSchema,
  type NeedsYouLedger,
} from "./needs-you-ledger";
import { serialized } from "./serialize";

export function normalizedHome(path: string): string {
  const absolute = resolve(path);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}
export async function canonicalDecisionHome(path: string) {
  return normalizedHome(await realpath(path));
}

/** Recover only a previously recorded identity; a missing home cannot create one. */
export async function recoverDecisionHome(root: string, home: string) {
  const alias = normalizedHome(home);
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return null;
  }
  const matches = new Set<string>();
  for (const entry of entries) {
    if (!/^[a-f0-9]{64}$/.test(entry)) continue;
    let ledger: NeedsYouLedger;
    try {
      ledger = NeedsYouLedgerSchema.parse(
        JSON.parse(await readFile(join(root, entry, "ledger.json"), "utf8")),
      );
    } catch {
      // Its aliases are unknown: it could be another match for a reused path.
      return null;
    }
    if (
      createHash("sha256").update(ledger.canonicalHome).digest("hex") ===
        entry &&
      (ledger.canonicalHome === alias || ledger.homeAliases.includes(alias))
    )
      matches.add(ledger.canonicalHome);
  }
  // A reused alias may have referred to several homes. Never guess which one is absent.
  return matches.size === 1 ? [...matches][0]! : null;
}

export async function writeDecisionLedger(
  path: string,
  ledger: NeedsYouLedger,
) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(ledger)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export class NeedsYouStore {
  readonly path: string;
  lastGood: NeedsYouLedger | null = null;
  constructor(
    readonly root: string,
    readonly home: string,
    readonly write = writeDecisionLedger,
  ) {
    this.path = join(
      root,
      createHash("sha256").update(home).digest("hex"),
      "ledger.json",
    );
  }

  async transact(
    change: (ledger: NeedsYouLedger) => NeedsYouLedger,
    observedAlias?: string,
  ): Promise<NeedsYouLedger> {
    return serialized(this.path, async () => {
      await mkdir(this.root, { recursive: true });
      let created = false;
      try {
        await mkdir(dirname(this.path));
        created = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      // Existing directory + missing/corrupt ledger is never mistaken for first enablement.
      const previous = created
        ? emptyLedger(randomUUID(), this.home)
        : NeedsYouLedgerSchema.parse(
            JSON.parse(await readFile(this.path, "utf8")),
          );
      if (previous.canonicalHome !== this.home)
        throw new Error("Decision ledger home identity mismatch.");
      this.lastGood = previous;
      let next = change(previous);
      if (
        observedAlias !== undefined &&
        !next.homeAliases.includes(observedAlias)
      ) {
        // Commit recovery metadata with the state/outbox, without a second crash boundary.
        // This is not a visible decision change and does not advance the snapshot version.
        next = { ...next, homeAliases: [...next.homeAliases, observedAlias] };
      }
      if (created || next !== previous)
        await this.write(this.path, NeedsYouLedgerSchema.parse(next));
      this.lastGood = next;
      return next;
    });
  }
}
