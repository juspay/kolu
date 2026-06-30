/**
 * Awareness + metadata write seam — the publishers, the fold's two commit seams
 * (observation + memory), the client-field mutator, and the lifecycle publish.
 *
 * A terminal's record is two halves, BOTH carried by the one registry entry: the
 * last-seen `Observation` rides `entry.awareness` (kolu's fold REPLACES it
 * wholesale each frame), and the AUTHORED record (location + memory + client fields
 * + discriminant) rides `entry.meta`. This module publishes each half on its OWN
 * collection — the observation onto `terminalWorkspace.awareness`, the authored
 * record onto `kolu.authored` — and the CLIENT joins them at read time
 * (`useTerminalMetadata` → `composeTerminalMetadata`). There is NO server-side
 * re-fusion here.
 *
 * The write seams:
 *   - `commitObservation(id, observation)` — replace `entry.awareness` and publish
 *     it. Does NOT fire `terminals:dirty`: the ~150 ms agent-detail/foreground
 *     firehose touches only the observation, so it must never arm autosave. The
 *     fold's watch loop fires dirty ITSELF, but only on a restore-relevant VALUE
 *     change (the autosave fence) — never on a bare observation tick.
 *   - `updateMemory(id, memory)` — write the two remembered `AgentMemory` facts
 *     onto `entry.meta` (the narrowed writer — it CANNOT touch any other field) and
 *     publish the authored record. The fold is its one caller; it likewise leaves
 *     `terminals:dirty` to the watch-loop fence.
 *   - `updateClientMetadata` — client-persisted authored fields. Mutator typed
 *     `TerminalClientMetadata`. Fires `terminals:dirty` (every client field is
 *     persisted), the precedent `updateMemory` mirrors.
 */

import { prValue } from "anyforge/schemas";
import {
  type AgentMemory,
  type Observation,
  prUnavailableReason,
  type RestoreTarget,
  type TerminalClientMetadata,
} from "kolu-common/surface";
import { log } from "../log.ts";
import { terminalsDirtyChannel } from "../publisher.ts";
import { surfaceCtx } from "../surfaceCtx.ts";
import { getTerminal, type TerminalProcess } from "../terminal-registry.ts";
import { workspaceSurfaceCtx } from "../workspaceSurfaceCtx.ts";

/** Push an `Observation` snapshot onto the `terminalWorkspace` surface's
 *  `awareness` collection — the SOLE channel an observation change reaches the
 *  client (kolu's own client reads this collection and joins each value with the
 *  matching `authored` record). Shallow-clones so the collection stores an
 *  independent snapshot rather than aliasing the registry object. */
function publishAwareness(terminalId: string, obs: Observation): void {
  const pr = prValue(obs.pr);
  const prUnavailable = prUnavailableReason(obs.pr);
  log.debug(
    {
      terminal: terminalId,
      cwd: obs.cwd,
      repo: obs.git?.repoName,
      branch: obs.git?.branch,
      pr: pr?.number ?? null,
      checks: pr?.checks ?? null,
      prStatus: obs.pr.kind,
      ...(prUnavailable && { prUnavailable }),
      ...(obs.agent && { agent: `${obs.agent.kind}:${obs.agent.state}` }),
      ...(obs.foreground && { foreground: obs.foreground.name }),
    },
    "awareness publish",
  );
  workspaceSurfaceCtx.collections.awareness.upsert(terminalId, { ...obs });
}

/** Push a terminal's AUTHORED record onto the `kolu` surface's `authored`
 *  collection — the SOLE channel an authored change (a spawn, an active↔sleeping
 *  flip, a client field write) reaches the client. Shallow-clones `entry.meta` so
 *  the collection stores an independent snapshot rather than aliasing the live
 *  (in-place-mutated) registry object. `entry` is REQUIRED — both callers
 *  (`updateClientMetadata`, `publishTerminalState`) already hold it — so "publish"
 *  is not complected with "defensively tolerate a missing entry". The collection
 *  `upsert` only fans out to subscribers (the registry IS the store), so this call
 *  is the only way an authored change reaches the client — where it is JOINED with
 *  awareness, never re-fused here. */
function publishAuthored(terminalId: string, entry: TerminalProcess): void {
  surfaceCtx.collections.authored.upsert(terminalId, { ...entry.meta });
}

/** Fan a terminal's awareness snapshot out onto the `awareness` collection. The
 *  awareness VALUE itself now rides the registry entry (a required field set when
 *  the entry is registered), so this no longer writes any backing store — it only
 *  publishes the snapshot to subscribers. Called by the endpoint AFTER
 *  `registerTerminal` on spawn / adopt / orphan / wake / cold-restore; the
 *  caller's `publishTerminalState` publishes the matching authored record, so the
 *  client's join has both halves. */
