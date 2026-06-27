/**
 * Awareness + metadata write seam (Design-S) — the publishers and the two
 * narrowed awareness mutators, plus the client-field mutator and the lifecycle
 * publish.
 *
 * Design-S splits a terminal's record in two halves, BOTH carried by the one
 * registry entry: the eight AWARENESS fields ride `entry.awareness` (the sink is
 * the sole live writer, mutating it through the two narrowed mutators), and the
 * AUTHORED record (location + client fields + discriminant) rides `entry.meta`.
 * This module publishes each half on its
 * OWN collection — awareness onto `terminalWorkspace.awareness`, the authored
 * record onto `kolu.authored` — and the CLIENT joins them at read time
 * (`useTerminalMetadata` → `composeTerminalMetadata`). There is NO server-side
 * re-fusion here: this module owns "how an awareness write becomes visible" and
 * "how an authored / lifecycle flip becomes visible" as two separate publishes.
 *
 * The mutator-type narrowing is a bidirectional compile-time fence:
 *   - `updateServerMetadata` — persisted awareness (cwd, git, lastAgentCommand,
 *     agentSession, lastActivityAt). Mutator typed `AwarenessPersistedFields`.
 *     Fires `terminals:dirty`.
 *   - `updateServerLiveMetadata` — live awareness (pr, agent, foreground).
 *     Mutator typed `AwarenessLiveFields`. Does NOT fire `terminals:dirty` —
 *     that's the point: the agent stream publishes at ~150 ms during streaming,
 *     and most of those publishes touch only live state.
 *   - `updateClientMetadata` — client-persisted authored fields (themeName,
 *     parentId, canvasLayout, subPanel, rightPanel, intent). Mutator typed
 *     `TerminalClientMetadata`. Fires `terminals:dirty` (every client field is
 *     persisted).
 *
 * Both awareness mutators now key on the terminal ID (the sink closes over the
 * id); `entry.awareness` on the registry is where their writes land.
 */

import { prValue } from "anyforge/schemas";
import {
  type AwarenessLiveFields,
  type AwarenessPersistedFields,
  type AwarenessValue,
  prUnavailableReason,
  type TerminalClientMetadata,
} from "kolu-common/surface";
import { log } from "../log.ts";
import { terminalsDirtyChannel } from "../publisher.ts";
import { surfaceCtx } from "../surfaceCtx.ts";
import {
  mutateAwarenessLive,
  mutateAwarenessPersisted,
  type TerminalProcess,
} from "../terminal-registry.ts";
import { workspaceSurfaceCtx } from "../workspaceSurfaceCtx.ts";

/** Push an awareness snapshot onto the `terminalWorkspace` surface's `awareness`
 *  collection — the SOLE channel an awareness change reaches the client (kolu's
 *  own client reads this collection and joins each value with the matching
 *  `authored` record). Shallow-clones so the collection stores an independent
 *  snapshot rather than aliasing the live (sink-mutated) store object. The debug
 *  line is the awareness half of the old fused "metadata publish" log — `prStatus`
 *  is the store's raw `pr.kind` (frozen-stale on a slept terminal, which the
 *  client's join drops in favour of the authored frozen `pr`). */
function publishAwareness(terminalId: string, aw: AwarenessValue): void {
  const pr = prValue(aw.pr);
  const prUnavailable = prUnavailableReason(aw.pr);
  log.debug(
    {
      terminal: terminalId,
      cwd: aw.cwd,
      repo: aw.git?.repoName,
      branch: aw.git?.branch,
      pr: pr?.number ?? null,
      checks: pr?.checks ?? null,
      prStatus: aw.pr.kind,
      ...(prUnavailable && { prUnavailable }),
      ...(aw.agent && { agent: `${aw.agent.kind}:${aw.agent.state}` }),
      ...(aw.foreground && { foreground: aw.foreground.name }),
    },
    "awareness publish",
  );
  workspaceSurfaceCtx.collections.awareness.upsert(terminalId, { ...aw });
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
export function installAwareness(
  terminalId: string,
  value: AwarenessValue,
): void {
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

/** Atomically mutate PERSISTED awareness (`cwd`, `git`, `lastAgentCommand`,
 *  `agentSession`, `lastActivityAt`) and publish. The mutator is narrowed to
 *  `AwarenessPersistedFields` — half the bidirectional fence: a sensor cannot
 *  write a live field (pr/agent/foreground) through this path, so the
 *  `terminals:dirty` firehose can't grow back. A no-op if `id` has no awareness
 *  entry (a late write after removal). Fires `terminals:dirty`. */
export function updateServerMetadata(
  terminalId: string,
  mutate: (meta: AwarenessPersistedFields) => void,
): void {
  const aw = mutateAwarenessPersisted(terminalId, mutate);
  if (!aw) {
    // Sensors are torn down BEFORE the entry is removed, so this "never" fires;
    // log it so a write that DOES outlive its terminal (a sensor-teardown bug)
    // is observable rather than silently dropped.
    log.debug(
      { terminal: terminalId },
      "persisted awareness write after removal",
    );
    return;
  }
  publishAwareness(terminalId, aw);
  terminalsDirtyChannel.publish({});
}

/** Atomically mutate LIVE awareness (`pr`, `agent`, `foreground`) and publish —
 *  WITHOUT firing `terminals:dirty` (the firehose fence). The mutator is narrowed
 *  to `AwarenessLiveFields`: writing a persisted field through this path is a type
 *  error. A no-op if `id` has no awareness entry. */
export function updateServerLiveMetadata(
  terminalId: string,
  mutate: (meta: AwarenessLiveFields) => void,
): void {
  const aw = mutateAwarenessLive(terminalId, mutate);
  if (!aw) {
    // See `updateServerMetadata`: a live write that outlives its terminal means a
    // sensor wasn't torn down — surface it at debug rather than drop it silently.
    log.debug({ terminal: terminalId }, "live awareness write after removal");
    return;
  }
  publishAwareness(terminalId, aw);
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
