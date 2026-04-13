/**
 * Server-side persistent state via `conf`.
 *
 * Stores recoverable state at ~/.config/kolu/state.json.
 * All data here is reconstructible (not user data), so
 * corrupt/missing files can safely reset to defaults.
 */

import fs from "node:fs";
import Conf from "conf";
import { DEFAULT_PREFERENCES } from "kolu-common/config";
import type {
  Preferences,
  RecentRepo,
  RecentAgent,
  PersistedState,
  ServerState,
  ServerStatePatch,
} from "kolu-common";
import { publishSystem } from "./publisher.ts";
import { log } from "./log.ts";

/**
 * Schema version — bump this when adding migrations.
 * Must be valid semver. `conf` runs all migration handlers
 * whose keys are > the last-seen version and ≤ this value.
 */
const SCHEMA_VERSION = "1.7.0";

export const store = new Conf<PersistedState>({
  projectName: "kolu",
  // KOLU_STATE_SUFFIX isolates state per environment (e.g. "test" → ~/.config/kolu-test)
  projectSuffix: process.env.KOLU_STATE_SUFFIX ?? "",
  projectVersion: SCHEMA_VERSION,
  defaults: {
    recentRepos: [],
    recentAgents: [],
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
    // sidebarAgentPreviews added — old preference blobs lack this field.
    "1.3.0": (store: Conf<PersistedState>) => {
      const current = store.get("preferences") as
        | Partial<Preferences>
        | undefined;
      store.set("preferences", {
        ...DEFAULT_PREFERENCES,
        ...current,
      });
    },
    // sidebarAgentPreviews: boolean → enum. Previously `true` meant
    // "preview every agent terminal" (now "agents"), `false` meant off
    // (now "none"). New installs default to "attention".
    "1.4.0": (store: Conf<PersistedState>) => {
      // Cast through `unknown` because the persisted shape predates
      // the enum — on disk the field may still be a boolean.
      const current = store.get("preferences") as unknown as
        | (Record<string, unknown> & { sidebarAgentPreviews?: unknown })
        | undefined;
      const old = current?.sidebarAgentPreviews;
      const migrated =
        old === true
          ? "agents"
          : old === false
            ? "none"
            : typeof old === "string"
              ? (old as Preferences["sidebarAgentPreviews"])
              : undefined;
      store.set("preferences", {
        ...DEFAULT_PREFERENCES,
        ...(current as Partial<Preferences>),
        sidebarAgentPreviews:
          migrated ?? DEFAULT_PREFERENCES.sidebarAgentPreviews,
      });
    },
    // recentAgents added — seed as empty array for existing state files.
    "1.5.0": (store: Conf<PersistedState>) => {
      if (!store.has("recentAgents")) {
        store.set("recentAgents", []);
      }
    },
    // rightPanelCollapsed + rightPanelSize added — old preference blobs lack these fields.
    "1.6.0": (store: Conf<PersistedState>) => {
      const current = store.get("preferences") as
        | Partial<Preferences>
        | undefined;
      store.set("preferences", {
        ...DEFAULT_PREFERENCES,
        ...current,
      });
    },
    // rightPanel nested object — migrates flat rightPanelCollapsed/rightPanelSize to nested + adds tab.
    "1.7.0": (store: Conf<PersistedState>) => {
      const current = store.get("preferences") as
        | (Record<string, unknown> & {
            rightPanelCollapsed?: boolean;
            rightPanelSize?: number;
          })
        | undefined;
      // Extract flat fields from pre-1.7.0 layout
      const collapsed =
        current?.rightPanelCollapsed ??
        DEFAULT_PREFERENCES.rightPanel.collapsed;
      const size =
        current?.rightPanelSize ?? DEFAULT_PREFERENCES.rightPanel.size;
      // Remove flat fields, add nested object
      const {
        rightPanelCollapsed: _,
        rightPanelSize: __,
        ...rest
      } = current ?? {};
      store.set("preferences", {
        ...DEFAULT_PREFERENCES,
        ...rest,
        rightPanel: {
          collapsed,
          size,
          tab: DEFAULT_PREFERENCES.rightPanel.tab,
        },
      } as unknown as Preferences);
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

// --- Bounded MRU helper ---

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

// --- Recent repos ---

const MAX_RECENT_REPOS = 20;

/** Upsert a repo into the recent repos list (most-recently-seen first). */
export function trackRecentRepo(repoRoot: string, repoName: string): void {
  const next = upsertMru(
    store.get("recentRepos"),
    { repoRoot, repoName, lastSeen: Date.now() },
    (r) => r.repoRoot,
    (r) => r.lastSeen,
    MAX_RECENT_REPOS,
  );
  store.set("recentRepos", next);
  publishSystem("state:changed", getServerState());
}

/** Get recent repos, most-recently-seen first. Filters out repos that no longer exist on disk. */
export function getRecentRepos(): RecentRepo[] {
  const repos = store.get("recentRepos");
  const live = repos.filter((r) => existsOnDisk(r.repoRoot));
  if (live.length < repos.length) store.set("recentRepos", live);
  return live;
}

// --- Recent agents ---

const MAX_RECENT_AGENTS = 10;

/** Upsert a normalized agent command into the recent agents MRU.
 *  Called from terminals.ts whenever the preexec OSC 633;E handler fires
 *  with a command whose first token matches a known agent binary. The
 *  `command` string is the normalized form produced by
 *  `parseAgentCommand` — raw prompt text has already been stripped. */
export function trackRecentAgent(command: string): void {
  const next = upsertMru(
    store.get("recentAgents"),
    { command, lastSeen: Date.now() },
    (a) => a.command,
    (a) => a.lastSeen,
    MAX_RECENT_AGENTS,
  );
  store.set("recentAgents", next);
  log.info({ command, total: next.length }, "recent agent tracked");
  publishSystem("state:changed", getServerState());
}

/** Get recent agents, most-recently-seen first. */
function getRecentAgents(): RecentAgent[] {
  return store.get("recentAgents");
}

// --- Server state ---

/** Get the full server state. */
export function getServerState(): ServerState {
  return {
    recentRepos: getRecentRepos(),
    recentAgents: getRecentAgents(),
    session: store.get("session"),
    preferences: store.get("preferences"),
  };
}

/** Merge a partial update into the current state.
 *  recentRepos and recentAgents are server-managed — ignored in patches. */
export function updateServerState(patch: ServerStatePatch): void {
  if (patch.session !== undefined) {
    store.set("session", patch.session);
  }
  if (patch.preferences !== undefined) {
    const current = store.get("preferences");
    const { rightPanel: rpPatch, ...rest } = patch.preferences;
    store.set("preferences", {
      ...current,
      ...rest,
      ...(rpPatch !== undefined && {
        rightPanel: { ...current.rightPanel, ...rpPatch },
      }),
    });
  }
  // Notify live query subscribers
  publishSystem("state:changed", getServerState());
}

/** Test-only: apply a full patch including `recentRepos` and `recentAgents`.
 *  Used by e2e hooks to reset state between scenarios. Production callers
 *  must go through `updateServerState`, which ignores server-managed fields. */
export function testSetServerState(patch: ServerStatePatch): void {
  if (patch.recentRepos !== undefined) {
    store.set("recentRepos", patch.recentRepos);
  }
  if (patch.recentAgents !== undefined) {
    store.set("recentAgents", patch.recentAgents);
  }
  updateServerState(patch);
}
