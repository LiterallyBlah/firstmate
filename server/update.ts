import { createHash } from "node:crypto";
import { UPDATE_REFRESH_MS, type UpdateStatus } from "../shared/update";
import {
  installedSource,
  latestRevision,
  type InstalledSource,
} from "./update-source";
import { message, TEMPLATES } from "./templates";

export const UNAVAILABLE: UpdateStatus = {
  state: "unavailable",
  explanation:
    "FirstMate's configured source or running revision could not be verified. The next check will retry.",
};
const sameSource = (a: InstalledSource, b: InstalledSource) =>
  a.path === b.path && a.identity === b.identity && a.revision === b.revision;

/** One startup snapshot, bounded checks shared by all screens, and one request per verified identity. */
export class UpdateService {
  private running: Promise<InstalledSource | null>;
  private pending: Promise<UpdateStatus> | null = null;
  private status: UpdateStatus = {
    state: "checking",
    explanation: "Checking FirstMate's configured source.",
  };
  private checkedAt = -Infinity;
  private available: { token: string; text: string } | null = null;
  private sent = new Set<string>();
  private attempted = new Set<string>();
  private requesting = false;

  constructor(
    private read = installedSource,
    private latest = latestRevision,
    private now = Date.now,
  ) {
    // Captured on plugin startup; never replace this with a later checkout HEAD.
    this.running = this.read().catch(() => null);
  }

  check(force = false): Promise<UpdateStatus> {
    if (this.pending) return this.pending;
    if (!force && this.now() - this.checkedAt < UPDATE_REFRESH_MS)
      return Promise.resolve(this.status);
    this.pending = this.detect()
      .catch(() => UNAVAILABLE)
      .then((status) => {
        this.status = status;
        this.checkedAt = this.now();
        return status;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  private async detect(): Promise<UpdateStatus> {
    this.available = null;
    const running = await this.running;
    if (!running)
      return {
        state: "unavailable",
        explanation:
          "FirstMate's running revision could not be identified at startup. Reload the plugin to retry.",
      };
    const before = await this.read();
    if (!sameSource(running, before))
      return {
        state: "unavailable",
        explanation:
          "FirstMate's installation changed. Reload the plugin to verify the running revision.",
      };
    const latest = await this.latest(before);
    if (!sameSource(before, await this.read())) return UNAVAILABLE;
    if (latest.installedNewer)
      return {
        state: "current",
        explanation:
          "The running FirstMate version is newer than the latest version from its configured source.",
      };
    if (latest.revision === running.revision)
      return {
        state: "current",
        explanation:
          "The running FirstMate revision matches the latest revision from its configured source.",
      };
    const label = /^[0-9a-f]{40,64}$/.test(latest.revision)
      ? latest.revision.slice(0, 8)
      : latest.revision;
    const token = createHash("sha256")
      .update(JSON.stringify([running, latest]))
      .digest("hex");
    this.available = {
      token,
      text: await message(TEMPLATES.updateRequest, {
          source: JSON.stringify(running.description),
          identity: running.identity,
        running: running.revision,
        latest: label,
        immutable: latest.immutable,
      }),
    };
    const requested = this.attempted.has(token);
    return {
      state: "available",
      latest: label,
      token,
      requested,
      explanation: this.sent.has(token)
        ? `Installation of FirstMate ${label} was requested. The running revision has not changed yet.`
        : requested
          ? `Delivery of the FirstMate ${label} request could not be confirmed. Check the chat before requesting it again.`
          : `FirstMate ${label} is available from its configured source. Ask the first mate to install this revision.`,
    };
  }

  async request(
    token: string,
    send: (text: string, beforeSend: () => Promise<void>) => Promise<string>,
  ): Promise<{ status: UpdateStatus; agentId: string | null }> {
    if (this.requesting) return { status: this.status, agentId: null };
    this.requesting = true;
    try {
      // A click always revalidates; a newer target needs a new explicit click.
      const status = await this.check(true);
      if (
        status.state !== "available" ||
        this.available?.token !== token ||
        this.attempted.has(token)
      )
        return { status, agentId: null };
      const agentId = await send(this.available.text, async () => {
        // Lifecycle work may have delayed delivery after the click's first check.
        const final = await this.check(true);
        if (
          final.state !== "available" ||
          final.token !== token ||
          this.attempted.has(token)
        )
          throw new Error(
            "FirstMate's update status changed before delivery. Check it again.",
          );
        // A lost reply may mean the send was accepted. Never send this request twice in that case.
        this.attempted.add(token);
        this.status = {
          ...final,
          requested: true,
          explanation: `Delivery of the FirstMate ${final.latest} request could not be confirmed. Check the chat before requesting it again.`,
        };
      });
      this.sent.add(token);
      this.status = {
        ...status,
        requested: true,
        explanation: `Installation of FirstMate ${status.latest} was requested. The running revision has not changed yet.`,
      };
      return { status: this.status, agentId };
    } finally {
      this.requesting = false;
    }
  }
}
