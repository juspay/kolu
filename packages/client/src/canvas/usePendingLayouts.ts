/** Pending tile layouts — the bridge between local geometry intent
 *  (drag-end, resize-end, default-place, arrange) and server metadata
 *  echoes. Multiple consumers need access:
 *
 *  - `TerminalCanvas` reads pending in `layoutOf()`, drops echoed
 *    entries via `evictedIds`/`dropIds` once the saved layout catches up, and
 *    flushes everything via `clear()` on its own unmount so a
 *    mobile↔desktop remount never carries stale entries forward.
 *  - `useCanvasArrange` seeds pending in `handleCanvasAutoArrange` so
 *    a follow-on `placeNew` (e.g. user opens a new worktree right
 *    after arrange) reads the arranged layouts in `existing` instead
 *    of the still-saved pre-arrange ones — the metadata round-trip
 *    hasn't completed yet.
 *
 *  Singleton hook per `dev/skills/kolu-client/SKILL.md`'s "State per domain"
 *  rule. `createStore` (per the same rule, "use createStore over
 *  createSignal<Record> for keyed state") gives fine-grained per-key
 *  reactivity so a single `setOne` doesn't invalidate every consumer
 *  that reads a different key. */

import type { TerminalId } from "kolu-common/surface";
import {
  createSignal,
  createStore,
  produce,
  reconcile,
  untrack,
} from "solid-js";
import { layoutsEqual, type TileLayout } from "./TileLayout";

// HOST-SCOPING: host-INDEPENDENT by design — keyed by globally-unique TerminalId
// (a transient drag-intent → server-echo bridge, cleared on canvas unmount), so a
// pending override applies to its own tile regardless of which host is shown, not
// durable per-host state.
const [pending, setPending] = createStore<Record<string, TileLayout>>({});

// One-shot create-time geometry slot — a distinct lifecycle from the
// keyed `pending` store above. `pending` is keyed by tile id (which
// doesn't exist until the create RPC returns); this is the anonymous
// "next tile" size the placement effect reads when assembling a brand-
// new tile's default layout. Kept as its own field (NOT a mode on the
// keyed store) so the keyed/read-when-echoes-settle and the one-shot/
// read-once-and-clear lifecycles don't complect.
//
// Why a slot and not a read at placement time: the placement effect runs
// later (driven by the server's tile-list push) and only knows "here is a
// new tile with no layout" — it has no reliable handle on WHICH existing
// tile to inherit from once a create is in flight (the active id may have
// already moved to the new tile, and the previous active tile's visible
// size may still be settling). `handleCreate` is the one place that knows
// the source (active) tile at create time, so it snapshots the size into
// this slot BEFORE starting the RPC; the effect reads-and-clears it for
// the new tile's layout. Correctness depends only on that ordering
// (armed before the server push, consumed when a new tile appears) — NOT
// on the relative timing of `setActiveSilently` and the `tileIds` effect.
// HOST-SCOPING: host-INDEPENDENT by design — a transient write-once/read-once slot
// scoped to a single create flow (also nulled by `clear()` on canvas unmount), not
// durable per-host state.
const [nextDefaultSize, setNextDefaultSize] = createSignal<{
  w: number;
  h: number;
} | null>(null);

// E2e test hook — bounded ring of recent `applyMany` calls. Use
// instead of a snapshot getter on the live store: the snapshot races
// the `evictedIds`/`dropIds` cleanup (under CI load the seeded window can be
// shorter than the polling interval), but the history survives. The
// fix for the worktree-after-arrange race is "applyMany is called
// synchronously inside the arrange handler"; the history records
// that call deterministically. See `kolu-common/test-hooks`.
//
// Capped at HISTORY_LIMIT: applyMany fires on every drag/resize/
// default-place/arrange, so a long-running session would otherwise
// accumulate one entry per gesture. The cap is large enough that any
// individual e2e step's writes survive within the same scenario,
// small enough that production sessions don't leak a growing array. */
const HISTORY_LIMIT = 32;
if (typeof window !== "undefined") {
  window.__koluPendingApplyHistory = [];
}

