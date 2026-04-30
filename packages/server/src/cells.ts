/**
 * Server-side cell wiring: typed publisher channels + Conf-backed stores
 * for every cell/collection declared in `kolu-common/cells`. Domain
 * modules (`preferences.ts`, `activity.ts`, `session.ts`, `terminals.ts`)
 * import `cellBus.<name>.publish` to broadcast mutations; the router
 * imports the same busses + stores when wiring `cellHandlers` /
 * `collectionHandlers` from `@kolu/cells/server`.
 *
 * One file, one source of truth: adding a new cell is a single declaration
 * here that pulls together the publisher channel name and the persistence
 * key. Both halves (server-side write and client-side subscribe) flow
 * through the framework's typed adapters.
 */

import {
  type ChannelBus,
  type CellStore,
  publisherChannel,
} from "@kolu/cells/server";
import type {
  ActivityFeed,
  Preferences,
  SavedSession,
  TerminalInfo,
} from "kolu-common";
import { publisher } from "./publisher.ts";
import { store } from "./state.ts";

// ── Publisher channels (one per cell) ──────────────────────────────────

export const cellBus = {
  /** User preferences changed — drives the live `preferences.get` query. */
  preferences: publisherChannel<Preferences>(publisher, "preferences:changed"),
  /** Activity feed changed (recent repos / agents) — drives `activity.get`. */
  activityFeed: publisherChannel<ActivityFeed>(publisher, "activity:changed"),
  /** Saved-session blob changed — drives `session.get`. */
  savedSession: publisherChannel<SavedSession | null>(
    publisher,
    "session:changed",
  ),
  /** Terminal list changed (create/kill) — drives `terminal.list`. */
  terminalList: publisherChannel<TerminalInfo[]>(publisher, "terminal-list"),
} as const;

// ── Conf-backed stores (one per persisted cell) ────────────────────────

/** Read/write `preferences` slot of the shared Conf store. */
export const preferencesStore: CellStore<Preferences> = {
  get: () => store.get("preferences"),
  set: (v) => store.set("preferences", v),
};

/** Read/write the `activityFeed` shape (recentRepos + recentAgents) by
 *  composing the two top-level keys the legacy schema separates them into.
 *  The framework treats it as one cell; on disk it's two keys. */
export const activityFeedStore: CellStore<ActivityFeed> = {
  get: () => ({
    recentRepos: store.get("recentRepos"),
    recentAgents: store.get("recentAgents"),
  }),
  set: (feed) => {
    store.set("recentRepos", feed.recentRepos);
    store.set("recentAgents", feed.recentAgents);
  },
};

/** Read/write `session` slot. The cell's `null` represents "no saved
 *  session" — same on-disk convention as today (`session: null` vs an
 *  object with a `terminals` array). */
export const savedSessionStore: CellStore<SavedSession | null> = {
  get: () => store.get("session"),
  set: (v) => store.set("session", v),
};
