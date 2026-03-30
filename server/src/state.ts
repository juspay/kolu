/**
 * Server-side persistent state via `conf`.
 *
 * Stores recoverable state at ~/.config/kolu/state.json.
 * All data here is reconstructible (not user data), so
 * corrupt/missing files can safely reset to defaults.
 */

import { EventEmitter } from "node:events";
import fs from "node:fs";
import Conf from "conf";
import type { RecentRepo } from "kolu-common";

/** Emits state change events for streaming to clients. */
export const stateEvents = new EventEmitter();

interface StateSchema {
  recentRepos: RecentRepo[];
}

const store = new Conf<StateSchema>({
  projectName: "kolu",
  // KOLU_STATE_SUFFIX isolates state per environment (e.g. "test" → ~/.config/kolu-test)
  projectSuffix: process.env.KOLU_STATE_SUFFIX ?? "",
  defaults: {
    recentRepos: [],
  },
});

const MAX_RECENT_REPOS = 20;

/** Upsert a repo into the recent repos list (most-recently-seen first). */
export function trackRecentRepo(repoRoot: string, repoName: string): void {
  const repos = store.get("recentRepos");
  const now = Date.now();
  const existing = repos.findIndex((r) => r.repoRoot === repoRoot);
  if (existing !== -1) {
    repos[existing]!.lastSeen = now;
    repos[existing]!.repoName = repoName;
  } else {
    repos.push({ repoRoot, repoName, lastSeen: now });
  }
  // Sort most-recent first, then trim
  repos.sort((a, b) => b.lastSeen - a.lastSeen);
  store.set("recentRepos", repos.slice(0, MAX_RECENT_REPOS));
  stateEvents.emit("recentRepos", getRecentRepos());
}

/** Get recent repos, most-recently-seen first. Filters out repos that no longer exist on disk. */
export function getRecentRepos(): RecentRepo[] {
  const repos = store.get("recentRepos");
  const live = repos.filter((r) => {
    try {
      fs.accessSync(r.repoRoot);
      return true;
    } catch {
      return false;
    }
  });
  // Prune stale entries from disk
  if (live.length < repos.length) store.set("recentRepos", live);
  return live;
}
