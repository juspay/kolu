/**
 * Server-side persistent state via `conf`.
 *
 * Stores recoverable state at ~/.config/kolu/state.json.
 * All data here is reconstructible (not user data), so
 * corrupt/missing files can safely reset to defaults.
 */

import fs from "node:fs";
import { EventEmitter } from "node:events";
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

// --- Session persistence ---

/** Emits when the saved session changes. Consumers (e.g. streaming endpoint) subscribe here. */
export const sessionChanges = new EventEmitter<{ changed: [SavedSession | null] }>();

/** Save a session snapshot. Only saves when terminals exist (avoids overwriting with empty). */
export function saveSession(terminals: SavedTerminal[]): void {
  if (terminals.length === 0) return;
  const session: SavedSession = { terminals, savedAt: Date.now() };
  store.set("session", session);
  sessionChanges.emit("changed", session);
}

/** Get the saved session, or null if none exists. */
export function getSavedSession(): SavedSession | null {
  const session = store.get("session");
  if (!session || session.terminals.length === 0) return null;
  return session;
}

/** Clear the saved session (e.g. after successful restore). */
export function clearSavedSession(): void {
  store.set("session", null);
}

/** Set the saved session directly (test-only). */
export function setSavedSession(session: SavedSession): void {
  store.set("session", session);
}

// --- Auto-save: terminal lifecycle → session persistence (decoupled via event) ---

let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Wire up debounced session save from terminal change events. Called once at startup. */
export function initSessionAutoSave(
  onChange: { on: (event: "changed", fn: () => void) => void },
  snapshot: () => SavedTerminal[],
): void {
  onChange.on("changed", () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveSession(snapshot()), 500);
  });
}