export function usePendingLayouts(): {
  /** Read the current pending record. Reactive — consumers depending
   *  on a specific key only re-run when that key changes (createStore
   *  fine-grained tracking). */
  pending: Record<string, TileLayout>;
  /** Set or update a single tile's pending override. */
  setOne: (id: TerminalId, layout: TileLayout) => void;
  /** Effective layout for a tile: the pending override wins over the
   *  echoed/saved layout. The single home for the "pending ⊕ saved"
   *  precedence — both the canvas `layoutOf` and `handleCreate`'s
   *  size-inheritance read go through this instead of re-deriving it. */
  resolveLayout: (
    id: TerminalId,
    echoed: TileLayout | undefined,
  ) => TileLayout | undefined;
  /** Bulk-apply pending overrides (used by arrange). */
  applyMany: (layouts: Map<TerminalId, TileLayout>) => void;
  /** Which pending entries are evictable: tiles that are no longer alive OR
   *  whose saved layout has caught up to their pending value. PURE and fully
   *  reactive (it reads the pending store and every `saved(id)` it considers),
   *  so it belongs in an effect's COMPUTE phase; `dropIds` applies the result.
   *  The cleanup policy lives inside the module — callers don't reconstruct it. */
  evictedIds: (
    alive: Set<TerminalId>,
    saved: (id: TerminalId) => TileLayout | undefined,
  ) => TerminalId[];
  /** Drop the entries `evictedIds` named. A write — effect phase only. */
  dropIds: (ids: readonly TerminalId[]) => void;
  /** Wipe all pending entries. Called on canvas unmount so a remount
   *  starts from a clean slate. */
  clear: () => void;
  /** Arm the one-shot create-time size slot. Called by `handleCreate`
   *  before the create RPC; `null` clears it (create failed → no server
   *  push to consume it). Separate from the keyed store. */
  setNextDefaultSize: (size: { w: number; h: number } | null) => void;
  /** Read and clear the one-shot create-time size. Called by the canvas
   *  placement effect when assigning a default layout to a new tile.
   *  Returns null if none was armed (first terminal, or a create path
   *  that didn't arm one). */
  takeNextDefaultSize: () => { w: number; h: number } | null;
} {
  return {
    get pending() {
      return pending;
    },
    setOne(id, layout) {
      setPending(
        produce((draft: Record<string, TileLayout>) => {
          const held = draft[id];
          if (held) Object.assign(held, layout);
          else draft[id] = layout;
        }),
      );
    },
    resolveLayout(id, echoed) {
      return pending[id] ?? echoed;
    },
    applyMany(layouts) {
      setPending(
        produce((draft: Record<string, TileLayout>) => {
          for (const [id, layout] of layouts) draft[id] = layout;
        }),
      );
      if (typeof window !== "undefined") {
        const history = window.__koluPendingApplyHistory;
        if (history) {
          history.push([...layouts.keys()]);
          if (history.length > HISTORY_LIMIT) history.shift();
        }
      }
    },
    evictedIds(alive, saved) {
      const ids: TerminalId[] = [];
      for (const id of Object.keys(pending) as TerminalId[]) {
        if (!alive.has(id)) {
          ids.push(id);
          continue;
        }
        const entry = pending[id];
        const current = saved(id);
        if (entry && current && layoutsEqual(current, entry)) ids.push(id);
      }
      return ids;
    },
    dropIds(ids) {
      // Steady state after echoes settle is nothing to drop — skip the
      // produce-draft alloc on every effect tick.
      if (ids.length === 0) return;
      setPending(
        produce((draft: Record<string, TileLayout>) => {
          for (const id of ids) delete draft[id];
        }),
      );
    },
    clear() {
      setPending(reconcile({}));
      // The one-shot size slot is part of the same cleanup contract: a
      // canvas unmount wipes the keyed pending AND any size armed but not
      // yet consumed, so a remount can't have a stale create-time size
      // leak into the next new tile.
      setNextDefaultSize(null);
    },
    setNextDefaultSize(size) {
      // Not recursion: object method shorthand has no self-binding, so this
      // resolves to the module-level Solid signal setter captured above.
      setNextDefaultSize(size);
    },
    takeNextDefaultSize() {
      // Untracked: a read-and-CLEAR of a one-shot slot. Its caller is an
      // effect's imperative phase, which must not subscribe to the slot it is
      // about to empty (and would re-read as a dependency on its own write).
      const size = untrack(nextDefaultSize);
      setNextDefaultSize(null);
      return size;
    },
  };
}
