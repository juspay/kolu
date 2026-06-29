/** Pending tile layouts — the bridge between local geometry intent
 *  (drag-end, resize-end, default-place, arrange) and server metadata
 *  echoes. Multiple consumers need access:
 *
 *  - `TerminalCanvas` reads pending in `layoutOf()`, drops echoed
 *    entries via `dropEvicted` once the saved layout catches up, and
 *    flushes everything via `clear()` on its own unmount so a
 *    mobile↔desktop remount never carries stale entries forward.
 *  - `useCanvasArrange` seeds pending in `handleCanvasAutoArrange` so
 *    a follow-on `placeNew` (e.g. user opens a new worktree right
 *    after arrange) reads the arranged layouts in `existing` instead
 *    of the still-saved pre-arrange ones — the metadata round-trip
 *    hasn't completed yet.
 *
 *  Singleton hook per `.claude/rules/solidjs.md`'s "State per domain"
 *  rule. `createStore` (per the same rule, "use createStore over
 *  createSignal<Record> for keyed state") gives fine-grained per-key
 *  reactivity so a single `setOne` doesn't invalidate every consumer
 *  that reads a different key. */

import type { TerminalId } from "kolu-common/surface";
import { createSignal } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { layoutsEqual, type TileLayout } from "./TileLayout";

const [pending, setPending] = createStore<Record<string, TileLayout>>({});

// One-shot create-time geometry slot — a distinct lifecycle from the
// keyed `pending` store above. `pending` is keyed by tile id (which
// doesn't exist until the create RPC returns); this is the anonymous
// "next tile" size the placement effect reads when assembling a brand-
// new tile's default layout. Kept as its own field (NOT a mode on the
// keyed store) so the keyed/read-when-echoes-settle and the one-shot/
// read-once-and-clear lifecycles don't complect.
//
// Race it bridges: `handleCreate` calls `setActiveSilently(newId)`
// before the canvas `tileIds` effect fires, so by the time the effect
// reads `store.activeId()` it is already the new tile (which has no
// layout yet). The effect cannot read the previous active tile's size
// from the store. So `handleCreate` writes the size before the create
// RPC (the server push during the await triggers the placement effect),
// and the effect reads-and-clears it for the new tile's layout.
const [nextDefaultSize, setNextDefaultSize] = createSignal<{
  w: number;
  h: number;
} | null>(null);

// E2e test hook — bounded ring of recent `applyMany` calls. Use
// instead of a snapshot getter on the live store: the snapshot races
// the `dropEvicted` cleanup (under CI load the seeded window can be
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
  /** Bulk-apply pending overrides (used by arrange). */
  applyMany: (layouts: Map<TerminalId, TileLayout>) => void;
  /** Drop entries for tiles that are no longer alive OR whose saved
   *  layout has caught up to their pending value. The cleanup policy
   *  lives inside the module — callers don't reconstruct it. */
  dropEvicted: (
    alive: Set<TerminalId>,
    saved: (id: TerminalId) => TileLayout | undefined,
  ) => void;
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
      setPending(id, layout);
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
    dropEvicted(alive, saved) {
      // Steady-state after echoes settle is empty pending — skip the
      // produce-draft alloc on every effect tick when there's nothing
      // to consider.
      if (Object.keys(pending).length === 0) return;
      setPending(
        produce((draft: Record<string, TileLayout>) => {
          for (const id of Object.keys(draft)) {
            const entry = draft[id];
            if (!alive.has(id)) {
              delete draft[id];
              continue;
            }
            const current = saved(id);
            if (entry && current && layoutsEqual(current, entry)) {
              delete draft[id];
            }
          }
        }),
      );
    },
    clear() {
      setPending(reconcile({}));
    },
    setNextDefaultSize(size) {
      setNextDefaultSize(size);
    },
    takeNextDefaultSize() {
      const size = nextDefaultSize();
      setNextDefaultSize(null);
      return size;
    },
  };
}
