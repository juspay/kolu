/**
 * kolu's AUTHORED-metadata helpers — `createMetadata` (birth), the
 * `terminalMetadata` publish path, and `updateClientMetadata` (client RPC
 * writes). There is no longer a server-persisted/live FENCE here: kolu no longer
 * holds the observation, so the only writer of its record is the client (chrome)
 * and the lifecycle (state flips). The sensors write the OBSERVATION elsewhere —
 * the in-process `terminalWorkspaceSurface.awareness` store, through their own
 * `AwarenessSink` (see `local.ts`'s `makeAwarenessSink`) — and never touch this
 * record. That is what removed the co-ownership the old two-writer fence guarded.
 *
 * The one persistence-relevant observation kolu still reacts to is `cwd`, which
 * changes at human-`cd` speed: the cwd tap arms the session autosave directly
 * (`local.ts`), no firehose, no typed wall.
 */

import type {
  HostLocation,
  KoluActiveTerminal,
  TerminalClientMetadata,
} from "kolu-common/surface";
import { log } from "../log.ts";
import { terminalsDirtyChannel } from "../publisher.ts";
import { surfaceCtx } from "../surfaceCtx.ts";
import type { TerminalProcess } from "../terminal-registry.ts";

/** Create the AUTHORED active record for a new terminal — just kolu's own fields
 *  (`location` + the `active` discriminant). The terminal's OBSERVED state
 *  (cwd/git/pr/agent/foreground) is NOT seeded here; it's the sensors' to publish
 *  into the awareness store. `location` is required, not defaulted: the owning
 *  endpoint declares where the terminal lives (local passes `LOCAL_LOCATION`; a
 *  remote endpoint passes `{ kind: "remote", hostId }`), so a dropped location is
 *  a compile error at every spawn site rather than a silent local respawn. */
export function createMetadata(location: HostLocation): KoluActiveTerminal {
  return { location, state: "active" };
}

/** Emit a terminal's current AUTHORED snapshot to the `terminalMetadata`
 *  collection. The browser composes it with the live `AwarenessValue` (off
 *  `terminalWorkspaceSurface.awareness`) at render. Clones so a later in-place
 *  client-field mutation can't alias the published value. */
function publishSnapshot(entry: TerminalProcess, terminalId: string): void {
  log.debug(
    { terminal: terminalId, state: entry.meta.state },
    "metadata publish",
  );
  surfaceCtx.collections.terminalMetadata.upsert(terminalId, { ...entry.meta });
}

function publishSnapshotAndDirty(
  entry: TerminalProcess,
  terminalId: string,
): void {
  publishSnapshot(entry, terminalId);
  terminalsDirtyChannel.publish({});
}

/** Publish a terminal's current authored snapshot AND arm the session autosave —
 *  for a lifecycle STATE FLIP (active↔sleeping) that replaces the registry entry.
 *  Accepts the union: a freshly-flipped sleeping entry publishes its frozen base. */
export function publishTerminalState(
  entry: TerminalProcess,
  terminalId: string,
): void {
  publishSnapshotAndDirty(entry, terminalId);
}

/** Atomically mutate client-owned metadata (`themeName`, `parentId`,
 *  `canvasLayout`, `subPanel`, `rightPanel`, `intent`) and publish. The mutator is
 *  narrowed to `TerminalClientMetadata` so RPC handlers can't overwrite authored
 *  lifecycle/location state. Every client field is persisted, so this fires
 *  `terminals:dirty`. (The only mutator left — the observation writes moved to the
 *  sensors' awareness sink, so there's no server-persisted/live pair anymore.) */
export function updateClientMetadata(
  entry: TerminalProcess,
  terminalId: string,
  mutate: (meta: TerminalClientMetadata) => void,
): void {
  mutate(entry.meta);
  publishSnapshotAndDirty(entry, terminalId);
}
