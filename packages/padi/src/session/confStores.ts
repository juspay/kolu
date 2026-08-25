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

import type { ActivityFeed, SavedSession } from "@kolu/padi-client/surface";
import type { CellStore } from "@kolu/surface/server";
import type { PairedDaemon } from "./pairedDaemon.ts";

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

/** Fail-fast reader for a boot-injected store: return it, or crash loudly if a
 *  read beat the boot-time set. A never-set read must SURFACE, never silently
 *  degrade to an empty/absent store (a null session drops the restore card; a
 *  missing prior pairing re-opens the session-clobber path). Shared by the three
 *  `requirePadiXStore()` getters so the fail-fast idiom lives once. */
function requireStore<T>(store: T | undefined, name: string): T {
  if (store === undefined) {
    throw new Error(
      `padi ${name} store read before it was set — padi boot (daemonMain) must set the ${name} store before serving`,
    );
  }
  return store;
}

/** The injected `session` store, or a loud crash if a read beat the boot-time set. */
export function requirePadiSessionStore(): CellStore<SavedSession | null> {
  return requireStore(sessionStore, "session");
}

/** The injected `activityFeed` store, or a loud crash if a read beat the boot-time set. */
export function requirePadiActivityFeedStore(): CellStore<ActivityFeed> {
  return requireStore(activityFeedStore, "activityFeed");
}

/** The injected `lastPairedDaemon` store, or a loud crash if a read beat the boot-time set. */
export function requirePadiLastPairedDaemonStore(): CellStore<PairedDaemon | null> {
  return requireStore(lastPairedDaemonStore, "lastPairedDaemon");
}
