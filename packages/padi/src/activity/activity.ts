/**
 * Server-derived activity feed: recent repos cd'd into and recent agents
 * DETECTED LIVE (kind + the live process's allowlisted argv). Server is the sole
 * writer; clients subscribe read-only via `activity.get`.
 *
 * ## The invariant
 *
 * **PTY output is a sensor. Nothing that executes may read a value whose
 * provenance is PTY bytes.** A recent-agent row is recorded from the agent
 * detection that already owns the tile (an OS-derived session identity plus the
 * foreground process's argv), never from the shell's `OSC 633;E` mark — so the
 * "typed launch line" the palette shows is rendered by the agent registry from
 * structured facts, not replayed from captured text.
 *
 * Both feeds are bounded MRU lists. Eviction policy lives here, not in the
 * publisher or the contract — adding a new feed (e.g. recent worktrees) is
 * a single-file change.
 */

import fs from "node:fs";
import type {
  ActivityFeed,
  RecentAgent,
  RecentRepo,
} from "@kolu/padi-client/surface";
import { log } from "../log.ts";
import { padiSurfaceCtx } from "../padiSurfaceCtx.ts";

const MAX_RECENT_REPOS = 20;
const MAX_RECENT_AGENTS = 10;

/** Check if a path exists on disk. */
function existsOnDisk(path: string): boolean {
  try {
    fs.accessSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Upsert `item` into a bounded MRU list, sort most-recently-seen first,
 *  and trim to `max` entries. Returns the new list. Pure — callers
 *  persist and notify.
 *
 *  Genuinely pure now, not merely documented as such: the input is the DECODED
 *  cell value, which is `readonly`, and the old in-place `list[idx] = …` /
 *  `push` / `sort` mutated the very array the cell still held — a write the
 *  surface never saw. It copies first. */
function upsertMru<T>(
  list: readonly T[],
  item: T,
  keyOf: (t: T) => string,
  timeOf: (t: T) => number,
  max: number,
): T[] {
  const key = keyOf(item);
  const next = [...list];
  const idx = next.findIndex((x) => keyOf(x) === key);
  if (idx !== -1) next[idx] = item;
  else next.push(item);
  next.sort((a, b) => timeOf(b) - timeOf(a));
  return next.slice(0, max);
}

/** Get recent repos, most-recently-seen first. Filters out repos that no
 *  longer exist on disk and back-writes the trimmed list so subsequent
 *  reads don't re-stat. */
function getRecentRepos(): readonly RecentRepo[] {
  const feed = padiSurfaceCtx.cells.activityFeed.get();
  const live = feed.recentRepos.filter((r) => existsOnDisk(r.repoRoot));
  if (live.length < feed.recentRepos.length) {
    padiSurfaceCtx.cells.activityFeed.set({ ...feed, recentRepos: live });
  }
  return live;
}

/** Get recent agents, most-recently-seen first. */
function getRecentAgents(): readonly RecentAgent[] {
  return padiSurfaceCtx.cells.activityFeed.get().recentAgents;
}

/** Get the full activity feed snapshot. */
export function getActivityFeed(): ActivityFeed {
  return {
    recentRepos: getRecentRepos(),
    recentAgents: getRecentAgents(),
  };
}

/** Upsert a repo into the recent repos list and publish. */
export function trackRecentRepo(repoRoot: string, repoName: string): void {
  const feed = padiSurfaceCtx.cells.activityFeed.get();
  const next = upsertMru(
    feed.recentRepos,
    { repoRoot, repoName, lastSeen: Date.now() },
    (r) => r.repoRoot,
    (r) => r.lastSeen,
    MAX_RECENT_REPOS,
  );
  padiSurfaceCtx.cells.activityFeed.set({ ...feed, recentRepos: next });
}

/** The identity of a recent-agent row — the agent kind plus its allowlisted argv
 *  tokens. Two launches of one agent with different flags are different rows, and
 *  a relaunch of the same invocation refreshes its `lastSeen`. Exported so a
 *  reader (and the tests) spell this key once. */
export function recentAgentKey(
  agent: Pick<RecentAgent, "kind" | "argv">,
): string {
  return `${agent.kind}\u0000${agent.argv.join("\u0000")}`;
}

/** Upsert a detected agent into the recent-agents MRU.
 *  Called from `LocalTerminalEndpoint`'s fold loop when a NEW agent identity is
 *  observed live. Both arguments are STRUCTURED facts: the registry `kind` and the
 *  live process's `stableFlags`-filtered argv (`readProcessSnapshot` →
 *  `stableFlagTokens`). No command text is accepted or stored — a row renders
 *  through the registry (`agentLaunchLine`) at its use site. */
export function trackRecentAgent(kind: string, argv: readonly string[]): void {
  const feed = padiSurfaceCtx.cells.activityFeed.get();
  const next = upsertMru(
    feed.recentAgents,
    { kind, argv: [...argv], lastSeen: Date.now() },
    recentAgentKey,
    (a) => a.lastSeen,
    MAX_RECENT_AGENTS,
  );
  padiSurfaceCtx.cells.activityFeed.set({ ...feed, recentAgents: next });
  log.info({ kind, argv, total: next.length }, "recent agent tracked");
}