export function installAwareness(terminalId: string, value: Observation): void {
  publishAwareness(terminalId, value);
}

/** Fan a terminal's awareness REMOVAL out onto the `awareness` collection. The
 *  awareness value was already dropped with the entry by `unregisterTerminal`
 *  (it is a field on the entry), so this only tells subscribers it is gone.
 *  Called by the endpoint's `finalizeRemoval` (and `killAll`) on exit / kill /
 *  discard. */
export function dropAwareness(terminalId: string): void {
  workspaceSurfaceCtx.collections.awareness.remove(terminalId);
}

/** Commit a folded `Observation` — REPLACE `entry.awareness` wholesale (the fold
 *  built a new value; nothing is mutated in place) and publish it. Does NOT fire
 *  `terminals:dirty`: the ~150 ms agent-detail/foreground firehose touches only the
 *  observation, so it must never arm autosave; the fold's watch loop fires dirty
 *  itself, but only on a restore-relevant VALUE change. A no-op if `id` has no
 *  entry (a late commit after removal — sensors are torn down before the entry is
 *  removed, so this "never" fires; logged so a teardown bug is observable). */
export function commitObservation(
  terminalId: string,
  observation: Observation,
): void {
  const entry = getTerminal(terminalId);
  if (!entry) {
    // Sensors are torn down BEFORE the entry is removed, so a commit landing after
    // removal "never" happens — if it does, a teardown-ordering bug let a producer
    // outlive its entry. Log at `warn` so it's visible in prod without debug logging.
    log.warn({ terminal: terminalId }, "observation commit after removal");
    return;
  }
  entry.awareness = observation;
  publishAwareness(terminalId, observation);
}

/** Write the fold's three restore-relevant AUTHORED facts — the two remembered
 *  `AgentMemory` fields (`lastActivityAt`, `lastAgentCommand`) and the fold-derived
 *  `restoreTarget` — onto `entry.meta`, then publish the authored record. The ONE
 *  writer of these (the fold's), so no other code path can spell them — the typed
 *  mirror of `updateClientMetadata`. Does NOT fire `terminals:dirty`: these ARE
 *  restore-relevant, but the fold's watch loop already fires dirty on the
 *  restore-relevant value change, so firing here too would double-arm. The CALLER
 *  (the emit loop) invokes this only when an authored fact actually CHANGED, so the
 *  authored collection never re-publishes on the ~150 ms observation firehose. A
 *  no-op if `id` has no entry. */
export function updateMemory(
  terminalId: string,
  memory: AgentMemory,
  restoreTarget: RestoreTarget,
): void {
  const entry = getTerminal(terminalId);
  if (!entry) {
    // As in `commitObservation`: a memory write after the entry is gone signals a
    // teardown-ordering bug (a producer outlived its entry), not an expected miss —
    // `warn` so it surfaces in prod.
    log.warn({ terminal: terminalId }, "memory write after removal");
    return;
  }
  entry.meta.lastActivityAt = memory.lastActivityAt;
  entry.meta.lastAgentCommand = memory.lastAgentCommand;
  entry.meta.restoreTarget = restoreTarget;
  publishAuthored(terminalId, entry);
}

/** Atomically mutate client-owned AUTHORED metadata (`themeName`, `parentId`,
 *  `canvasLayout`, `subPanel`, `rightPanel`, `intent`) on `entry.meta` and
 *  publish. The mutator is narrowed to `TerminalClientMetadata` so RPC handlers
 *  cannot overwrite provider-owned state. Every client field is persisted, so
 *  this fires `terminals:dirty`. */
export function updateClientMetadata(
  entry: TerminalProcess,
  terminalId: string,
  mutate: (meta: TerminalClientMetadata) => void,
): void {
  mutate(entry.meta);
  publishAuthored(terminalId, entry);
  terminalsDirtyChannel.publish({});
}

/** Publish a terminal's AUTHORED record AND arm the session autosave — for a
 *  lifecycle STATE FLIP (active↔sleeping, fresh spawn) that REPLACES the registry
 *  entry rather than mutating a field in place. The caller has already registered
 *  the entry and fanned its awareness out (`registerAndInstall`), so the matching
 *  awareness is on its collection by the time the client joins this authored push.
 *
 *  THE SOLE PUSH CHANNEL for a lifecycle flip: the `authored` collection's `upsert`
 *  only fans out to subscribers (the registry IS the store), and `terminals:dirty`
 *  alone never re-reads the registry. Every authored active↔sleeping flip and
 *  fresh spawn MUST call this. */
export function publishTerminalState(
  entry: TerminalProcess,
  terminalId: string,
): void {
  publishAuthored(terminalId, entry);
  terminalsDirtyChannel.publish({});
}
