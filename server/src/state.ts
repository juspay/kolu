/**
 * Server-side persistent state via `conf`.
 *
 * Stores recoverable state at ~/.config/kolu/state.json.
 * All data here is reconstructible (not user data), so
 * corrupt/missing files can safely reset to defaults.
 */

import fs from "node:fs";
import Conf from "conf";
import type { RecentRepo, SavedSession, SavedTerminal } from "kolu-common";

interface StateSchema {
  recentRepos: RecentRepo[];
  session: SavedSession | null;
}

const store = new Conf<StateSchema>({
  projectName: "kolu",
  // KOLU_STATE_SUFFIX isolates state per environment (e.g. "test" → ~/.config/kolu-test)
  projectSuffix: process.env.KOLU_STATE_SUFFIX ?? "",
  defaults: {
    recentRepos: [],
    session: null,
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

// --- Session persistence ---

/** Save a session snapshot. Only saves when terminals exist (avoids overwriting with empty). */
export function saveSession(terminals: SavedTerminal[]): void {
  if (terminals.length === 0) return;
  store.set("session", { terminals, savedAt: Date.now() });
}

/** Get the saved session, or null if none exists. Filters out terminals with non-existent CWDs. */
export function getSavedSession(): SavedSession | null {
  const session = store.get("session");
  if (!session || session.terminals.length === 0) return null;

  // Filter out terminals whose CWD no longer exists
  const live = session.terminals.filter((t) => {
    try {
      fs.accessSync(t.cwd);
      return true;
    } catch {
      return false;
    }
  });
  if (live.length === 0) return null;

  // Re-index parentIndex references after filtering
  const oldToNew = new Map<number, number>();
  let newIdx = 0;
  for (let i = 0; i < session.terminals.length; i++) {
    if (live.includes(session.terminals[i]!)) {
      oldToNew.set(i, newIdx++);
    }
  }
  const reindexed = live.map((t) => ({
    cwd: t.cwd,
    ...(t.parentIndex !== undefined && oldToNew.has(t.parentIndex)
      ? { parentIndex: oldToNew.get(t.parentIndex)! }
      : {}),
  }));

  return { terminals: reindexed, savedAt: session.savedAt };
}

/** Clear the saved session (e.g. after successful restore). */
export function clearSavedSession(): void {
  store.set("session", null);
}
