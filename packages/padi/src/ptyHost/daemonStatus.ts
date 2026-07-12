/**
 * The server-owned store + publisher for per-host pty-host daemon status.
 *
 * The supervisor endpoint (in `./index.ts`) reports every transition through
 * `publishDaemonStatus`, which records it here and publishes it on padi's
 * `daemonStatus` surface collection so the rail's KAVAL column and the
 * DegradedCanvas can subscribe. The store is the source of truth the surface
 * collection's `readAll`/`readOne` read from (mirroring how padi's `terminals`
 * collection reads the terminal registry). padi supervises its kaval, so the
 * daemon-liveness collection is padi's to serve (W1.R7 — it left koluSurface).
 */

import type { EndpointStatus } from "@kolu/surface-daemon-supervisor";
import { padiSurfaceCtx } from "../padiSurfaceCtx.ts";
import type { DaemonStatus } from "../vocab.ts";
import type { KavalConnectionMetadata } from "./connect.ts";

const store = new Map<string, DaemonStatus>();

/** The local kaval's unix socket path (padi resolves it as
 *  `padiKavalSocketPath(stateRoot)` → `kaval-<digest>/pty-host.sock`, keyed by a
 *  digest of padi's state-root), set once at boot and constant for the daemon's
 *  life. Folded onto every published status so the kaval dialog can show where the
 *  daemon listens — a server fact the client can't construct (it doesn't know
 *  padi's `XDG_RUNTIME_DIR`). */
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

/** The local kaval's socket path — the same boot-recorded constant the dialog
 *  reads, reused to stamp `KAVAL_SOCKET` into every terminal this daemon spawns
 *  (so an agent running inside can reach the kaval that owns it, the `$TMUX`
 *  convention). `undefined` until boot records it; the spawn path guards that at
 *  its point of use (see `buildTerminalSpawnInput`). */
export function getLocalSocketPath(): string | undefined {
  return localSocketPath;
}

/** padi's OWN serving socket path — the digest-keyed `padi-<digest>/padi.sock`
 *  padi's `daemonMain` computes and serves on, recorded at boot. */
let padiServeSocketPath: string | undefined;

/** Record padi's own serving socket at boot (in `daemonMain`, before it accepts a
 *  `create`), so every terminal spawned after can carry it. */
export function setPadiServeSocketPath(path: string): void {
  padiServeSocketPath = path;
}

/** padi's own serving socket — the `$KAVAL_SOCKET` twin, stamped as `PADI_SOCKET`
 *  into every terminal this daemon spawns so a `padi-tui` running INSIDE a kolu
 *  terminal reaches the padi that owns it with no `--socket`/`--state-root` flag.
 *  `undefined` until boot records it (or off a spawn path that never booted a
 *  daemon, e.g. a unit test); an absent `PADI_SOCKET` just makes padi-tui fall
 *  back to autodiscovery, so — unlike the kaval locator — the spawn path stamps it
 *  only when present rather than crashing. */
export function getPadiServeSocketPath(): string | undefined {
  return padiServeSocketPath;
}

function publishFullDaemonStatus(hostId: string, status: DaemonStatus): void {
  store.set(hostId, status);
  padiSurfaceCtx.collections.daemonStatus.upsert(hostId, status);
}

/** Record + publish a host's daemon status. The endpoint's `onStatus` sink. Folds
 *  the local socket path on (a constant server fact) so the client need not — and
 *  can't — derive it. */
export function publishDaemonStatus(
  hostId: string,
  status: EndpointStatus<DaemonStatus["identity"], KavalConnectionMetadata>,
): void {
  const socket = localSocketPath ? { socketPath: localSocketPath } : {};
  const full: DaemonStatus =
    status.state === "connected"
      ? {
          state: "connected",
          identity: status.identity,
          startedAt: status.startedAt,
          contractVersion: status.metadata.contractVersion,
          lifetime: status.metadata.lifetime,
          ...socket,
        }
      : {
          state: status.state,
          ...socket,
        };
  publishFullDaemonStatus(hostId, full);
}

/** Fold the boot's adopted-terminal count (B3.3) onto the host's CURRENT status
 *  and re-publish, so the client's "N reattached" toast reads it off the same
 *  `daemonStatus` collection the rail uses. Separate from `publishDaemonStatus`
 *  because the count is kolu's soul, computed by `reconcile` AFTER the endpoint
 *  has already reported `connected` (the spine's `onStatus` knows nothing of
 *  terminals). A no-op if the host has no recorded status yet (it always does by
 *  the time adoption runs — the connect emitted one).
 *
 *  Stamps `adoptedAt` here — this is the one site an adoption is surfaced, and it
 *  fires at most ONCE per server process (boot adoption's `onAdopted`), so the
 *  timestamp is a true per-adoption identity. The pair is sticky in the store and
 *  replayed to every fresh subscription; the client dedupes the toast on
 *  `adoptedAt` so a reconnect/reload replay doesn't re-fire it (juspay/kolu#1365).
 *
 *  `Date.now()` orders adoptions across server boots. Since each adoption is its
 *  OWN process lifetime separated by a restart, two adoptions can't collide on a
 *  millisecond (no intra-process second stamp to alias). The one residual edge is
 *  a wall-clock step BACKWARD across a redeploy — then a genuine new adoption's
 *  `adoptedAt` can fall at-or-below the client's persisted high-water mark and its
 *  (informational) toast is skipped for that one boot; nothing is lost. The store
 *  is in-memory and empty on the next boot, so there's no prior stamp to enforce
 *  monotonicity against server-side, and a client seen-id SET (the alternative)
 *  would grow unbounded and forfeit the "a stale older replay stays silent"
 *  property the high-water mark gives for free. The skewed-clock toast-skip is the
 *  deliberately-accepted cost. */
export function setAdoptedCount(hostId: string, adopted: number): void {
  const current = store.get(hostId);
  if (!current || current.state !== "connected") return;
  publishFullDaemonStatus(hostId, {
    ...current,
    adopted,
    adoptedAt: Date.now(),
  });
}
