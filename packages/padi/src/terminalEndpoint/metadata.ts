/**
 * Awareness + metadata write seam — the composed publisher, the fold's two commit
 * seams (observation + memory), the client-field mutator, and the lifecycle
 * publish.
 *
 * A terminal's record is two halves, BOTH carried by the one registry entry: the
 * last-seen `TerminalSnapshot` rides `entry.snapshot` (kolu's fold REPLACES it
 * wholesale each frame), and the AUTHORED record (location + memory + client fields
 * + discriminant) rides `entry.meta`. W1.R1 collapses the former per-half publish
 * (observation onto `terminalWorkspace.snapshots`, authored onto `kolu.authored`,
 * joined at the client) into ONE server-side compose: the composed record
 * `composeTerminalMetadata(entry.meta, entry.snapshot)` is published onto padi's
 * `terminals` collection. Because that record `{...snapshot, ...authored}` changes
 * on EITHER an authored-delta OR a snapshot-delta, every seam that used to fire an
 * authored OR a snapshot upsert now fires the ONE composed publish.
 *
 * The write seams:
 *   - `commitSnapshot(id, observation)` — replace `entry.snapshot` and publish the
 *     composed record.
 *   - `updateMemory(id, memory)` — write the two remembered `AgentMemory` facts
 *     onto `entry.meta` (the narrowed writer — it CANNOT touch any other field) and
 *     publish the composed record.
 *   - `updateClientMetadata` — client-persisted authored fields, mutator typed
 *     `TerminalClientMetadata`.
 *
 * TWO cross-cutting concerns ride these seams, and each has ONE owner here:
 *
 *   - **Urgency.** `publishComposedTerminal` refolds the `urgency` cell
 *     (`recomputeUrgency()`) on EVERY composed publish — the one call site. The
 *     cell's `equals` (`urgencyEqual`) dedups, so a seam whose write can't move the
 *     projection (memory facts, client chrome) refolds to an equal value and
 *     publishes nothing; a seam whose write can (the agent-state firehose, an
 *     active↔sleeping flip) updates the badge. The removal path refolds separately
 *     (`dropSnapshot` — no composed publish to ride). No seam decides "does this
 *     change urgency?" any more; the fold answers it uniformly and for free.
 *   - **Autosave arming.** A seam that should schedule a session save calls
 *     {@link notifyDirty} (the `AutosaveGate`'s single writer entry);
 *     `updateClientMetadata` and `publishTerminalState` do, because every client
 *     field / lifecycle flip is persisted. `commitSnapshot` and `updateMemory` do
 *     NOT — the ~150 ms observation/memory firehose is not itself restore-relevant,
 *     and the fold's watch loop pulses `notifyDirty` on the restore-relevant VALUE
 *     change. The arm is a named call, so its presence or absence is the invariant;
 *     there is no per-seam prose to keep in sync.
 */

import type {
  AgentMemory,
  RestoreTarget,
  TerminalSnapshot,
} from "@kolu/terminal-vocab/schema";
import { log } from "../log.ts";
import { padiSurfaceCtx } from "../padiSurfaceCtx.ts";
import { notifyDirty } from "../publisher.ts";
import { PadiParkedTerminalSchema, type PadiTerminal } from "../surface.ts";
import { getTerminal, type TerminalProcess } from "../terminal-registry.ts";
import { recomputeUrgency } from "../urgency.ts";
import {
  composeTerminalMetadata,
  PersistedSnapshotSchema,
  type TerminalClientMetadata,
} from "../vocab.ts";

/** Compose a registry entry into the served `PadiTerminal` value — the ONE
 *  server-side `authored ⋈ snapshot` join, with an EXPLICIT `parked` branch.
 *
 *  `composeTerminalMetadata` (reused at the client read + disk persist) only
 *  emits the `active | sleeping` arms — its `AuthoredTerminal` input can't carry
 *  the boot-only `parked` authored arm — so a parked entry is composed HERE from
 *  the restore-relevant snapshot projection + the authored parked arm, exactly
 *  `PadiParkedTerminalSchema`'s shape. Shared by the live publish seam
 *  (`publishComposedTerminal`) and the collection backing (`servePadi`), so the
 *  served value can never differ between a delta and a snapshot. */
