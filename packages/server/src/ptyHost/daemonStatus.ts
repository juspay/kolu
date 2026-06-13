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
import { expectedKavalBuildId } from "./index.ts";

const store = new Map<string, DaemonStatus>();

/** Every host's current daemon status (for the collection's `readAll`). */
export function readDaemonStatuses(): Map<string, DaemonStatus> {
  return store;
}

/** One host's current daemon status (for the collection's `readOne`). */
export function readDaemonStatus(hostId: string): DaemonStatus | undefined {
  return store.get(hostId);
}

/** Record + publish a host's daemon status. The endpoint's `onStatus` sink —
 *  it reports `{state, identity, startedAt}` (the spine's soul-agnostic view);
 *  here we enrich it with kolu's EXPECTED kaval build so the client can derive
 *  "update pending" (a connected daemon a build behind the server). */
export function publishDaemonStatus(
  hostId: string,
  status: DaemonStatus,
): void {
  const enriched: DaemonStatus = {
    ...status,
    expectedStaleKey: expectedKavalBuildId() || undefined,
  };
  store.set(hostId, enriched);
  surfaceCtx.collections.daemonStatus.upsert(hostId, enriched);
}
