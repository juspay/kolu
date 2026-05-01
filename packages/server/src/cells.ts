/**
 * Server-side cell wiring: typed publisher channels + Conf-backed stores
 * for every cell/collection declared in `kolu-common/surface`. Domain
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
  type CellStore,
  confStore,
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

// Channel names follow `implementSurface`'s default naming convention
// (`<surface-key>:changed`) so domain modules' direct publishes land on
// the exact same publisher channel the surface's `cellHandlers` subscribes
// to. Two `publisherChannel(publisher, name)` calls with the same name
// share the underlying channel.
export const cellBus = {
  /** User preferences changed — drives `surface.preferences.get`. */
  preferences: publisherChannel<Preferences>(publisher, "preferences:changed"),
  /** Activity feed changed — drives `surface.activityFeed.get`. */
  activityFeed: publisherChannel<ActivityFeed>(
    publisher,
    "activityFeed:changed",
  ),
  /** Saved-session blob changed — drives `surface.session.get`. */
  savedSession: publisherChannel<SavedSession | null>(
    publisher,
    "session:changed",
  ),
  /** Terminal list changed (create/kill) — drives `surface.terminalList.get`. */
  terminalList: publisherChannel<TerminalInfo[]>(
    publisher,
    "terminalList:changed",
  ),
} as const;

// ── Conf-backed stores (one per persisted cell) ────────────────────────

/** Read/write `preferences` slot of the shared Conf store. */
export const preferencesStore: CellStore<Preferences> = confStore<Preferences>(
  store,
  "preferences",
);

/** Read/write `activityFeed` slot. One cell, one Conf key — the legacy
 *  two-key split (`recentRepos` + `recentAgents`) was collapsed in the
 *  1.19.0 migration so the cell concept and the disk shape now agree. */
export const activityFeedStore: CellStore<ActivityFeed> =
  confStore<ActivityFeed>(store, "activityFeed");

/** Read/write `session` slot. The cell's `null` represents "no saved
 *  session" — same on-disk convention as today (`session: null` vs an
 *  object with a `terminals` array). */
export const savedSessionStore: CellStore<SavedSession | null> =
  confStore<SavedSession | null>(store, "session");
