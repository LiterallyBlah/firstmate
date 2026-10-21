/**
 * How the board is drawn, for this daemon's clients: a host settings document
 * the app reads and writes on its own. None of it means anything to the
 * daemon, which is why it is not in `config.json` — see "Which side owns a
 * persisted value" in the root AGENTS.md.
 */
import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

import { DEFAULT_DECK_SETTING } from "./deck-rpc";
import { COLUMN_IDS } from "./fleet";

export const POLL_SECONDS = [3, 5, 10, 30] as const;

/** How much room the board gives its cards: Comfortable, the default, or Compact for more of them at once. */
export const BOARD_DENSITIES = ["comfortable", "compact"] as const;
export type BoardDensity = (typeof BOARD_DENSITIES)[number];

export const CREW_VIEWS = ["list", "board"] as const;
export type CrewView = (typeof CREW_VIEWS)[number];
export type HomePane = "board" | "files" | "deck" | "plans";

export const displaySettings = defineSettings({
  id: "display",
  scope: "host",
  version: 1,
  schema: z.object({
    /** Global setting for the fleet scene; per-project selection is a future resolver concern. */
    deckSetting: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .default(DEFAULT_DECK_SETTING),
    /** Deck workers only; backlog cards remain visible in List and Board. */
    hideDisconnectedWorkers: z.boolean().default(true),
    /** Grouped task rows by default; the wide board remains available. */
    crewView: z.enum(CREW_VIEWS).default("list"),
    /** Home's right pane; Board and List share the board destination and crewView. */
    homePane: z.enum(["board", "files", "deck", "plans"]).default("board"),
    /** Board columns, in the order the captain arranged them. Unknown ids are dropped when read. */
    columnOrder: z.array(z.string()).default([...COLUMN_IDS]),
    /** Columns folded down to a narrow strip. */
    collapsedColumns: z.array(z.string()).default([]),
    /**
     * The chat pane's share of the surface's width. A share rather than pixels,
     * because it was chosen against one window and has to survive another.
     */
    chatWidthFraction: z.number().min(0.2).max(0.8).default(0.36),
    chatCollapsed: z.boolean().default(false),
    boardCollapsed: z.boolean().default(false),
    pollSeconds: z.number().int().min(1).max(120).default(5),
    /** The board's host tab: `all`, `local` (this machine), or a saved remote host's serverId. */
    hostTab: z.string().default("all"),
    /** List and Board both require every selected plain item tag. */
    tagFilter: z.array(z.string()).max(12).default([]),
    /** The board's spacing. A card at rest shows the same few things either way. */
    density: z.enum(BOARD_DENSITIES).default("comfortable"),
  }),
});

export type DisplaySettings = z.infer<typeof displaySettings.schema>;
