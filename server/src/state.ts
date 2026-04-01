/**
 * Server-side persistent state via `conf`.
 *
 * Stores recoverable state at ~/.config/kolu/state.json.
 * All data here is reconstructible (not user data), so
 * corrupt/missing files can safely reset to defaults.
 */

import fs from "node:fs";
import Conf from "conf";
import type { RecentRepo, SavedSession, WorktreeConfig } from "kolu-common";

interface StateSchema {
  recentRepos: RecentRepo[];
  session: SavedSession | null;
  worktreeConfig: WorktreeConfig;
}

const DEFAULT_WORKTREE_CONFIG: WorktreeConfig = {
  agent: "shell",
  dangerouslySkipPermissions: false,
};

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
    worktreeConfig: DEFAULT_WORKTREE_CONFIG,
  },
  migrations: {
    // sortOrder added to SavedTerminal — old sessions don't have it.
    // No-op: sortOrder is optional on SavedTerminalSchema, assigned sequentially on restore.
    "1.1.0": () => {},
    // worktreeConfig added — default is shell agent, no skip-permissions.
    "1.2.0": (s: Conf<StateSchema>) => {
      s.set("worktreeConfig", DEFAULT_WORKTREE_CONFIG);
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

// --- Worktree config ---

export function getWorktreeConfig(): WorktreeConfig {
  return store.get("worktreeConfig");
}

export function setWorktreeConfig(config: WorktreeConfig): void {
  store.set("worktreeConfig", config);
}

/** Get recent repos, most-recently-seen first. Filters out repos that no longer exist on disk. */
export function getRecentRepos(): RecentRepo[] {
  const repos = store.get("recentRepos");
  const live = repos.filter((r) => existsOnDisk(r.repoRoot));
  if (live.length < repos.length) store.set("recentRepos", live);
  return live;
}
