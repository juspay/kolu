import type { ActivityFeed, SavedSession } from "@kolu/padi-client/surface";
import type { CellStore } from "@kolu/surface/server";
import type { PairedDaemon } from "./pairedDaemon.ts";

let sessionStore: CellStore<SavedSession | null> | undefined;
let activityFeedStore: CellStore<ActivityFeed> | undefined;
let lastPairedDaemonStore: CellStore<PairedDaemon | null> | undefined;

export function setPadiSessionStore(
  store: CellStore<SavedSession | null>,
): void {
  sessionStore = store;
}

export function setPadiActivityFeedStore(store: CellStore<ActivityFeed>): void {
  activityFeedStore = store;
}

export function setPadiLastPairedDaemonStore(
  store: CellStore<PairedDaemon | null>,
): void {
  lastPairedDaemonStore = store;
}

function requireStore<T>(store: T | undefined, name: string): T {
  if (store === undefined) {
    throw new Error(
      `padi ${name} store read before it was set — padi boot (daemonMain) must set the ${name} store before serving`,
    );
  }
  return store;
}

export function requirePadiSessionStore(): CellStore<SavedSession | null> {
  return requireStore(sessionStore, "session");
}

export function requirePadiActivityFeedStore(): CellStore<ActivityFeed> {
  return requireStore(activityFeedStore, "activityFeed");
}

export function requirePadiLastPairedDaemonStore(): CellStore<PairedDaemon | null> {
  return requireStore(lastPairedDaemonStore, "lastPairedDaemon");
}
