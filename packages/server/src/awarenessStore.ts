/**
 * The process-singleton AWARENESS store (Design-S) — the one live home of every
 * terminal's `AwarenessValue` (cwd · git · lastAgentCommand · agentSession ·
 * lastActivityAt · pr · agent · foreground), keyed by terminal id.
 *
 * Design-S bisects the old fused `entry.meta`: the eight awareness fields live
 * HERE; the kolu-owned `location` + client/UI fields + active|sleeping
 * discriminant stay on the registry's `entry.meta` (now typed `AuthoredTerminal`,
 * naming no awareness field). The sensor SINK (`terminalEndpoint/metadata.ts`'s
 * `updateServerMetadata` / `updateServerLiveMetadata`) is the SOLE live writer,
 * and its two mutators are narrowed to one half of the persisted/live partition
 * each — so "two writers of awareness" is unrepresentable.
 *
 * This is a LEAF: it imports only the awareness/id TYPES from
 * `kolu-common/surface` and nothing from kolu-server's surface/registry, so it
 * can be imported by the registry, the sink, and the endpoint without a cycle.
 *
 * Lifecycle invariant: a store entry exists IFF a registry entry exists — the
 * sink seeds the store BEFORE `registerTerminal` and drops it AFTER
 * `unregisterTerminal`. `terminals.ts`'s save path logs-and-skips on a violation
 * (fail-fast, never `?? {}`).
 */

import type {
  AwarenessLiveFields,
  AwarenessPersistedFields,
  AwarenessValue,
  TerminalId,
} from "kolu-common/surface";

const store = new Map<TerminalId, AwarenessValue>();

/** The LIVE mutable awareness value for `id`, or `undefined` if absent. The
 *  returned object is the one the sensor sink mutates in place (and that
 *  `record.meta` aliases inside `startAwarenessSensors`), so callers must treat
 *  it READ-ONLY — mutate only through the sink's two narrowed mutators below. */
export function awarenessFor(id: TerminalId): AwarenessValue | undefined {
  return store.get(id);
}

/** The whole store, for the `terminalWorkspace` surface's `awareness` collection
 *  `readAll`. The live map (not a copy) — the collection reader treats it
 *  read-only. */
export function awarenessReadAll(): Map<TerminalId, AwarenessValue> {
  return store;
}

/** Seed (or replace) a terminal's awareness value. Called by the sink's
 *  `installAwareness` on spawn / adopt / orphan / wake / cold-restore, BEFORE the
 *  matching `registerTerminal`. */
export function setAwareness(id: TerminalId, value: AwarenessValue): void {
  store.set(id, value);
}

/** Drop a terminal's awareness value. Returns true when an entry was present.
 *  Called by the sink's `dropAwareness` AFTER `unregisterTerminal` on
 *  exit / kill / discard / killAll. */
export function removeAwareness(id: TerminalId): boolean {
  return store.delete(id);
}

/** Mutate the PERSISTED half of a terminal's awareness IN PLACE and return the
 *  (same) value, or `undefined` if the terminal has no awareness entry (a late
 *  write after removal — the apply-and-read-back contract drops it). The mutator
 *  is narrowed to `AwarenessPersistedFields`, half the write fence: writing
 *  `m.agent`/`m.pr`/`m.foreground` through it is a COMPILE error. */
export function mutateAwarenessPersisted(
  id: TerminalId,
  mutate: (m: AwarenessPersistedFields) => void,
): AwarenessValue | undefined {
  const aw = store.get(id);
  if (aw) mutate(aw);
  return aw;
}

/** Mutate the LIVE half of a terminal's awareness IN PLACE and return the (same)
 *  value, or `undefined` if absent. The mutator is narrowed to
 *  `AwarenessLiveFields`, the other half of the fence: writing
 *  `m.cwd`/`m.lastActivityAt`/… through it is a COMPILE error. */
export function mutateAwarenessLive(
  id: TerminalId,
  mutate: (m: AwarenessLiveFields) => void,
): AwarenessValue | undefined {
  const aw = store.get(id);
  if (aw) mutate(aw);
  return aw;
}
