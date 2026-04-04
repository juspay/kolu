/**
 * Server-side persistent state via `conf`.
 *
 * Stores recoverable state at ~/.config/kolu/state.json.
 * All data here is reconstructible (not user data), so
 * corrupt/missing files can safely reset to defaults.
 */

import fs from "node:fs";
import Conf from "conf";
import type {
  RecentRepo,
  Preferences,
  PersistedState,
  ServerState,
  ServerStatePatch,
  TerminalInfo,
} from "kolu-common";
import { publishSystem } from "./publisher.ts";

/** Injected by terminals.ts to avoid circular imports. */
let listTerminalsFn: () => TerminalInfo[] = () => [];
export function setListTerminalsFn(fn: () => TerminalInfo[]): void {
  listTerminalsFn = fn;
}

/**
 * Schema version — bump this when adding migrations.
 * Must be valid semver. `conf` runs all migration handlers
 * whose keys are > the last-seen version and ≤ this value.
 */
const SCHEMA_VERSION = "1.2.0";

const DEFAULT_PREFERENCES: Preferences = {
  seenTips: [],
  startupTips: true,
  randomTheme: true,
  scrollLock: true,
  activityAlerts: true,
  colorScheme: "dark",
};

export const store = new Conf<PersistedState>({
  projectName: "kolu",
  // KOLU_STATE_SUFFIX isolates state per environment (e.g. "test" → ~/.config/kolu-test)
  projectSuffix: process.env.KOLU_STATE_SUFFIX ?? "",
  projectVersion: SCHEMA_VERSION,
  defaults: {
    recentRepos: [],
    session: null,
    preferences: DEFAULT_PREFERENCES,
  },
  migrations: {
    // sortOrder added to SavedTerminal — old sessions don't have it.
    // No-op: sortOrder is optional on SavedTerminalSchema, assigned sequentially on restore.
    "1.1.0": () => {},
    // Preferences added — old state files don't have them.
    // conf auto-merges defaults, but explicit migration ensures clean shape.
    "1.2.0": (store: Conf<PersistedState>) => {
      if (!store.has("preferences")) {
        store.set("preferences", DEFAULT_PREFERENCES);
      }
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

// --- Server state ---

/** Get the full server state (persisted + runtime terminals). */
export function getServerState(): ServerState {
  return {
    recentRepos: getRecentRepos(),
    session: store.get("session"),
    preferences: store.get("preferences"),
    terminals: listTerminalsFn(),
  };
}

/** Notify live query subscribers that server state changed (terminal list or metadata). */
export function emitStateChanged(): void {
  publishSystem("state:changed", getServerState());
}

/** Merge a partial update into the current state.
 *  recentRepos is server-managed (tracked on terminal create) — ignored in patches. */
export function updateServerState(patch: ServerStatePatch): void {
  if (patch.session !== undefined) {
    store.set("session", patch.session);
  }
  if (patch.preferences !== undefined) {
    store.set("preferences", {
      ...store.get("preferences"),
      ...patch.preferences,
    });
  }
  // Notify live query subscribers
  publishSystem("state:changed", getServerState());
}
