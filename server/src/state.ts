/**
 * Server-side persistent state via `conf`.
 *
 * Stores recoverable state at ~/.config/kolu/state.json.
 * All data here is reconstructible (not user data), so
 * corrupt/missing files can safely reset to defaults.
 */

import Conf from "conf";
import type { RecentRepo } from "kolu-common";

interface StateSchema {
  recentRepos: RecentRepo[];
}

const store = new Conf<StateSchema>({
  projectName: "kolu",
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
}

/** Get recent repos, most-recently-seen first. */
export function getRecentRepos(): RecentRepo[] {
  return store.get("recentRepos");
}
