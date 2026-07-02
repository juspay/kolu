/**
 * Padi-side injected holders for the two conf-backed cell stores the terminal
 * domain writes — `session` and `activityFeed`.
 *
 * padi does NOT import `packages/server` (the dependency arrow points OUT), yet
 * the STORAGE for these two cells stays kolu-server's single `Conf` source of
 * truth until W2.2 gives padi its own state-root. So kolu-server's boot INJECTS
 * the real `confStore`-backed stores here — via {@link setPadiSessionStore} /
 * {@link setPadiActivityFeedStore} — BEFORE anything serves or reconciles. A read
 * before the boot-time set is a boot-order bug, so the `requireX()` getters crash
 * loudly rather than silently degrading to an empty/absent session or feed — the
 * same fail-fast idiom `requireServerProcessId` uses in `koluRoot.ts`.
 *
 * This holder severs only the COMPILE-TIME arrow back into `packages/server`; the
 * value read is identical because it delegates straight to the same `confStore`
 * key kolu-server built.
 */

import type { CellStore } from "@kolu/surface/server";
import type { PairedDaemon } from "./pairedDaemon.ts";
import type { ActivityFeed, SavedSession } from "./vocab.ts";

/** The injected `session` conf store, or `undefined` until boot sets it. */
let sessionStore: CellStore<SavedSession | null> | undefined;

/** The injected `activityFeed` conf store, or `undefined` until boot sets it. */
let activityFeedStore: CellStore<ActivityFeed> | undefined;

/** The injected `lastPairedDaemon` conf store, or `undefined` until boot sets it. */
let lastPairedDaemonStore: CellStore<PairedDaemon | null> | undefined;

/** Inject the `session` conf store. Called once at kolu-server boot, before any
 *  serve / reconcile path reads it. */
export function setPadiSessionStore(
  store: CellStore<SavedSession | null>,
): void {
  sessionStore = store;
}

/** Inject the `activityFeed` conf store. Called once at kolu-server boot, before
 *  any serve / MRU-tracker path reads it. */
export function setPadiActivityFeedStore(store: CellStore<ActivityFeed>): void {
  activityFeedStore = store;
}

/** Inject the `lastPairedDaemon` conf store. Called once at kolu-server boot,
 *  before the first boot adoption reads it. */
export function setPadiLastPairedDaemonStore(
  store: CellStore<PairedDaemon | null>,
): void {
  lastPairedDaemonStore = store;
}

/** The injected `session` store, or a loud crash if a read beat the boot-time
 *  set. Fail-fast: a never-set read must surface, never silently degrade to a
 *  null session (which would drop the restore card). */
export function requirePadiSessionStore(): CellStore<SavedSession | null> {
  if (sessionStore === undefined) {
    throw new Error(
      "padi session store read before setPadiSessionStore() — kolu-server boot must inject it before serving",
    );
  }
  return sessionStore;
}

/** The injected `activityFeed` store, or a loud crash if a read beat the
 *  boot-time set. Fail-fast, mirroring {@link requirePadiSessionStore}. */
export function requirePadiActivityFeedStore(): CellStore<ActivityFeed> {
  if (activityFeedStore === undefined) {
    throw new Error(
      "padi activityFeed store read before setPadiActivityFeedStore() — kolu-server boot must inject it before serving",
    );
  }
  return activityFeedStore;
}

/** The injected `lastPairedDaemon` store, or a loud crash if a read beat the
 *  boot-time set. Fail-fast, mirroring {@link requirePadiSessionStore}: a boot that
 *  can't read the prior pairing must surface, not silently skip replacement
 *  detection (which would re-open the session-clobber path). */
export function requirePadiLastPairedDaemonStore(): CellStore<PairedDaemon | null> {
  if (lastPairedDaemonStore === undefined) {
    throw new Error(
      "padi lastPairedDaemon store read before setPadiLastPairedDaemonStore() — kolu-server boot must inject it before adopting",
    );
  }
  return lastPairedDaemonStore;
}
