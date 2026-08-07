/**
 * Server-derived activity feed: recent repos cd'd into and recent agent CLIs
 * spotted via OSC 633;E. The server is the sole writer; clients subscribe
 * read-only via `activity.get`.
 *
 * Both feeds are bounded MRU lists. Eviction policy lives here, not in the
 * publisher or the contract — adding a new feed (e.g. recent worktrees) is
 * a single-file change.
 */

import fs from "node:fs";
import { log } from "../log.ts";
import { padiSurfaceCtx } from "../padiSurfaceCtx.ts";
import type { ActivityFeed, RecentAgent, RecentRepo } from "../vocab.ts";

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

/** Upsert a normalized agent command into the recent agents MRU.
 *  Called from `LocalTerminalEndpoint`'s agent-command tracker whenever the preexec OSC 633;E
 *  handler fires with a command whose first token matches a known agent
 *  binary. The `command` string is the normalized form produced by
 *  `parseAgentCommand` — raw prompt text has already been stripped. */
export function trackRecentAgent(command: string): void {
  const feed = padiSurfaceCtx.cells.activityFeed.get();
  const next = upsertMru(
    feed.recentAgents,
    { command, lastSeen: Date.now() },
    (a) => a.command,
    (a) => a.lastSeen,
    MAX_RECENT_AGENTS,
  );
  padiSurfaceCtx.cells.activityFeed.set({ ...feed, recentAgents: next });
  log.info({ command, total: next.length }, "recent agent tracked");
}
