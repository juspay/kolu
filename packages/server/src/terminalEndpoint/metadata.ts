/**
 * Awareness + metadata write seam (Design-S) — the publishers and the two
 * narrowed awareness mutators, plus the client-field mutator and the lifecycle
 * publish.
 *
 * Design-S splits a terminal's record in two: the eight AWARENESS fields live in
 * the process-singleton `../awarenessStore.ts` (the sink is the sole live
 * writer), and the AUTHORED record (location + client fields + discriminant)
 * stays on the registry's `entry.meta`. This module publishes each half on its
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
 * id); the awareness store is the registry their writes land in.
 */

import { prValue } from "anyforge/schemas";
import {
  type AwarenessLiveFields,
  type AwarenessPersistedFields,
  type AwarenessValue,
  prUnavailableReason,
  type TerminalClientMetadata,
} from "kolu-common/surface";
import {
  mutateAwarenessLive,
  mutateAwarenessPersisted,
  removeAwareness,
  setAwareness,
} from "../awarenessStore.ts";
import { log } from "../log.ts";
import { terminalsDirtyChannel } from "../publisher.ts";
import { surfaceCtx } from "../surfaceCtx.ts";
import { getTerminal, type TerminalProcess } from "../terminal-registry.ts";
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
 *  (in-place-mutated) registry object. A no-op if the entry is absent (a publish
 *  racing teardown). The collection `upsert` only fans out to subscribers (the
 *  registry IS the store), so this call is the only way an authored change reaches
 *  the client — where it is JOINED with awareness, never re-fused here. */
function publishAuthored(
  terminalId: string,
  entry = getTerminal(terminalId),
): void {
  if (!entry) return;
  surfaceCtx.collections.authored.upsert(terminalId, { ...entry.meta });
}

/** Seed a terminal's awareness into the store AND publish it. Called by the
 *  endpoint on spawn / adopt / orphan / wake / cold-restore, BEFORE the matching
 *  `registerTerminal` (store↔registry lockstep). Does NOT publish the authored
 *  record — the caller's `publishTerminalState` (after register) does, once the
 *  authored record is in the registry; the awareness half is already on its
 *  collection by then, so the client's join has both. */
export function installAwareness(
  terminalId: string,
  value: AwarenessValue,
): void {
  setAwareness(terminalId, value);
  publishAwareness(terminalId, value);
}

/** Drop a terminal's awareness from the store AND the `awareness` collection.
 *  Called by the endpoint AFTER `unregisterTerminal` on exit / kill / discard /
 *  killAll. */
export function dropAwareness(terminalId: string): void {
  if (removeAwareness(terminalId)) {
    workspaceSurfaceCtx.collections.awareness.remove(terminalId);
  }
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
  if (!aw) return;
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
  if (!aw) return;
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
 *  entry rather than mutating a field in place. The caller seeds the store
 *  (`installAwareness`) before registering the entry, so the matching awareness is
 *  already on its collection by the time the client joins this authored push.
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
