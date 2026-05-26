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
import type {
  ActivityFeed,
  RecentAgent,
  RecentRepo,
} from "kolu-common/surface";
import { log } from "./log.ts";
import { surfaceCtx } from "./surface.ts";

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
 *  persist and notify. */
function upsertMru<T>(
  list: T[],
  item: T,
  keyOf: (t: T) => string,
  timeOf: (t: T) => number,
  max: number,
): T[] {
  const key = keyOf(item);
  const idx = list.findIndex((x) => keyOf(x) === key);
  if (idx !== -1) list[idx] = item;
  else list.push(item);
  list.sort((a, b) => timeOf(b) - timeOf(a));
  return list.slice(0, max);
}

/** Get recent repos, most-recently-seen first. Filters out repos that no
 *  longer exist on disk and back-writes the trimmed list so subsequent
 *  reads don't re-stat. */
function getRecentRepos(): RecentRepo[] {
  const feed = surfaceCtx.cells.activityFeed.get();
  const live = feed.recentRepos.filter((r) => existsOnDisk(r.repoRoot));
  if (live.length < feed.recentRepos.length) {
    surfaceCtx.cells.activityFeed.set({ ...feed, recentRepos: live });
  }
  return live;
}

/** Get recent agents, most-recently-seen first. */
function getRecentAgents(): RecentAgent[] {
  return surfaceCtx.cells.activityFeed.get().recentAgents;
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
  const feed = surfaceCtx.cells.activityFeed.get();
  const next = upsertMru(
    feed.recentRepos,
    { repoRoot, repoName, lastSeen: Date.now() },
    (r) => r.repoRoot,
    (r) => r.lastSeen,
    MAX_RECENT_REPOS,
  );
  surfaceCtx.cells.activityFeed.set({ ...feed, recentRepos: next });
}

/** Upsert a normalized agent command into the recent agents MRU.
 *  Called from `LocalTerminalBackend`'s agent-command tracker whenever the preexec OSC 633;E
 *  handler fires with a command whose first token matches a known agent
 *  binary. The `command` string is the normalized form produced by
 *  `parseAgentCommand` — raw prompt text has already been stripped. */
export function trackRecentAgent(command: string): void {
  const feed = surfaceCtx.cells.activityFeed.get();
  const next = upsertMru(
    feed.recentAgents,
    { command, lastSeen: Date.now() },
    (a) => a.command,
    (a) => a.lastSeen,
    MAX_RECENT_AGENTS,
  );
  surfaceCtx.cells.activityFeed.set({ ...feed, recentAgents: next });
  log.info({ command, total: next.length }, "recent agent tracked");
}
