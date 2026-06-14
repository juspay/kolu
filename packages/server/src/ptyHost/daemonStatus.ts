/**
 * The server-owned store + publisher for per-host pty-host daemon status.
 *
 * The supervisor endpoint (in `./index.ts`) reports every transition through
 * `publishDaemonStatus`, which records it here and publishes it on the
 * `daemonStatus` surface collection so the rail's KAVAL column and the
 * DegradedCanvas can subscribe. The store is the source of truth the surface
 * collection's `readAll`/`readOne` read from (mirroring how `terminalMetadata`
 * reads the terminal registry).
 */

import type { DaemonStatus } from "kolu-common/surface";
import { surfaceCtx } from "../surfaceCtx.ts";

const store = new Map<string, DaemonStatus>();

/** The local kaval's unix socket path (from `kavalSocketPath(port)`), set once at
 *  boot and constant for the daemon's life. Folded onto every published status so
 *  the kaval dialog can show where the daemon listens — a server fact the client
 *  can't construct (it doesn't know the server's `XDG_RUNTIME_DIR`). */
let localSocketPath: string | undefined;

/** Every host's current daemon status (for the collection's `readAll`). */
export function readDaemonStatuses(): Map<string, DaemonStatus> {
  return store;
}

/** One host's current daemon status (for the collection's `readOne`). */
export function readDaemonStatus(hostId: string): DaemonStatus | undefined {
  return store.get(hostId);
}

/** Record the local kaval's socket path at boot (before the endpoint publishes
 *  its first status), so every publish carries it for the dialog. */
export function setLocalSocketPath(path: string): void {
  localSocketPath = path;
}

/** Record + publish a host's daemon status. The endpoint's `onStatus` sink. Folds
 *  the local socket path on (a constant server fact) so the client need not — and
 *  can't — derive it. */
export function publishDaemonStatus(
  hostId: string,
  status: DaemonStatus,
): void {
  const full = localSocketPath
    ? { ...status, socketPath: localSocketPath }
    : status;
  store.set(hostId, full);
  surfaceCtx.collections.daemonStatus.upsert(hostId, full);
}

/** Fold the boot's adopted-terminal count (B3.3) onto the host's CURRENT status
 *  and re-publish, so the client's "N reattached" toast reads it off the same
 *  `daemonStatus` collection the rail uses. Separate from `publishDaemonStatus`
 *  because the count is kolu's soul, computed by `reconcile` AFTER the endpoint
 *  has already reported `connected` (the spine's `onStatus` knows nothing of
 *  terminals). A no-op if the host has no recorded status yet (it always does by
 *  the time adoption runs — the connect emitted one).
 *
 *  Stamps `adoptedAt` here — this is the one site an adoption is surfaced, so the
 *  timestamp is a true per-adoption identity. The pair is sticky in the store and
 *  replayed to every fresh subscription; the client dedupes the toast on
 *  `adoptedAt` so a reconnect/reload replay doesn't re-fire it (juspay/kolu#1365). */
export function setAdoptedCount(hostId: string, adopted: number): void {
  const current = store.get(hostId);
  if (!current) return;
  publishDaemonStatus(hostId, { ...current, adopted, adoptedAt: Date.now() });
}
