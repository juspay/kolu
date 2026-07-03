/**
 * Padi-side holders for the three conf-backed cell stores the terminal domain
 * writes — `session`, `activityFeed`, and `lastPairedDaemon`.
 *
 * Post-W2.2 padi owns its OWN `Conf` under its state-root. padi's own boot
 * (`daemonMain` → `openPadiStateStores`) builds those `confStore`-backed stores
 * and SETS them here — via {@link setPadiSessionStore} /
 * {@link setPadiActivityFeedStore} / {@link setPadiLastPairedDaemonStore} — BEFORE
 * anything serves or reconciles. A read before the boot-time set is a boot-order
 * bug, so the `requireX()` getters crash loudly rather than silently degrading to
 * an empty/absent session or feed — the same fail-fast idiom `requireDaemonProcessId`
 * uses in `koluRoot.ts`.
 *
 * These setters keep the store WIRING at the single boot site: every serve /
 * reconcile / MRU-tracker path reads only through the `requireX()` getters, never
 * touching how the store was built.
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

/** Set the `session` conf store. Called once at padi's own boot (`daemonMain`),
 *  before any serve / reconcile path reads it. */
export function setPadiSessionStore(
  store: CellStore<SavedSession | null>,
): void {
  sessionStore = store;
}

/** Set the `activityFeed` conf store. Called once at padi's own boot
 *  (`daemonMain`), before any serve / MRU-tracker path reads it. */
export function setPadiActivityFeedStore(store: CellStore<ActivityFeed>): void {
  activityFeedStore = store;
}

/** Set the `lastPairedDaemon` conf store. Called once at padi's own boot
 *  (`daemonMain`), before the first boot adoption reads it. */
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
      "padi session store read before setPadiSessionStore() — padi boot (daemonMain) must set it before serving",
    );
  }
  return sessionStore;
}

/** The injected `activityFeed` store, or a loud crash if a read beat the
 *  boot-time set. Fail-fast, mirroring {@link requirePadiSessionStore}. */
export function requirePadiActivityFeedStore(): CellStore<ActivityFeed> {
  if (activityFeedStore === undefined) {
    throw new Error(
      "padi activityFeed store read before setPadiActivityFeedStore() — padi boot (daemonMain) must set it before serving",
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
      "padi lastPairedDaemon store read before setPadiLastPairedDaemonStore() — padi boot (daemonMain) must set it before adopting",
    );
  }
  return lastPairedDaemonStore;
}
