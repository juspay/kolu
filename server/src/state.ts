/**
 * Server-side persistent state via `conf`.
 *
 * Stores recoverable state at ~/.config/kolu/state.json.
 * All data here is reconstructible (not user data), so
 * corrupt/missing files can safely reset to defaults.
 */

import fs from "node:fs";
import Conf from "conf";
import type { RecentRepo, SavedSession } from "kolu-common";

interface StateSchema {
  recentRepos: RecentRepo[];
  session: SavedSession | null;
  worktreeAutolaunch: string | null;
}

const DEFAULT_AUTOLAUNCH = "pwd && git log --oneline -5";

/**
 * Schema version — bump this when adding migrations.
 * Must be valid semver. `conf` runs all migration handlers
 * whose keys are > the last-seen version and ≤ this value.
 */
const SCHEMA_VERSION = "1.2.0";

export const store = new Conf<StateSchema>({
  projectName: "kolu",
  // KOLU_STATE_SUFFIX isolates state per environment (e.g. "test" → ~/.config/kolu-test)
  projectSuffix: process.env.KOLU_STATE_SUFFIX ?? "",
  projectVersion: SCHEMA_VERSION,
  defaults: {
    recentRepos: [],
    session: null,
    worktreeAutolaunch: DEFAULT_AUTOLAUNCH,
  },
  migrations: {
    // sortOrder added to SavedTerminal — old sessions don't have it.
    // No-op: sortOrder is optional on SavedTerminalSchema, assigned sequentially on restore.
    "1.1.0": () => {},
    // worktreeAutolaunch added — set default for existing users.
    "1.2.0": (s: Conf<StateSchema>) => {
      s.set("worktreeAutolaunch", DEFAULT_AUTOLAUNCH);
    },
  },
});

/** Check if a path exists on disk. */
function existsOnDisk(path: string): boolean {
  try {
    fs.accessSync(path);
    return true;
  } catch {
    return false;
  }
}

// --- Recent repos ---

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

/** Get recent repos, most-recently-seen first. Filters out repos that no longer exist on disk. */
export function getRecentRepos(): RecentRepo[] {
  const repos = store.get("recentRepos");
  const live = repos.filter((r) => existsOnDisk(r.repoRoot));
  if (live.length < repos.length) store.set("recentRepos", live);
  return live;
}

// --- Worktree autolaunch ---

export function getWorktreeAutolaunch(): string | null {
  return store.get("worktreeAutolaunch");
}

export function setWorktreeAutolaunch(command: string | null): void {
  store.set("worktreeAutolaunch", command);
}
