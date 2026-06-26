/**
 * Awareness + metadata write seam (Design-S) — the publishers and the two
 * narrowed awareness mutators, plus the client-field mutator and the lifecycle
 * publish.
 *
 * Design-S splits a terminal's record in two: the eight AWARENESS fields live in
 * the process-singleton `../awarenessStore.ts` (the sink is the sole live
 * writer), and the AUTHORED record (location + client fields + discriminant)
 * stays on the registry's `entry.meta`. The WIRE `TerminalMetadata` the client
 * reads is RECOMPOSED at publish time via `composeTerminalMetadata` — so this
 * module owns both "how an awareness write becomes visible" and "how a lifecycle
 * flip becomes visible".
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
  composeTerminalMetadata,
  prUnavailableReason,
  type TerminalClientMetadata,
} from "kolu-common/surface";
import {
  awarenessFor,
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
 *  collection. Shallow-clones so the collection stores an independent snapshot
 *  rather than aliasing the live (sink-mutated) store object. */
function publishAwareness(terminalId: string, aw: AwarenessValue): void {
  workspaceSurfaceCtx.collections.awareness.upsert(terminalId, { ...aw });
}

/** Recompose + push the WIRE `TerminalMetadata` for `terminalId` onto the `kolu`
 *  surface's `terminalMetadata` collection — the SOLE producer of the wire shape.
 *  Reads the authored record off the registry and the awareness off the store;
 *  a no-op if either is absent (a publish racing teardown). The collection
 *  `upsert` is a no-op that only fans out to subscribers (the registry + store
 *  ARE the source of truth), so this call is the only way a change reaches the
 *  client. */
function publishWire(
  terminalId: string,
  entry = getTerminal(terminalId),
): void {
  const aw = awarenessFor(terminalId);
  if (!entry || !aw) return;
  // The live overlay (pr/agent/foreground) is meaningful only on an active arm;
  // a sleeping terminal's store live half is frozen-stale, so the debug line
  // reports `sleeping` for its `prStatus` and reads identity off the store.
  const active = entry.meta.state === "active";
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
      prStatus: active ? aw.pr.kind : "sleeping",
      ...(prUnavailable && { prUnavailable }),
      ...(aw.agent && { agent: `${aw.agent.kind}:${aw.agent.state}` }),
      ...(aw.foreground && { foreground: aw.foreground.name }),
    },
    "metadata publish",
  );
  surfaceCtx.collections.terminalMetadata.upsert(
    terminalId,
    composeTerminalMetadata(entry.meta, aw),
  );
}

/** Seed a terminal's awareness into the store AND publish it. Called by the
 *  endpoint on spawn / adopt / orphan / wake / cold-restore, BEFORE the matching
 *  `registerTerminal` (store↔registry lockstep). Does NOT publish the wire — the
 *  caller's `publishTerminalState` (after register) does, once the authored
 *  record is in the registry. */
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
  publishWire(terminalId);
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
  publishWire(terminalId);
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
  publishWire(terminalId, entry);
  terminalsDirtyChannel.publish({});
}

/** Publish a terminal's recomposed wire snapshot AND arm the session autosave —
 *  for a lifecycle STATE FLIP (active↔sleeping, fresh spawn) that REPLACES the
 *  registry entry rather than mutating a field in place. The caller seeds the
 *  store (`installAwareness`) before registering the entry, so `publishWire`
 *  recomposes from both halves.
 *
 *  THE SOLE PUSH CHANNEL for a lifecycle flip: `terminalMetadata`'s `upsert` only
 *  fans out to subscribers (the registry IS the store), and `terminals:dirty`
 *  alone never re-reads the registry. Every authored active↔sleeping flip and
 *  fresh spawn MUST call this. */
export function publishTerminalState(
  entry: TerminalProcess,
  terminalId: string,
): void {
  publishWire(terminalId, entry);
  terminalsDirtyChannel.publish({});
}
