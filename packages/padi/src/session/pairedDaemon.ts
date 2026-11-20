import type { SavedSession } from "@kolu/padi-client/surface";
import { Schema } from "effect";
import type { PtyHostListEntry } from "kaval";
import { requirePadiLastPairedDaemonStore } from "./confStores.ts";

/** The persisted identity of the kaval kolu-server last converged onto as its
 *  survivor: `startedAt` is that daemon process's own boot stamp, in ms-epoch. */
export const PairedDaemonSchema = Schema.Struct({
  startedAt: Schema.Number,
});
export type PairedDaemon = typeof PairedDaemonSchema.Type;

export function getLastPairedDaemon(): PairedDaemon | null {
  return requirePadiLastPairedDaemonStore().get();
}

export function recordPairedDaemon(startedAt: number | undefined): void {
  requirePadiLastPairedDaemonStore().set(
    startedAt === undefined ? null : { startedAt },
  );
}

export function isReplacedDaemon(args: {
  currentStartedAt: number | undefined;
  lastPaired: PairedDaemon | null;
  live: readonly PtyHostListEntry[];
  saved: SavedSession | null;
}): boolean {
  const { currentStartedAt, lastPaired, live, saved } = args;
  const savedActiveIds = new Set(
    (saved?.terminals ?? [])
      .filter((t) => t.state === "active")
      .map((t) => t.id),
  );
  if (savedActiveIds.size === 0) return false;
  if (live.some((entry) => savedActiveIds.has(entry.id))) return false;
  if (
    lastPaired !== null &&
    currentStartedAt !== undefined &&
    currentStartedAt === lastPaired.startedAt
  ) {
    return false;
  }
  return true;
}