export function composePadiTerminal(entry: TerminalProcess): PadiTerminal {
  if (entry.meta.state === "parked") {
    return PadiParkedTerminalSchema.parse({
      ...PersistedSnapshotSchema.parse(entry.snapshot),
      ...entry.meta,
    });
  }
  return composeTerminalMetadata(entry.meta, entry.snapshot);
}

/** Publish a terminal's COMPOSED record — `composeTerminalMetadata(entry.meta,
 *  entry.snapshot)` — onto padi's `terminals` collection, AND refold the urgency
 *  projection. The SOLE channel a metadata change (an authored-delta OR a
 *  snapshot-delta) reaches the client: the server folds the two halves that share
 *  the one registry entry, so the wire carries the already-joined `active|sleeping`
 *  record (the client's reader-join collapsed to a single read in W1.R1). Reads the
 *  CURRENT registry entry via `getTerminal(id)`; a no-op if the id has no entry (the
 *  removal path uses `dropSnapshot` → `.remove` instead). The `upsert` only fans out
 *  to subscribers — the registry IS the store.
 *
 *  Every composed publish also refolds `urgency` ({@link publishUrgency}): this is
 *  the ONE call site that answers "did this write move the urgency projection?", so
 *  no seam has to decide it. The refold is deduped by `urgencyEqual`, free when the
 *  write can't move the badge. */
function publishComposedTerminal(terminalId: string): void {
  const entry = getTerminal(terminalId);
  if (!entry) return;
  padiSurfaceCtx.collections.terminals.upsert(
    terminalId,
    composePadiTerminal(entry),
  );
  publishUrgency();
}

/** Refold + publish the recency-free urgency projection. Deduped by the cell's
 *  `urgencyEqual`, so folding it into every composed publish (and the removal path)
 *  is free. */
function publishUrgency(): void {
  padiSurfaceCtx.cells.urgency.set(recomputeUrgency());
}

/** Fan a terminal's COMPOSED record out onto the `terminals` collection. The
 *  awareness VALUE rides the registry entry (a required field set when the entry is
 *  registered), so this reads the live entry rather than taking the snapshot as an
 *  argument. Called by the endpoint AFTER `registerTerminal` on spawn / adopt /
 *  orphan / wake / cold-restore; the caller's `publishTerminalState` re-publishes
 *  the same composed record, so the tile has its metadata either way. */
export function installSnapshot(terminalId: string): void {
  publishComposedTerminal(terminalId);
}

/** Fan a terminal's REMOVAL out onto the `terminals` collection and refold
 *  urgency. The entry was already dropped by `unregisterTerminal` /
 *  `drainTerminals` before this runs, so `.remove` tells subscribers it is gone and
 *  `recomputeUrgency` folds the post-removal registry. Called by the endpoint's
 *  `finalizeRemoval` (and `killAll`) on exit / kill / discard. */
export function dropSnapshot(terminalId: string): void {
  padiSurfaceCtx.collections.terminals.remove(terminalId);
  publishUrgency();
}

/** Commit a folded `TerminalSnapshot` — REPLACE `entry.snapshot` wholesale (the fold
 *  built a new value; nothing is mutated in place) and publish the composed record
 *  (which refolds urgency — the agent state rides the observation). Does NOT arm the
 *  autosave (no {@link notifyDirty}): the ~150 ms agent-detail/foreground firehose is
 *  not itself restore-relevant, and the fold's watch loop pulses `notifyDirty` on the
 *  restore-relevant VALUE change. A no-op if `id` has no entry (a late commit after
 *  removal — sensors are torn down before the entry is removed, so this "never"
 *  fires; logged so a teardown bug is observable). */
export function commitSnapshot(
  terminalId: string,
  observation: TerminalSnapshot,
): void {
  const entry = getTerminal(terminalId);
  if (!entry) {
    // Sensors are torn down BEFORE the entry is removed, so a commit landing after
    // removal "never" happens — if it does, a teardown-ordering bug let a producer
    // outlive its entry. Log at `warn` so it's visible in prod without debug logging.
    log.warn({ terminal: terminalId }, "observation commit after removal");
    return;
  }
  // Apply the fold's commit to the registry FIRST (the accepted value), THEN publish.
  // The publish (a collection upsert that fans out to subscribers) is the only
  // fallible step, so guard it HERE — at the publish boundary — not around the
  // producer's emit funnel: a throwing subscriber must not propagate back into the
  // sensor loop (it would freeze the sensor) and must not be swallowed at a seam
  // where the producer already advanced its dedup baseline (the fold has accepted
  // `observation` above, so the registry stays in sync regardless; a lost publish
  // self-heals on the next observation). This is what makes `emit` infallible.
  entry.snapshot = observation;
  try {
    publishComposedTerminal(terminalId);
  } catch (err) {
    log.error(
      { err, terminal: terminalId },
      "composed terminal publish threw (observation committed; will re-publish on next change)",
    );
  }
}

/** Write the fold's three restore-relevant AUTHORED facts — the two remembered
 *  `AgentMemory` fields (`lastActivityAt`, `lastAgentCommand`) and the fold-derived
 *  `restoreTarget` — onto `entry.meta`, then publish the composed record. The ONE
 *  writer of these (the fold's), so no other code path can spell them — the typed
 *  mirror of `updateClientMetadata`. Does NOT arm the autosave (no {@link notifyDirty}):
 *  these ARE restore-relevant, but the fold's watch loop already pulses `notifyDirty`
 *  on the restore-relevant value change, so arming here too would double-arm; the
 *  CALLER (the emit loop) invokes this only when an authored fact actually CHANGED. A
 *  no-op if `id` has no entry. */
export function updateMemory(
  terminalId: string,
  memory: AgentMemory,
  restoreTarget: RestoreTarget,
): void {
  const entry = getTerminal(terminalId);
  if (!entry) {
    // As in `commitSnapshot`: a memory write after the entry is gone signals a
    // teardown-ordering bug (a producer outlived its entry), not an expected miss —
    // `warn` so it surfaces in prod.
    log.warn({ terminal: terminalId }, "memory write after removal");
    return;
  }
  // Apply the fold's memory facts to the registry FIRST (accepted), THEN publish —
  // and guard the publish at this boundary (as `commitSnapshot` does), so a
  // throwing terminals-collection subscriber can't propagate into the sensor loop or
  // be swallowed after the producer baseline advanced. The registry stays in sync;
  // a lost publish self-heals on the next authored-fact change.
  entry.meta.lastActivityAt = memory.lastActivityAt;
  entry.meta.lastAgentCommand = memory.lastAgentCommand;
  entry.meta.restoreTarget = restoreTarget;
  // The composed publish refolds urgency uniformly; the memory facts written above
  // are none of `recomputeUrgency`'s inputs, so the refold dedups to a no-op here.
  try {
    publishComposedTerminal(terminalId);
  } catch (err) {
    log.error(
      { err, terminal: terminalId },
      "composed terminal publish threw (memory committed; will re-publish on next change)",
    );
  }
}

/** Atomically mutate client-owned AUTHORED metadata (`themeName`, `parentId`,
 *  `canvasLayout`, `subPanel`, `rightPanel`, `intent`) on `entry.meta` and
 *  publish the composed record. The mutator is narrowed to `TerminalClientMetadata`
 *  so RPC handlers cannot overwrite provider-owned state. Every client field is
 *  persisted, so this arms the autosave ({@link notifyDirty}). The composed publish
 *  refolds urgency uniformly (a no-op here — client chrome is not an urgency input). */
export function updateClientMetadata(
  entry: TerminalProcess,
  terminalId: string,
  mutate: (meta: TerminalClientMetadata) => void,
): void {
  mutate(entry.meta);
  publishComposedTerminal(terminalId);
  notifyDirty();
}

/** Publish a terminal's COMPOSED record AND arm the session autosave — for a
 *  lifecycle STATE FLIP (active↔sleeping, fresh spawn) that REPLACES the registry
 *  entry rather than mutating a field in place. The caller has already registered
 *  the entry and fanned its awareness out (`registerAndInstall`), so the composed
 *  record reads correctly here.
 *
 *  THE SOLE PUSH CHANNEL for a lifecycle flip: the `terminals` collection's `upsert`
 *  only fans out to subscribers (the registry IS the store), and the `terminals:dirty`
 *  pulse alone never re-reads the registry. Every authored active↔sleeping flip and
 *  fresh spawn MUST call this. The composed publish refolds urgency (the flip changes
 *  `meta.state`, an urgency input — a slept awaiting-terminal can't self-heal via
 *  `commitSnapshot`, its sensors are torn down), and this arms the autosave
 *  ({@link notifyDirty}). Reads the current registry entry via the id (the caller
 *  already registered the replacement entry), so it needs no entry argument. */
export function publishTerminalState(terminalId: string): void {
  publishComposedTerminal(terminalId);
  notifyDirty();
}
